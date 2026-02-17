// api/generate/index.js
// Full replace: strict CORS gate + robust body parsing + prompt repo support + JSON enforcement
// + Insight returns as an object (for UI rendering + human-friendly download formatting)
// + QC gate + one repair attempt
// ✅ FIXES (2026-02-16/17)
// - PROMPT path aligned to repo: prompts/v2/*.prompt.md
// - QC_FAILED returns 422 (not 502)
// - One repair attempt when QC fails (temperature 0)
// - Repair prompt includes the previous (failed) JSON output
// - QC pre-coercion: accept common alternative keys and normalize BEFORE QC
// - Hard constraints injected into the LLM user message to reduce "{}" / key drift
// - Repair explicitly forbids empty JSON and requires non-empty required fields

const { computeEngineDecisions } = require("../engine/compute");
const { loadPrompt } = require("../engine/promptLoader");
const { validateOutput, validateInsight } = require("../engine/qc");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

function getAllowedOrigin() {
  return String(process.env.ALLOW_ORIGIN || "*").trim();
}

function isOriginAllowed(reqOrigin, allow) {
  if (!reqOrigin) return true; // allow server-to-server
  if (allow === "*") return true;
  const allowed = allow.split(",").map(s => s.trim()).filter(Boolean);
  return allowed.includes(reqOrigin);
}

function setCors(req, res) {
  const allow = getAllowedOrigin();
  const origin = req.headers?.origin;

  if (allow === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && isOriginAllowed(origin, allow)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function safeParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

async function readRawBody(req, maxBytes = 200_000) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    let buf = "";
    req.on("data", (chunk) => {
      const s = chunk.toString("utf8");
      size += Buffer.byteLength(s, "utf8");
      if (size > maxBytes) return reject(new Error("BODY_TOO_LARGE"));
      buf += s;
    });
    req.on("end", () => resolve(buf));
    req.on("error", (e) => reject(e));
  });
}

function pickModel(engine, include_analysis) {
  const modelDefault = process.env.MODEL_DEFAULT || "gpt-4.1-mini";
  const modelHighRisk = process.env.MODEL_HIGH_RISK || "gpt-4.1";
  const modelAnalysis =
    process.env.MODEL_ANALYSIS ||
    process.env.MODEL_INSIGHT ||
    "gpt-4.1";

  if (include_analysis) return modelAnalysis;
  if (engine?.risk_level === "high") return modelHighRisk;
  return modelDefault;
}

// NOTE: chat/completions + response_format json_object can still return {}.
// We inject hard constraints + forbid empty required fields in prompts to reduce this.
async function openaiChat({
  model,
  system,
  user,
  timeoutMs = 22_000,
  requestId = "",
  temperature = 0.2,
  maxTokens = 900
}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(requestId ? { "X-Request-Id": requestId } : {})
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    const raw = await r.text();
    const data = safeParseJson(raw);

    if (!r.ok) {
      const msg = data?.error?.message || raw.slice(0, 300);
      throw new Error(`OPENAI_FAILED ${r.status} ${msg}`);
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("OPENAI_EMPTY");
    return text;
  } finally {
    clearTimeout(t);
  }
}

function buildPayload(state) {
  const s = state || {};
  const paywall = s?.context?.paywall || s?.paywall || {};
  const pkg = paywall.package || null;

  const ctx = s?.context || {};
  const risk_scan = ctx.risk_scan || s?.risk_scan || {};
  const situation_type = ctx.situation_type || (s?.context_builder?.situation_type) || null;

  const key_facts =
    ctx.key_facts ||
    (s?.context_builder?.key_facts) ||
    s?.facts?.what_happened ||
    "";

  const main_concerns =
    ctx.main_concerns ||
    (s?.context_builder?.main_concerns) ||
    [];

  const constraints =
    ctx.constraints ||
    (s?.context_builder?.constraints) ||
    [];

  const continuity =
    ctx.continuity ??
    s?.continuity ??
    s?.relationship?.continuity ??
    null;

  const happened_before =
    ctx.happened_before ??
    s?.happened_before ??
    s?.signals?.happened_before ??
    null;

  const exposure = ctx.exposure ?? s?.exposure ?? null;
  const leverage_flag = ctx.leverage_flag ?? s?.leverage_flag ?? null;

  const user_intent = s?.intent?.value || s?.intent || null;

  const user_tone =
    s?.user_tone?.value ||
    s?.user_tone ||
    s?.user_tone_hint ||
    s?.strategy?.tone ||
    null;

  const user_depth =
    ctx.depth ||
    s?.depth ||
    s?.strategy?.detail ||
    null;

  const include_analysis = !!(paywall.addon_insight ?? paywall.include_analysis);

  return {
    package: pkg,
    include_analysis,
    input: {
      situation_type,
      risk_scan: {
        impact: risk_scan.impact || null,
        continuity: risk_scan.continuity || null
      },
      continuity,
      happened_before,
      exposure: Array.isArray(exposure) ? exposure : (exposure == null ? null : []),
      leverage_flag: (typeof leverage_flag === "boolean") ? leverage_flag : null,

      key_facts: String(key_facts || ""),
      main_concerns: Array.isArray(main_concerns) ? main_concerns : [],
      constraints: Array.isArray(constraints) ? constraints : [],
      user_intent,
      user_tone,
      user_depth,

      tone:
        s?.tone?.value ||
        s?.tone ||
        s?.strategy?.tone ||
        null,

      detail:
        s?.detail?.value ||
        s?.detail ||
        s?.strategy?.detail ||
        null,

      direction:
        s?.direction?.value ||
        s?.direction ||
        s?.strategy?.direction ||
        null,

      action_objective:
        s?.action_objective?.value ||
        s?.action_objective ||
        s?.strategy?.action_objective ||
        null
    }
  };
}

function resolveFinalControls(payload, engine) {
  const inp = payload?.input || {};
  return {
    tone: inp.tone || engine.tone_recommendation || "neutral",
    detail: inp.detail || engine.detail_recommendation || "standard",
    direction: inp.direction || engine.direction_suggestion || "reset",
    action_objective: inp.action_objective || null
  };
}

function systemPreamble() {
  return [
    "You are ClearBound.",
    "You generate structured communication drafts.",
    "You do not provide advice, do not predict outcomes, do not use legal framing.",
    "Return ONE JSON object only. No markdown. No extra text."
  ].join("\n");
}

function shouldReturnEngine() {
  return String(process.env.RETURN_ENGINE || "").trim() === "1";
}

function isJsonRequest(req) {
  const ct = String(req.headers?.["content-type"] || "").toLowerCase();
  return ct.includes("application/json");
}

// Normalize common alternative keys BEFORE QC so QC doesn't fail on naming drift
function coerceForQc(packageType, obj) {
  const o = (obj && typeof obj === "object") ? obj : {};
  if (packageType === "message") {
    return {
      ...o,
      message_text:
        o.message_text ??
        o.bundle_message_text ??
        o.message ??
        o.text ??
        o.output ??
        null
    };
  }
  if (packageType === "email") {
    return {
      ...o,
      subject: o.subject ?? o.email_subject ?? null,
      email_text:
        o.email_text ??
        o.email ??
        o.text ??
        o.output ??
        null
    };
  }
  if (packageType === "bundle") {
    return {
      ...o,
      bundle_message_text:
        o.bundle_message_text ??
        o.message_text ??
        o.message ??
        null,
      subject: o.subject ?? o.email_subject ?? null,
      email_text:
        o.email_text ??
        o.email ??
        null
    };
  }
  return o;
}

function requiredMessageSentences(detail) {
  return detail === "concise" ? 7 : detail === "standard" ? 8 : 9;
}

function objectiveHints(action_objective) {
  const map = {
    clarify_priority: ["clarify", "priority", "priorities", "order"],
    confirm_expectations: ["confirm", "expectation", "expectations"],
    request_adjustment: ["adjust", "change", "update", "revise"],
    set_boundary: ["boundary", "moving forward", "not able to", "i can't", "i cannot"],
    reduce_scope: ["scope", "reduce", "limit", "narrow"],
    close_loop: ["close", "wrap up", "finalize", "end this"],
    other: ["please", "confirm", "clarify", "review"]
  };
  return map[action_objective] || map.other;
}

// Hard constraint block injected into LLM user message
function buildConstraintsBlock(packageType, controls) {
  const forbidden = [
    "or else", "otherwise i will", "you will regret", "final warning",
    "lawyer", "illegal", "liability", "sue", "court", "police", "restraining order",
    "you always", "you never", "obviously", "you're lying", "you are lying"
  ];

  const objHints = controls?.action_objective ? objectiveHints(controls.action_objective) : [];

  if (packageType === "message") {
    const total = requiredMessageSentences(controls.detail);
    return [
      "OUTPUT CONSTRAINTS (NON-NEGOTIABLE):",
      "- Return ONE JSON object only.",
      '- Use EXACT key: "message_text" (string).',
      "- message_text MUST be non-empty.",
      "- message_text MUST have EXACTLY 3 paragraphs separated by ONE blank line.",
      `- Total sentence count MUST be EXACTLY ${total} sentences.`,
      "- Paragraph sentence counts:",
      "  - P1: 2–3 sentences",
      "  - P2: 3–4 sentences",
      "  - P3: exactly 2 sentences",
      "- Do not include threats, legal framing, or accusations.",
      `- Forbidden phrases include: ${forbidden.join(" | ")}`,
      ...(objHints.length ? [`- Must include at least one objective signal word: ${objHints.join(" / ")}`] : []),
      "- Do NOT return {} or an empty JSON object.",
    ].join("\n");
  }

  if (packageType === "email") {
    return [
      "OUTPUT CONSTRAINTS (NON-NEGOTIABLE):",
      "- Return ONE JSON object only.",
      '- Use EXACT keys: "subject" (string), "email_text" (string).',
      "- subject MUST be 8–80 chars, 4–10 words, no repeated punctuation like !! or ..",
      "- email_text MUST be non-empty.",
      "- email_text MUST have EXACTLY 4 sections separated by ONE blank line.",
      "- Do not include threats, legal framing, or accusations.",
      `- Forbidden phrases include: ${forbidden.join(" | ")}`,
      ...(objHints.length ? [`- Must include at least one objective signal word: ${objHints.join(" / ")}`] : []),
      "- Do NOT return {} or an empty JSON object.",
    ].join("\n");
  }

  // bundle
  const total = requiredMessageSentences(controls.detail);
  return [
    "OUTPUT CONSTRAINTS (NON-NEGOTIABLE):",
    "- Return ONE JSON object only.",
    '- Use EXACT keys: "bundle_message_text" (string), "subject" (string), "email_text" (string).',
    "- bundle_message_text MUST be non-empty and follow message rules:",
    "-  - EXACTLY 3 paragraphs separated by ONE blank line.",
    `-  - Total sentence count EXACTLY ${total} sentences; P1 2–3, P2 3–4, P3 exactly 2.`,
    "- subject MUST be 8–80 chars, 4–10 words, no repeated punctuation like !! or ..",
    "- email_text MUST be non-empty and have EXACTLY 4 sections separated by ONE blank line.",
    "- Do not include threats, legal framing, or accusations.",
    `- Forbidden phrases include: ${forbidden.join(" | ")}`,
    ...(objHints.length ? [`- Must include at least one objective signal word: ${objHints.join(" / ")}`] : []),
    "- Do NOT return {} or an empty JSON object.",
  ].join("\n");
}

function makeRepairInstruction(packageType, issues, failedObj, controls) {
  const schema =
    packageType === "message"
      ? `{"message_text":"(string)"}`
      : packageType === "email"
      ? `{"subject":"(string)","email_text":"(string)"}`
      : `{"bundle_message_text":"(string)","subject":"(string)","email_text":"(string)"}`;

  return [
    "REPAIR TASK:",
    "Return ONE JSON object only.",
    "",
    `PACKAGE: ${packageType}`,
    `REQUIRED JSON SCHEMA EXAMPLE: ${schema}`,
    "",
    "QC ISSUES TO FIX:",
    ...issues.map(x => `- ${x}`),
    "",
    "YOUR PREVIOUS (FAILED) JSON OUTPUT:",
    JSON.stringify(failedObj || {}, null, 2),
    "",
    buildConstraintsBlock(packageType, controls),
    "",
    "NON-NEGOTIABLE:",
    "- Preserve the same intent, facts, and posture.",
    "- Do NOT add threats, legal framing, or accusations.",
    "- Use clean blank lines between paragraphs/sections as required.",
    "- Use the EXACT key names shown in the schema.",
    "- Required fields must be NON-EMPTY strings.",
    "- Do NOT return {}."
  ].join("\n");
}

module.exports = async (req, res) => {
  setCors(req, res);

  const allow = getAllowedOrigin();
  const origin = req.headers?.origin;
  if (allow !== "*" && origin && !isOriginAllowed(origin, allow)) {
    return json(res, 403, { ok: false, error: "ORIGIN_NOT_ALLOWED" });
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!isJsonRequest(req)) {
    return json(res, 415, { ok: false, error: "UNSUPPORTED_MEDIA_TYPE" });
  }

  // Parse body
  let body = req.body;

  if (!body) {
    try {
      const raw = await readRawBody(req);
      body = safeParseJson(raw);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("BODY_TOO_LARGE")) return json(res, 413, { ok: false, error: "BODY_TOO_LARGE" });
      return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "Invalid body" });
    }
  } else if (typeof body === "string") {
    body = safeParseJson(body);
  }

  if (!body || typeof body !== "object") {
    return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "Invalid JSON body" });
  }

  const state = body.state || body;
  const payload = buildPayload(state);

  if (!payload.package) {
    return json(res, 400, { ok: false, error: "MISSING_PACKAGE" });
  }

  // Facts min gate (UI is 40; keep aligned)
  const facts = (payload.input.key_facts || "").trim();
  if (facts.length < 40) {
    return json(res, 400, { ok: false, error: "MISSING_FACTS", message: "Facts too short" });
  }

  // 1) Engine compute
  const engine = computeEngineDecisions({
    risk_scan: payload.input.risk_scan,
    situation_type: payload.input.situation_type,
    main_concerns: payload.input.main_concerns,
    constraints: payload.input.constraints,

    continuity: payload.input.continuity,
    happened_before: payload.input.happened_before,
    exposure: payload.input.exposure,
    leverage_flag: payload.input.leverage_flag
  });

  const controls = resolveFinalControls(payload, engine);
  const model = pickModel(engine, payload.include_analysis);

  // 2) Load prompts (✅ repo has prompts/v2/*)
  const basePath = "prompts/v2";
  const promptPath =
    payload.package === "message" ? `${basePath}/message.prompt.md` :
    payload.package === "email"   ? `${basePath}/email.prompt.md` :
    payload.package === "bundle"  ? `${basePath}/bundle.prompt.md` :
    null;

  if (!promptPath) {
    return json(res, 400, { ok: false, error: "UNKNOWN_PACKAGE" });
  }

  let mainPrompt;
  try {
    mainPrompt = await loadPrompt(promptPath);
  } catch (e) {
    return json(res, 500, { ok: false, error: "PROMPT_LOAD_FAILED", message: String(e?.message || e) });
  }

  // 3) Build LLM input
  const llmInput = {
    package: payload.package,
    include_analysis: payload.include_analysis,
    input: {
      ...payload.input,
      tone: controls.tone,
      detail: controls.detail,
      direction: controls.direction,
      action_objective: controls.action_objective
    },
    engine
  };

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  async function runMainGeneration(userOverride = "", failedObjForRepair = null) {
    const constraintsBlock = buildConstraintsBlock(payload.package, controls);

    const userBlock = userOverride
      ? `${userOverride}\n\n---\n\nPAYLOAD_JSON:\n${JSON.stringify(llmInput)}`
      : `${mainPrompt}\n\n---\n\n${constraintsBlock}\n\n---\n\nPAYLOAD_JSON:\n${JSON.stringify(llmInput)}`;

    const text = await openaiChat({
      model,
      system: systemPreamble(),
      user: userBlock,
      timeoutMs: 22_000,
      requestId,
      temperature: userOverride ? 0 : 0.2,
      maxTokens: 900
    });

    const obj = safeParseJson(text);
    if (!obj || typeof obj !== "object") {
      return { ok: false, error: "MODEL_RETURNED_NON_JSON", raw: String(text || "").slice(0, 1200) };
    }

    // coercion BEFORE QC
    const coerced = coerceForQc(payload.package, obj);

    // Extra sanity: prevent {} success path
    if (payload.package === "message") {
      const mt = (coerced.message_text || "").trim();
      if (!mt) return { ok: true, obj: coerced, rawObj: obj, emptyRequired: true };
    } else if (payload.package === "email") {
      const st = (coerced.subject || "").trim();
      const et = (coerced.email_text || "").trim();
      if (!st || !et) return { ok: true, obj: coerced, rawObj: obj, emptyRequired: true };
    } else {
      const bt = (coerced.bundle_message_text || "").trim();
      const st = (coerced.subject || "").trim();
      const et = (coerced.email_text || "").trim();
      if (!bt || !st || !et) return { ok: true, obj: coerced, rawObj: obj, emptyRequired: true };
    }

    return { ok: true, obj: coerced, rawObj: obj, emptyRequired: false };
  }

  // 4) Main generation call + QC + 1 repair attempt
  let mainObj;
  try {
    const first = await runMainGeneration();
    if (!first.ok) {
      return json(res, 502, { ok: false, error: first.error, message: "Model output was not valid JSON", raw: first.raw });
    }

    let qc1 = validateOutput(payload.package, first.obj, controls);
    if (first.emptyRequired) {
      qc1 = { ok: false, issues: [...(qc1.issues || []), "required_fields_empty_or_missing"] };
    }

    if (qc1.ok) {
      mainObj = first.obj;
    } else {
      const repairInstr = makeRepairInstruction(payload.package, qc1.issues, first.rawObj || first.obj, controls);
      const second = await runMainGeneration(repairInstr, first.rawObj || first.obj);

      if (!second.ok) {
        return json(res, 422, {
          ok: false,
          error: "QC_FAILED",
          message: "QC failed and repair output was not valid JSON",
          issues: qc1.issues
        });
      }

      let qc2 = validateOutput(payload.package, second.obj, controls);
      if (second.emptyRequired) {
        qc2 = { ok: false, issues: [...(qc2.issues || []), "required_fields_empty_or_missing"] };
      }

      if (!qc2.ok) {
        return json(res, 422, {
          ok: false,
          error: "QC_FAILED",
          message: "QC failed after repair",
          issues: qc2.issues
        });
      }

      mainObj = second.obj;
    }
  } catch (e) {
    const msg = String(e?.message || e);
    const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
    return json(res, 502, {
      ok: false,
      error: isTimeout ? "GENERATION_TIMEOUT" : "GENERATION_FAILED",
      message: msg
    });
  }

  // Normalize output for UI
  const out = {
    message_text: mainObj.message_text || mainObj.bundle_message_text || null,
    email_text: mainObj.email_text || null,
    subject: mainObj.subject || null,
    insight: null,
    analysis_text: null
  };

  // 5) Optional Insight call + QC
  if (payload.include_analysis) {
    let insightPrompt;
    try {
      insightPrompt = await loadPrompt(`${basePath}/insight.prompt.md`);
    } catch (e) {
      return json(res, 500, { ok: false, error: "INSIGHT_PROMPT_LOAD_FAILED", message: String(e?.message || e) });
    }

    let insightObj = null;

    try {
      const insightText = await openaiChat({
        model: process.env.MODEL_ANALYSIS || process.env.MODEL_INSIGHT || model,
        system: systemPreamble(),
        user: `${insightPrompt}\n\n---\n\nPAYLOAD_JSON:\n${JSON.stringify(llmInput)}`,
        timeoutMs: 16_000,
        requestId: `${requestId}-insight`,
        temperature: 0.2,
        maxTokens: 900
      });

      const parsed = safeParseJson(insightText);
      if (parsed && typeof parsed === "object") insightObj = parsed;

    } catch (e) {
      const msg = String(e?.message || e);
      const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
      return json(res, 502, {
        ok: false,
        error: isTimeout ? "INSIGHT_TIMEOUT" : "INSIGHT_FAILED",
        message: msg
      });
    }

    const iq = validateInsight(insightObj);
    if (iq.length) {
      return json(res, 422, {
        ok: false,
        error: "INSIGHT_QC_FAILED",
        message: "Insight QC failed",
        issues: iq
      });
    }

    out.insight = insightObj;
    out.analysis_text = JSON.stringify(insightObj, null, 2);
  }

  // Bundle: ensure both exist if provided
  if (payload.package === "bundle") {
    out.message_text = mainObj.bundle_message_text || out.message_text || null;
    out.email_text = mainObj.email_text || out.email_text || null;
  }

  const response = { ok: true, data: out };
  if (shouldReturnEngine()) response.engine = engine;

  return json(res, 200, response);
};
