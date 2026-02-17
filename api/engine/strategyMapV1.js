// api/engine/strategyMapV1.js
// Strategy Map v1 (Deterministic + Explainable)
// Outputs: 5 Failure Modes + overall tier + presets + drivers[]

function clamp(n, min = 0, max = 100) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function tierOf(score) {
  if (score >= 75) return "extreme";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function maxTier(tiers) {
  const order = { low: 0, medium: 1, high: 2, extreme: 3 };
  return tiers.reduce((a, b) => (order[b] > order[a] ? b : a), "low");
}

function presetsByTier(tier) {
  // v1 mapping (LOCK)
  const tone_ceiling = ({ low: "warm", medium: "neutral", high: "firm", extreme: "hard" })[tier];
  const disclosure_level = ({ low: "open", medium: "bounded", high: "minimal", extreme: "minimal" })[tier];
  const documentation_sensitivity = ({ low: "prefer", medium: "cautious", high: "cautious", extreme: "avoid" })[tier];
  const structure_mode = ({ low: "structured", medium: "structured", high: "formal", extreme: "formal" })[tier];
  const cta_intensity = ({ low: "normal", medium: "normal", high: "soft", extreme: "none" })[tier];

  return { tone_ceiling, disclosure_level, documentation_sensitivity, structure_mode, cta_intensity };
}

function applyModeOverrides(presets, scores) {
  // Critical overrides (LOCK v1)
  const out = { ...presets };

  if (scores.admission_risk >= 60) out.disclosure_level = "minimal";
  if (scores.misinterpretation_risk >= 60) out.structure_mode = "formal";
  if (scores.escalation_risk >= 60 && out.tone_ceiling === "warm") out.tone_ceiling = "neutral";
  if (scores.relationship_break_risk >= 60) {
    // downgrade CTA one level
    if (out.cta_intensity === "normal") out.cta_intensity = "soft";
    else if (out.cta_intensity === "soft") out.cta_intensity = "none";
  }

  return out;
}

function addDriver(drivers, { source_signal, affected_mode, delta, reason }) {
  drivers.push({
    type: "rule",
    source_signal,
    affected_mode,
    delta,
    reason
  });
}

function computeModeScores(signals) {
  const drivers = [];

  let escalation = 0;
  let misinterpretation = 0;
  let documentation = 0;
  let relationship = 0;
  let admission = 0;

  // --- Escalation Risk ---
  if (signals.emotional_volatility === "high") {
    escalation += 25; addDriver(drivers, { source_signal: "emotional_volatility=high", affected_mode: "escalation_risk", delta: 25, reason: "High volatility increases escalation probability." });
  }
  if (signals.continuity === "high") {
    escalation += 20; addDriver(drivers, { source_signal: "continuity=high", affected_mode: "escalation_risk", delta: 20, reason: "Ongoing interaction increases escalation probability." });
  }
  if (signals.prior_conflict === true) {
    escalation += 15; addDriver(drivers, { source_signal: "prior_conflict=true", affected_mode: "escalation_risk", delta: 15, reason: "Prior conflict raises escalation likelihood." });
  }
  if (signals.urgency_level === "high") {
    escalation += 15; addDriver(drivers, { source_signal: "urgency_level=high", affected_mode: "escalation_risk", delta: 15, reason: "High urgency tends to compress tone control." });
  }
  if (signals.power_asymmetry === true) {
    escalation += 10; addDriver(drivers, { source_signal: "power_asymmetry=true", affected_mode: "escalation_risk", delta: 10, reason: "Power imbalance increases escalation sensitivity." });
  }

  // --- Misinterpretation Risk ---
  if (signals.audience_multiparty === true) {
    misinterpretation += 20; addDriver(drivers, { source_signal: "audience_multiparty=true", affected_mode: "misinterpretation_risk", delta: 20, reason: "More observers increase misreading risk." });
  }
  if (signals.emotional_volatility === "high") {
    misinterpretation += 15; addDriver(drivers, { source_signal: "emotional_volatility=high", affected_mode: "misinterpretation_risk", delta: 15, reason: "High volatility increases ambiguity and misreads." });
  }
  if (signals.relationship_axis === "peripheral") {
    misinterpretation += 15; addDriver(drivers, { source_signal: "relationship_axis=peripheral", affected_mode: "misinterpretation_risk", delta: 15, reason: "Lower shared context increases misinterpretation risk." });
  }
  if (signals.written_record_expected === true) {
    misinterpretation += 10; addDriver(drivers, { source_signal: "written_record_expected=true", affected_mode: "misinterpretation_risk", delta: 10, reason: "Written records amplify interpretation and replay." });
  }
  if (signals.urgency_level === "high") {
    misinterpretation += 10; addDriver(drivers, { source_signal: "urgency_level=high", affected_mode: "misinterpretation_risk", delta: 10, reason: "Urgency reduces clarity and increases misreads." });
  }

  // --- Documentation Backfire Risk ---
  if (signals.written_record_expected === true) {
    documentation += 30; addDriver(drivers, { source_signal: "written_record_expected=true", affected_mode: "documentation_backfire_risk", delta: 30, reason: "Documentation increases record-based blowback risk." });
  }
  if (signals.legal_or_liability_context === true) {
    documentation += 25; addDriver(drivers, { source_signal: "legal_or_liability_context=true", affected_mode: "documentation_backfire_risk", delta: 25, reason: "Liability context increases documentation backfire risk." });
  }
  if (signals.power_asymmetry === true) {
    documentation += 10; addDriver(drivers, { source_signal: "power_asymmetry=true", affected_mode: "documentation_backfire_risk", delta: 10, reason: "Power imbalance increases documentation sensitivity." });
  }

  // --- Relationship Break Risk ---
  if (signals.relationship_axis === "intimate") {
    relationship += 25; addDriver(drivers, { source_signal: "relationship_axis=intimate", affected_mode: "relationship_break_risk", delta: 25, reason: "Intimate relationships have higher rupture stakes." });
  } else if (signals.relationship_axis === "personal") {
    relationship += 20; addDriver(drivers, { source_signal: "relationship_axis=personal", affected_mode: "relationship_break_risk", delta: 20, reason: "Personal relationships increase rupture sensitivity." });
  }
  if (signals.prior_conflict === true) {
    relationship += 15; addDriver(drivers, { source_signal: "prior_conflict=true", affected_mode: "relationship_break_risk", delta: 15, reason: "Prior conflict increases break risk." });
  }
  if (signals.continuity === "high") {
    relationship += 10; addDriver(drivers, { source_signal: "continuity=high", affected_mode: "relationship_break_risk", delta: 10, reason: "Ongoing continuity raises relationship stakes." });
  }

  // --- Admission Risk ---
  if (signals.legal_or_liability_context === true) {
    admission += 35; addDriver(drivers, { source_signal: "legal_or_liability_context=true", affected_mode: "admission_risk", delta: 35, reason: "Liability context increases admission risk." });
  }
  if (signals.written_record_expected === true) {
    admission += 20; addDriver(drivers, { source_signal: "written_record_expected=true", affected_mode: "admission_risk", delta: 20, reason: "Written records increase admission exposure." });
  }
  if (signals.power_asymmetry === true) {
    admission += 15; addDriver(drivers, { source_signal: "power_asymmetry=true", affected_mode: "admission_risk", delta: 15, reason: "Power imbalance increases admission consequences." });
  }
  if (signals.relationship_axis === "peripheral") {
    admission += 10; addDriver(drivers, { source_signal: "relationship_axis=peripheral", affected_mode: "admission_risk", delta: 10, reason: "Peripheral relationships increase formality and admission exposure." });
  }

  // Derived influence: escalation >= 60 → relationship +15
  if (escalation >= 60) {
    relationship += 15;
    addDriver(drivers, { source_signal: "derived:escalation>=60", affected_mode: "relationship_break_risk", delta: 15, reason: "High escalation elevates relationship break risk." });
  }

  const scores = {
    escalation_risk: clamp(escalation),
    misinterpretation_risk: clamp(misinterpretation),
    documentation_backfire_risk: clamp(documentation),
    relationship_break_risk: clamp(relationship),
    admission_risk: clamp(admission)
  };

  return { scores, drivers };
}

function computeOverallTier(scores) {
  const tiers = Object.values(scores).map(tierOf);
  let overall = maxTier(tiers);

  // Override rules (LOCK v1)
  if (scores.admission_risk >= 75) overall = "extreme";
  if (scores.documentation_backfire_risk >= 75) overall = "extreme";
  if (scores.escalation_risk >= 75 && scores.relationship_break_risk >= 50) overall = "extreme";

  return overall;
}

function computeStrategyMapV1(signals) {
  const { scores, drivers } = computeModeScores(signals);

  const modes = {
    escalation_risk: { score: scores.escalation_risk, tier: tierOf(scores.escalation_risk) },
    misinterpretation_risk: { score: scores.misinterpretation_risk, tier: tierOf(scores.misinterpretation_risk) },
    documentation_backfire_risk: { score: scores.documentation_backfire_risk, tier: tierOf(scores.documentation_backfire_risk) },
    relationship_break_risk: { score: scores.relationship_break_risk, tier: tierOf(scores.relationship_break_risk) },
    admission_risk: { score: scores.admission_risk, tier: tierOf(scores.admission_risk) }
  };

  const overall_tier = computeOverallTier(scores);

  const base_presets = presetsByTier(overall_tier);
  const strategy_presets = applyModeOverrides(base_presets, scores);

  return {
    version: "1.0",
    risk_profile: { modes, overall_tier },
    strategy_presets,
    drivers
  };
}

module.exports = { computeStrategyMapV1 };
