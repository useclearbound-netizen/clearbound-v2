// api/engine/qc.js
// A-Mode QC: hard constraints only for reliability.
// - Hard fail: missing required fields, forbidden language, wrong paragraph/section count.
// - Soft warn: sentence counts, paragraph distributions, objective signal, subject micro-rules.
// Returns: { ok:boolean, issues:string[], warnings:string[] }

function safeStr(v) {
  return (typeof v === "string") ? v : "";
}

const FORBIDDEN = [
  // threats / ultimatums
  "or else", "otherwise i will", "you will regret", "final warning",
  // legal framing
  "lawyer", "illegal", "liability", "sue", "court", "police", "restraining order",
  // blame absolutes
  "you always", "you never", "obviously", "you're lying", "you are lying"
];

function containsForbidden(text) {
  const t = safeStr(text).toLowerCase();
  return FORBIDDEN.filter(w => t.includes(w));
}

function countSentences(text) {
  const t = safeStr(text).replace(/\s+/g, " ").trim();
  if (!t) return 0;
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.length;
}

function splitParagraphs(text) {
  const raw = safeStr(text).trim();
  if (!raw) return [];
  return raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

function requireObjectivePhrase(action_objective, text) {
  if (!action_objective) return true; // if unknown, don't enforce
  const t = safeStr(text).toLowerCase();
  const map = {
    clarify_priority: ["clarify", "priority", "priorities", "order"],
    confirm_expectations: ["confirm", "expectation", "expectations"],
    request_adjustment: ["adjust", "change", "update", "revise"],
    set_boundary: ["boundary", "moving forward", "not able to", "i can’t", "i cannot", "i'm not able", "i am not able"],
    reduce_scope: ["scope", "reduce", "limit", "narrow"],
    close_loop: ["close", "wrap up", "finalize", "end this"],
    other: ["please", "confirm", "clarify", "review"]
  };
  const hints = map[action_objective] || map.other;
  return hints.some(h => t.includes(h));
}

function validateMessage(obj, controls) {
  const issues = [];
  const warnings = [];

  const txt = safeStr(obj?.message_text).trim();
  if (!txt) issues.push("message_text missing");

  if (txt) {
    const bad = containsForbidden(txt);
    if (bad.length) issues.push("forbidden_language: " + bad.join(", "));

    const paras = splitParagraphs(txt);
    if (paras.length !== 3) issues.push("message_paragraphs_must_be_3");

    // Soft: sentence count and distribution (no longer hard fail)
    const total = countSentences(txt);
    const detail = controls?.detail || "standard";

    // ranges (soft)
    const range =
      detail === "concise" ? [6, 8] :
      detail === "standard" ? [7, 9] :
      [8, 11];

    if (total < range[0] || total > range[1]) {
      warnings.push(`message_sentence_count_out_of_range_${range[0]}_to_${range[1]}_got_${total}`);
    }

    if (paras[0]) {
      const s = countSentences(paras[0]);
      if (s < 1 || s > 4) warnings.push("message_p1_sentence_count_suggest_1_to_4");
    }
    if (paras[1]) {
      const s = countSentences(paras[1]);
      if (s < 2 || s > 6) warnings.push("message_p2_sentence_count_suggest_2_to_6");
    }
    if (paras[2]) {
      const s = countSentences(paras[2]);
      if (s < 1 || s > 4) warnings.push("message_p3_sentence_count_suggest_1_to_4");
    }

    // Soft: objective signal (warn only)
    if (controls?.action_objective && !requireObjectivePhrase(controls.action_objective, txt)) {
      warnings.push("message_missing_action_objective_signal");
    }
  }

  // meta echo is soft only
  const meta = obj?.meta;
  if (meta && typeof meta === "object") {
    if (meta.tone && controls?.tone && meta.tone !== controls.tone) warnings.push("meta_tone_mismatch");
    if (meta.detail && controls?.detail && meta.detail !== controls.detail) warnings.push("meta_detail_mismatch");
    if (meta.direction && controls?.direction && meta.direction !== controls.direction) warnings.push("meta_direction_mismatch");
  }

  return { issues, warnings };
}

function validateEmail(obj, controls) {
  const issues = [];
  const warnings = [];

  const subj = safeStr(obj?.subject).trim();
  const txt = safeStr(obj?.email_text).trim();

  if (!subj) issues.push("subject missing");
  if (!txt) issues.push("email_text missing");

  if (subj) {
    // Soft subject rules (warn only; avoid failing production)
    if (subj.length < 6 || subj.length > 120) warnings.push("subject_length_suspicious");
    if (/[!?.]{2,}/.test(subj)) warnings.push("subject_excess_punctuation");
  }

  if (txt) {
    const bad = containsForbidden(txt);
    if (bad.length) issues.push("forbidden_language: " + bad.join(", "));

    // Hard: exactly 4 sections separated by blank lines
    const sections = splitParagraphs(txt);
    if (sections.length !== 4) issues.push("email_sections_must_be_4");

    // Soft objective signal
    if (controls?.action_objective && !requireObjectivePhrase(controls.action_objective, txt)) {
      warnings.push("email_missing_action_objective_signal");
    }
  }

  const meta = obj?.meta;
  if (meta && typeof meta === "object") {
    if (meta.tone && controls?.tone && meta.tone !== controls.tone) warnings.push("meta_tone_mismatch");
    if (meta.detail && controls?.detail && meta.detail !== controls.detail) warnings.push("meta_detail_mismatch");
    if (meta.direction && controls?.direction && meta.direction !== controls.direction) warnings.push("meta_direction_mismatch");
  }

  return { issues, warnings };
}

function validateInsight(insightObj) {
  // Keep as-is (hard), but you can soften later if needed
  const issues = [];
  if (!insightObj || typeof insightObj !== "object") return ["insight_object_missing"];

  const title = safeStr(insightObj.insight_title).trim();
  const sections = Array.isArray(insightObj.insight_sections) ? insightObj.insight_sections : [];
  const disc = safeStr(insightObj.disclaimer_line).trim();

  if (!title) issues.push("insight_title_missing");
  if (sections.length !== 3) issues.push("insight_sections_must_be_3");
  sections.forEach((sec, idx) => {
    const t = safeStr(sec?.title).trim();
    const bullets = Array.isArray(sec?.bullets) ? sec.bullets : [];
    if (!t) issues.push(`insight_section_${idx+1}_title_missing`);
    if (bullets.length !== 3) issues.push(`insight_section_${idx+1}_bullets_must_be_3`);
  });
  if (!disc) issues.push("insight_disclaimer_missing");

  const all = JSON.stringify(insightObj).toLowerCase();
  if (!all.includes("signals")) issues.push("insight_must_include_word_signals");

  return issues;
}

function validateOutput(packageType, obj, controls) {
  const issues = [];
  const warnings = [];

  if (!obj || typeof obj !== "object") {
    return { ok: false, issues: ["output_not_object"], warnings: [] };
  }

  if (packageType === "message") {
    const r = validateMessage(obj, controls);
    issues.push(...r.issues);
    warnings.push(...r.warnings);
  } else if (packageType === "email") {
    const r = validateEmail(obj, controls);
    issues.push(...r.issues);
    warnings.push(...r.warnings);
  } else if (packageType === "bundle") {
    // bundle expects both hard sets
    const msg = validateMessage({ message_text: obj.bundle_message_text, meta: obj.meta }, controls);
    if (msg.issues.length) issues.push(...msg.issues.map(x => "bundle_message: " + x));
    if (msg.warnings.length) warnings.push(...msg.warnings.map(x => "bundle_message: " + x));

    const em = validateEmail({ subject: obj.subject, email_text: obj.email_text, meta: obj.meta }, controls);
    if (em.issues.length) issues.push(...em.issues.map(x => "bundle_email: " + x));
    if (em.warnings.length) warnings.push(...em.warnings.map(x => "bundle_email: " + x));
  }

  return { ok: issues.length === 0, issues, warnings };
}

module.exports = { validateOutput, validateInsight };
