// api/engine/qc.js
// Premium QC gate: validates JSON schema + structural constraints + forbidden patterns
// If fail: returns { ok:false, issues:[...] }.
// NOTE (v2): relax exact sentence counts into ranges to reduce false fails.
//            keep structure-first, but avoid brittle exact counts.

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

function normalizeNewlines(text) {
  return safeStr(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countSentences(text) {
  // heuristic: split on ., ?, !
  // (kept simple, but now we validate via ranges to reduce brittleness)
  const t = normalizeNewlines(text).replace(/\s+/g, " ").trim();
  if (!t) return 0;
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.length;
}

function splitParagraphs(text) {
  const raw = normalizeNewlines(text);
  if (!raw) return [];
  return raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

function requireObjectivePhrase(action_objective, text) {
  const t = safeStr(text).toLowerCase();
  const map = {
    clarify_priority: ["clarify", "priority", "priorities", "order"],
    confirm_expectations: ["confirm", "expectation", "expectations"],
    request_adjustment: ["adjust", "change", "update", "revise"],
    set_boundary: ["boundary", "moving forward", "not able to", "i can’t", "i cannot", "i can't"],
    reduce_scope: ["scope", "reduce", "limit", "narrow"],
    close_loop: ["close", "wrap up", "finalize", "end this"],
    other: ["please", "confirm", "clarify", "review"]
  };
  const hints = map[action_objective] || map.other;
  return hints.some(h => t.includes(h));
}

function sentenceRange(detail) {
  // Range-based: avoids brittle exact failures
  // concise: 6–8, standard: 7–9, detailed: 8–11
  if (detail === "concise") return { min: 6, max: 8 };
  if (detail === "detailed") return { min: 8, max: 11 };
  return { min: 7, max: 9 }; // standard default
}

function validateMessage({ message_text, meta }, controls) {
  const issues = [];
  const txt = normalizeNewlines(message_text);

  if (!txt) issues.push("message_text missing");

  const bad = containsForbidden(txt);
  if (bad.length) issues.push("forbidden_language: " + bad.join(", "));

  const paras = splitParagraphs(txt);
  if (paras.length !== 3) issues.push("message_paragraphs_must_be_3");

  const total = countSentences(txt);
  const range = sentenceRange(controls.detail);
  if (total < range.min || total > range.max) {
    issues.push(`message_sentence_count_out_of_range_${range.min}_to_${range.max}_got_${total}`);
  }

  // paragraph sentence range checks (relaxed)
  if (paras[0]) {
    const s = countSentences(paras[0]);
    if (s < 1 || s > 3) issues.push("message_p1_sentences_1_to_3");
  }
  if (paras[1]) {
    const s = countSentences(paras[1]);
    if (s < 2 || s > 5) issues.push("message_p2_sentences_2_to_5");
  }
  if (paras[2]) {
    const s = countSentences(paras[2]);
    if (s < 1 || s > 3) issues.push("message_p3_sentences_1_to_3");
  }

  // objective present
  if (controls.action_objective && !requireObjectivePhrase(controls.action_objective, txt)) {
    issues.push("message_missing_action_objective_signal");
  }

  // meta echo (optional)
  if (meta) {
    if (meta.tone && meta.tone !== controls.tone) issues.push("meta_tone_mismatch");
    if (meta.detail && meta.detail !== controls.detail) issues.push("meta_detail_mismatch");
    if (meta.direction && meta.direction !== controls.direction) issues.push("meta_direction_mismatch");
  }

  return issues;
}

function validateEmail({ subject, email_text, meta }, controls) {
  const issues = [];
  const subj = safeStr(subject).trim();
  const txt = normalizeNewlines(email_text);

  if (!subj) issues.push("subject missing");
  if (subj.length < 8 || subj.length > 90) issues.push("subject_length_out_of_range");
  if (/[!?.]{2,}/.test(subj)) issues.push("subject_excess_punctuation");
  // keep but slightly relax
  const wc = subj.split(/\s+/).filter(Boolean).length;
  if (wc < 3 || wc > 12) issues.push("subject_word_count_out_of_range");

  if (!txt) issues.push("email_text missing");

  const bad = containsForbidden(txt);
  if (bad.length) issues.push("forbidden_language: " + bad.join(", "));

  // Must have exactly 4 sections separated by blank lines
  const sections = splitParagraphs(txt);
  if (sections.length !== 4) issues.push("email_sections_must_be_4");

  // objective present
  if (controls.action_objective && !requireObjectivePhrase(controls.action_objective, txt)) {
    issues.push("email_missing_action_objective_signal");
  }

  if (meta) {
    if (meta.tone && meta.tone !== controls.tone) issues.push("meta_tone_mismatch");
    if (meta.detail && meta.detail !== controls.detail) issues.push("meta_detail_mismatch");
    if (meta.direction && meta.direction !== controls.direction) issues.push("meta_direction_mismatch");
  }

  return issues;
}

function validateInsight(insightObj) {
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
    if (!t) issues.push(`insight_section_${idx + 1}_title_missing`);
    if (bullets.length !== 3) issues.push(`insight_section_${idx + 1}_bullets_must_be_3`);
  });
  if (!disc) issues.push("insight_disclaimer_missing");

  const all = JSON.stringify(insightObj).toLowerCase();
  if (!all.includes("signals")) issues.push("insight_must_include_word_signals");

  return issues;
}

function validateOutput(packageType, obj, controls) {
  const issues = [];

  if (!obj || typeof obj !== "object") return { ok: false, issues: ["output_not_object"] };

  if (packageType === "message") {
    issues.push(...validateMessage(obj, controls));
  } else if (packageType === "email") {
    issues.push(...validateEmail(obj, controls));
  } else if (packageType === "bundle") {
    const msgIssues = validateMessage({ message_text: obj.bundle_message_text, meta: obj.meta }, controls);
    if (msgIssues.length) issues.push(...msgIssues.map(x => "bundle_message: " + x));
    const emailIssues = validateEmail({ subject: obj.subject, email_text: obj.email_text, meta: obj.meta }, controls);
    if (emailIssues.length) issues.push(...emailIssues.map(x => "bundle_email: " + x));
  } else {
    issues.push("unknown_package_type");
  }

  return { ok: issues.length === 0, issues };
}

module.exports = { validateOutput, validateInsight };
