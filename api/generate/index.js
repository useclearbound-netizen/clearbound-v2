// api/generate/index.js
// ClearBound v2 — Premium RSE endpoint
// - strict CORS gate
// - robust JSON parsing
// - prompt repo support
// - JSON-only enforcement
// - QC gate + optional single rewrite attempt
// - insight returns as object

const { computeEngineDecisions } = require("../engine/compute");
const { validateOutput, validateInsight } = require("../engine/qc");
const { loadPrompt } = require("../engine/promptLoader");
const { normalizeV2 } = require("../engine/normalize");

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
  if (!reqOrigin) return true;
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

async function readRawBody(req, maxBytes = 220_000) {
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

function isJsonRequest(req) {
  const ct = String(req.headers?.["content-type"] || "").toLowerCase();
  return ct.includes("application/json");
}

function pickModel({ include_insight, engine }) {
  const modelDefault = process.env.MODEL_DEFAULT || "gpt-4.1-mini";
  const modelHigh = process.env.MODEL_HIGH_RISK || "gpt-4.1";
  const modelInsight = process.env.MODEL_INSIGHT || "gpt-4.1";

  if (include_insight) return modelInsight;
  if (engine?.risk_level === "high") return modelHigh;
  return modelDefault;
}

function systemPreamble() {
  return [
    "You are ClearBound.",
    "You generate structured communication drafts.",
    "You do not provide advice, do not predict outcomes, do not use legal framing.",
    "Return ONE JSON object only. No markdown. No extra text."
  ].join("\n");
}

async function openaiChat({ model, system, user, timeoutMs = 22_000, requestId = "" }) {
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
        temperature: 0.2,
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

function requireFields(n) {
  const errs = [];

  if (!n.paywall.package) errs.push("MISSING_PACKAGE");
  if (!n.target.recipient_type) errs.push("MISSING_RECIPIENT_TYPE");
  if (!n.target.power_balance) errs.push("MISSING_POWER_BALANCE");
  if (!n.relationship.importance) errs.push("MISSING_REL_IMPORTANCE");
  if (!n.relationship.continuity) errs.push("MISSING_REL_CONTINUITY");

  const facts = (n.facts.what_happened || "").trim();
  if (facts.length < 40) errs.push("FACTS_TOO_SHORT");

  if (!n.strategy.direction) errs.push("MISSING_DIRECTION");
  if (!n.strategy.action_objective) errs.push("MISSING_ACTION_OBJECTIVE");
  if (!n.strategy.tone) errs.push("MISSING_TONE");
  if (!n.strategy.detail) errs.push("MISSING_DETAIL");

  return errs;
}

function resolveControls(n, engine) {
  const direction =
    (n.strategy.direction === "unsure" || !n.strategy.direction)
      ? engine.direction_suggestion
      : n.strategy.direction;

  const tone = n.strategy.tone || engine.tone_recommendation;
  const detail = n.strategy.detail || engine.detail_recommendation;

  return {
    direction,
    tone,
    detail,
    action_objective: n.strategy.action_objective
  };
}

function promptPathForPackage(pkg) {
  const base = "prompts/v2";
  if (pkg === "message") return `${base}/message.prompt.md`;
  if (pkg === "email") return `${base}/email.prompt.md`;
  if (pkg === "bundle") return `${base}/bundle.prompt.md`;
  return null;
}

// Repair prompt (inline, so v2 is fully operational even if prompts repo missing repair file)
function buildRepairInstruction(issues) {
  return [
    "Your previous JSON failed QC.",
    "You must return a corrected JSON object only.",
    "Fix ONLY what is needed to satisfy QC. Do not add new facts.",
    "QC_ISSUES:",
    ...issues.map(x => `- ${x}`)
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

  // Accept { state: ... } or raw state
  const state = body.state || body;

  // Normalize + required fields gate
  const n = normalizeV2(state);

  const missing = requireFields(n);
  if (missing.length) {
    return json(res, 400, { ok: false, error: "MISSING_FIELDS", missing });
  }

  // Engine compute (deterministic)
  const engine = computeEngineDecisions(state);

  // Resolve final controls
  const controls = resolveControls(n, engine);

  const include_insight = !!n.paywall.addon_insight;
  const model = pickModel({ include_insight, engine });

  const pkg = n.paywall.package;
  const pPath = promptPathForPackage(pkg);
  if (!pPath) return json(res, 400, { ok: false, error: "UNKNOWN_PACKAGE" });

  // Load prompt
  let mainPrompt;
  try {
    mainPrompt = await loadPrompt(pPath);
  } catch (e) {
    return json(res, 500, { ok: false, error: "PROMPT_LOAD_FAILED", message: String(e?.message || e) });
  }

  // Build LLM payload
  const llmInput = {
    package: pkg,
    include_insight,
    input: {
      target: n.target,
      relationship: n.relationship,
      signals: n.signals,
      facts: n.facts,
      strategy: {
        direction: controls.direction,
        action_objective: controls.action_objective,
        tone: controls.tone,
        detail: controls.detail
      }
    },
    engine: {
      risk_level: engine.risk_level,
      record_safe_level: engine.record_safe_level,
      power_index: engine.power_index,
      boundary_strength: engine.boundary_strength,
      escalation_ceiling: engine.escalation_ceiling,
      posture_profile: engine.posture_profile,
      tone_recommendation: engine.tone_recommendation,
      detail_recommendation: engine.detail_recommendation,
      direction_suggestion: engine.direction_suggestion,
      insight_candor_level: engine.insight_candor_level,
      constraints: engine.constraints
    }
  };

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  async function runMainCall(userPrompt) {
    const text = await openaiChat({
      model,
      system: systemPreamble(),
      user: userPrompt,
      timeoutMs: 22_000,
      requestId
    });
    const obj = safeParseJson(text);
    return { text, obj };
  }

  // Main generation attempt
  let mainText, mainObj;
  try {
    const u = `${mainPrompt}\n\n---\n\nPAYLOAD_JSON:\n${JSON.stringify(llmInput)}`;
    const r = await runMainCall(u);
    mainText = r.text;
    mainObj = r.obj;
  } catch (e) {
    const msg = String(e?.message || e);
    const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
    return json(res, 502, {
      ok: false,
      error: isTimeout ? "GENERATION_TIMEOUT" : "GENERATION_FAILED",
      message: msg
    });
  }

  if (!mainObj || typeof mainObj !== "object") {
    return json(res, 502, {
      ok: false,
      error: "MODEL_RETURNED_NON_JSON",
      message: "Model output was not valid JSON",
      raw: String(mainText || "").slice(0, 1200)
    });
  }

  // QC pass
  const qc1 = validateOutput(pkg, mainObj, {
    tone: controls.tone,
    detail: controls.detail,
    direction: controls.direction,
    action_objective: controls.action_objective
  });

  // One repair attempt if QC fails
  if (!qc1.ok) {
    try {
      const repairNote = buildRepairInstruction(qc1.issues);
      const repairUser = [
        mainPrompt,
        "\n\n---\n\nPAYLOAD_JSON:\n" + JSON.stringify(llmInput),
        "\n\n---\n\nREPAIR_INSTRUCTION:\n" + repairNote,
        "\n\n---\n\nPREVIOUS_JSON:\n" + JSON.stringify(mainObj)
      ].join("");

      const r2 = await runMainCall(repairUser);
      const obj2 = r2.obj;

      if (!obj2 || typeof obj2 !== "object") {
        return json(res, 502, { ok: false, error: "QC_REPAIR_NON_JSON", issues: qc1.issues });
      }

      const qc2 = validateOutput(pkg, obj2, {
        tone: controls.tone,
        detail: controls.detail,
        direction: controls.direction,
        action_objective: controls.action_objective
      });

      if (!qc2.ok) {
        return json(res, 502, { ok: false, error: "QC_FAILED", issues: qc2.issues });
      }

      mainObj = obj2;
    } catch (e) {
      return json(res, 502, { ok: false, error: "QC_REPAIR_FAILED", issues: qc1.issues, message: String(e?.message || e) });
    }
  }

  // Normalize output payload for UI
  const out = {
    message_text: null,
    email_text: null,
    subject: null,
    insight: null
  };

  if (pkg === "message") {
    out.message_text = String(mainObj.message_text || "").trim();
  } else if (pkg === "email") {
    out.subject = String(mainObj.subject || "").trim();
    out.email_text = String(mainObj.email_text || "").trim();
  } else if (pkg === "bundle") {
    out.message_text = String(mainObj.bundle_message_text || "").trim();
    out.subject = String(mainObj.subject || "").trim();
    out.email_text = String(mainObj.email_text || "").trim();
  }

  // Optional Insight call
  if (include_insight) {
    let insightPrompt;
    try {
      insightPrompt = await loadPrompt("prompts/v2/insight.prompt.md");
    } catch (e) {
      return json(res, 500, { ok: false, error: "INSIGHT_PROMPT_LOAD_FAILED", message: String(e?.message || e) });
    }

    let insightText, insightObj;
    try {
      insightText = await openaiChat({
        model: process.env.MODEL_INSIGHT || model,
        system: systemPreamble(),
        user: `${insightPrompt}\n\n---\n\nPAYLOAD_JSON:\n${JSON.stringify(llmInput)}`,
        timeoutMs: 16_000,
        requestId: `${requestId}-insight`
      });
      insightObj = safeParseJson(insightText);
    } catch (e) {
      const msg = String(e?.message || e);
      const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
      return json(res, 502, { ok: false, error: isTimeout ? "INSIGHT_TIMEOUT" : "INSIGHT_FAILED", message: msg });
    }

    if (!insightObj || typeof insightObj !== "object") {
      insightObj = {
        insight_title: "Strategic Insight",
        insight_sections: [],
        disclaimer_line: String(insightText || "")
      };
    }

    const iqc = validateInsight(insightObj);
    if (iqc.length) {
      // do not fail generation; degrade gracefully
      insightObj = {
        insight_title: "Strategic Insight",
        insight_sections: [
          { title: "Signals observed", bullets: ["Signals were recorded for context only.", "No intent is assumed.", "No outcomes are implied."] },
          { title: "Positioning choice", bullets: ["The structure stays procedural.", "The request is kept singular.", "Tone remains consistent."] },
          { title: "Structural effect", bullets: ["It reduces ambiguity.", "It creates a stable reference point.", "It supports clear next steps."] }
        ],
        disclaimer_line: "This insight reflects interaction signals and structure choices, not outcomes or advice."
      };
    }

    out.insight = insightObj;
  }

  return json(res, 200, {
    ok: true,
    data: out,
    engine: (String(process.env.RETURN_ENGINE || "").trim() === "1") ? engine : undefined
  });
};
