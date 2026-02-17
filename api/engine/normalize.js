// api/engine/normalize.js
// v2 canonical input normalization for ClearBound RSE (Relationship Strategy Engine)

function clampStr(v) {
  return (typeof v === "string" && v.trim()) ? v.trim() : null;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function normToken(v) {
  const s = clampStr(v);
  return s ? s.toLowerCase() : null;
}

function normTokens(arr) {
  return asArray(arr).map(normToken).filter(Boolean);
}

/**
 * v2 input contract (expected):
 * input = {
 *   target: { recipient_type, power_balance, formality },
 *   relationship: { importance, continuity },
 *   signals: { feels_off[], impact_signals[], happened_before },
 *   facts: { what_happened, key_refs? },
 *   strategy: { direction, action_objective, tone, detail },
 *   paywall: { package, addon_insight }
 * }
 */
function normalizeV2(input) {
  const s = input || {};

  const target = s.target || {};
  const relationship = s.relationship || {};
  const signals = s.signals || {};
  const facts = s.facts || {};
  const strategy = s.strategy || {};
  const paywall = s.paywall || {};

  const recipient_type = normToken(target.recipient_type); // supervisor|client|peer|subordinate|family|other
  const power_balance = normToken(target.power_balance);   // they_above|equal|i_above|informal_influence
  const formality = normToken(target.formality);           // formal|neutral|informal

  const importance = normToken(relationship.importance);   // very_high|high|medium|low
  const continuity = normToken(relationship.continuity);   // ongoing|short_term|one_time

  const feels_off = normTokens(signals.feels_off).slice(0, 2);
  const impact_signals = normTokens(signals.impact_signals).slice(0, 2);
  const happened_before =
    (typeof signals.happened_before === "boolean") ? signals.happened_before : null;

  const what_happened = String(facts.what_happened || "");
  const key_refs = clampStr(facts.key_refs) || null; // optional short string for dates/ids

  const direction = normToken(strategy.direction);   // maintain|reset|disengage|unsure
  const action_objective = normToken(strategy.action_objective); // clarify_priority|confirm_expectations|...
  const tone = normToken(strategy.tone);             // calm|neutral|firm|formal
  const detail = normToken(strategy.detail);         // concise|standard|detailed

  const pkg = normToken(paywall.package);            // message|email|bundle
  const addon_insight = !!paywall.addon_insight;

  return {
    target: { recipient_type, power_balance, formality },
    relationship: { importance, continuity },
    signals: { feels_off, impact_signals, happened_before },
    facts: { what_happened, key_refs },
    strategy: { direction, action_objective, tone, detail },
    paywall: { package: pkg, addon_insight }
  };
}

module.exports = { normalizeV2 };
