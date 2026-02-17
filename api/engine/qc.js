// api/engine/qc.js
// Premium QC gate (stabilized):
// - Keep: forbidden language, paragraph/section structure, objective signal
// - Relax: exact sentence counts -> range-based (prevents flaky QC fails)
// - Better: sentence splitting + whitespace normalization
// If fail: returns { ok:false, issues:[...] }.

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

// More stable sentence count heuristic:
// - normalize whitespace
// - count end punctuation .,!,? as sentence boundaries
// - ignore empty fragments
function countSentences(text) {
  const t = safeStr(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!t) return 0;

  // split on end punctuation followed by space/newline OR end of string
  const parts = t.split(/(?<=[.!?])(?:\s+|$)/).map(s => s.trim()).filter(Boolean);
  return parts.length;
}

function splitParagraphs(text) {
  const raw = safeStr(text)
    .replace(/\r\n/g, "\n")
    .trim();
  if (!raw) return [];
  return raw
    .split(/\n\s*\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function requireObjectivePhrase(action_objective, text) {
  const t = safeStr(text).toLowerCase();

  const map = {
    clarify_priority: ["clarify", "priority", "priorities", "order"],
    confirm_expectations: ["confirm", "expectation", "expectations", "align"],
    request_adjustment: ["adjust", "change", "update", "revise"],
    set_boundary: ["boundary", "moving forward", "not able to", "i can’t", "i can't", "i cannot"],
    reduce_scope: ["scope", "reduce", "limit", "narrow"],
    close_loop: ["close", "wrap up", "finalize", "end this"],
    other: ["please", "confirm", "clarify", "review"]
  };

  const hints = map[action_objective] || map.other;
  // require at least one hint
  return hints.some(h => t.includes(h));
}

// Range policy (instead of exact counts):
// - concise: total 6–8
// - standard: total 7–10
// - detailed: total 9–13
function requiredSentenceRange(detail) {
  if (detail === "concise") return { min: 6, max: 8 };
  if (detail === "detailed") return { min: 9, max: 13 };
  return { min: 7, max: 10 }; // standard
}

// Paragraph sentence range checks (message):
// P1: 1–3, P2: 2–5, P3: 1–3
// (keeps 3-paragraph rhythm but avoids brittle failures)
function validateMessage({ message_text, meta }, controls) {
  const issues = [];
  const txt = safeStr(message_text).trim();

  if (!txt) issues.push("message_text missing");

  const bad = containsForbidden(txt);
  if (bad.length) issues.push("forbidden_language: " + bad.join(", "));

  const paras = splitParagraphs(txt);
  if (paras.length !== 3) issues.push("message_paragraphs_must_be_3");

  const total = countSentences(txt);
  const { min, max } = requiredSentenceRange(controls.detail);
  if (total < min || total > max) issues.push(`message_sentence_count_out_of_range_${min}_to_${max}_got_${total}`);

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

  if (controls.action_objective && !requireObjectivePhrase(controls.action_objective, txt)) {
    issues.push("message_missing_action_objective_signal");
  }

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
  const txt = safeStr(email_text).trim();

  if (!subj) issues.push("subject missing");
  if (subj.length < 8 || subj.length > 80) issues.push("subject_length_out_of_range");
  if (/[!?.]{2,}/.test(subj)) issues.push("subject_excess_punctuation");
  if (subj.split(/\s+/).length < 4 || subj.split(/\s+/).length > 12) issues.push("subject_word_count_out_of_range");

  if (!txt) issues.push("email_text missing");

  const bad = containsForbidden(txt);
  if (bad.length) issues.push("forbidden_language: " + bad.join(", "));

  // Must have exactly 4 sections separated by blank lines (keep strict)
  const sections = splitParagraphs(txt);
  if (sections.length !== 4) issues.push("email_sections_must_be_4");

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

  // Must include word "signals" at least once (per prompt)
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
    issues.push("unknown_package");
  }

  return { ok: issues.length === 0, issues };
}

module.exports = { validateOutput, validateInsight };
