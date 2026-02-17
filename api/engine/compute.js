// api/engine/compute.js
// ClearBound Engine Logic v2.0 (Premium RSE)
// Deterministic strategy decisions + posture controls

const { normalizeV2 } = require("./normalize");

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function mapContinuityWeight(continuity) {
  if (continuity === "ongoing") return 2;
  if (continuity === "short_term") return 1;
  if (continuity === "one_time") return 0;
  return 1; // default middle
}

function mapImportanceWeight(importance) {
  if (importance === "very_high") return 2;
  if (importance === "high") return 2;
  if (importance === "medium") return 1;
  if (importance === "low") return 0;
  return 1;
}

function mapPowerWeight(power_balance) {
  // authority above you increases caution + record-safe tendency
  if (power_balance === "they_above") return 2;
  if (power_balance === "informal_influence") return 2;
  if (power_balance === "equal") return 1;
  if (power_balance === "i_above") return 0;
  return 1;
}

function calcExposureWeights(impact_signals) {
  // v2 signal keys are freeform but expected from UI
  // recommended: emotional_fallout, reputation_impact, documentation_sensitivity, leverage
  const set = new Set(impact_signals);

  const emotional = set.has("emotional_fallout") ? 1 : 0;
  const reputation = set.has("reputation_impact") ? 2 : 0;
  const documentation = set.has("documentation_sensitivity") ? 2 : 0;
  const leverage = set.has("they_have_leverage") || set.has("leverage") ? 3 : 0;

  return { emotional, reputation, documentation, leverage };
}

function calcRiskScore({ continuity_weight, importance_weight, power_weight, repeat_weight, exposure }) {
  return (
    continuity_weight +
    importance_weight +
    power_weight +
    repeat_weight +
    exposure.emotional +
    exposure.reputation +
    exposure.documentation +
    exposure.leverage
  );
}

function mapRiskLevel(score) {
  if (score >= 8) return "high";
  if (score >= 4) return "moderate";
  return "low";
}

function calcRecordSafeLevel({ exposure, power_weight }) {
  // record-safe triggers
  if (exposure.documentation > 0) return 2;
  if (exposure.reputation > 0) return 1;
  if (power_weight >= 2) return 1;
  return 0;
}

function calcBoundaryStrength({ direction, power_balance, risk_level }) {
  // boundary strength is how explicit/firm the boundary line can be
  // 0..2
  if (direction === "disengage") return 2;
  if (direction === "reset") {
    if (risk_level === "high" && power_balance === "they_above") return 1;
    return 2;
  }
  // maintain
  if (risk_level === "high") return 0;
  return 1;
}

function calcEscalationCeiling({ risk_level, record_safe_level }) {
  // ceiling caps sharpness
  // 0 = very soft, 1 = normal procedural, 2 = can be firm but still polite
  if (record_safe_level === 2) return 0;
  if (risk_level === "high") return 0;
  if (risk_level === "moderate") return 1;
  return 2;
}

function suggestDirection({ continuity, happened_before, power_balance, risk_level, record_safe_level }) {
  // baseline suggestions
  if (risk_level === "low" && continuity === "one_time" && happened_before === false) return "maintain";
  if (record_safe_level === 2 && (power_balance === "they_above" || power_balance === "informal_influence") && continuity === "ongoing" && happened_before === true) {
    return "disengage";
  }
  return "reset";
}

function suggestTone({ record_safe_level, escalation_ceiling, formality }) {
  // record-safe pushes formal; high ceiling allows firm
  if (record_safe_level === 2) return "formal";
  if (formality === "formal") return "formal";
  if (escalation_ceiling === 0) return "neutral";
  if (escalation_ceiling === 1) return "neutral";
  return "calm";
}

function suggestDetail({ record_safe_level, risk_level, continuity }) {
  if (record_safe_level === 2) return "detailed";
  if (risk_level !== "low") return "standard";
  if (continuity === "ongoing") return "standard";
  return "concise";
}

function candorLevel(risk_level) {
  if (risk_level === "high") return "high";
  if (risk_level === "moderate") return "moderate";
  return "low";
}

function postureProfile({ recipient_type, power_balance, continuity, importance, risk_level, record_safe_level }) {
  // short label used in confirm dashboard + prompt guidance (no internal wording to user)
  const parts = [];
  if (recipient_type) parts.push(recipient_type);
  if (power_balance) parts.push(power_balance);
  if (continuity) parts.push(continuity);
  if (importance) parts.push(importance);
  if (record_safe_level === 2) parts.push("record_safe");
  else if (risk_level === "high") parts.push("high_caution");
  else if (risk_level === "moderate") parts.push("steady");
  else parts.push("light");
  return parts.join(" / ");
}

function computeEngineDecisions(v2State) {
  const n = normalizeV2(v2State);

  const continuity_weight = mapContinuityWeight(n.relationship.continuity);
  const importance_weight = mapImportanceWeight(n.relationship.importance);
  const power_weight = mapPowerWeight(n.target.power_balance);
  const repeat_weight = (n.signals.happened_before === true) ? 1 : 0;

  const exposure = calcExposureWeights(n.signals.impact_signals);
  const risk_score = calcRiskScore({ continuity_weight, importance_weight, power_weight, repeat_weight, exposure });
  const risk_level = mapRiskLevel(risk_score);

  const record_safe_level = calcRecordSafeLevel({ exposure, power_weight });

  const direction_suggestion = suggestDirection({
    continuity: n.relationship.continuity,
    happened_before: n.signals.happened_before,
    power_balance: n.target.power_balance,
    risk_level,
    record_safe_level
  });

  const direction_final = (n.strategy.direction === "unsure" || !n.strategy.direction)
    ? direction_suggestion
    : n.strategy.direction;

  const boundary_strength = calcBoundaryStrength({
    direction: direction_final,
    power_balance: n.target.power_balance,
    risk_level
  });

  const escalation_ceiling = calcEscalationCeiling({ risk_level, record_safe_level });

  const tone_recommendation = suggestTone({
    record_safe_level,
    escalation_ceiling,
    formality: n.target.formality
  });

  const detail_recommendation = suggestDetail({
    record_safe_level,
    risk_level,
    continuity: n.relationship.continuity
  });

  const insight_candor_level = candorLevel(risk_level);

  const constraints = {
    record_safe_mode: record_safe_level === 2,
    soften_if_low_ceiling: escalation_ceiling === 0,
    forbid_legal_terms: true,
    forbid_threats: true
  };

  // derived readability
  const power_index = power_weight; // 0..2
  const posture = postureProfile({
    recipient_type: n.target.recipient_type,
    power_balance: n.target.power_balance,
    continuity: n.relationship.continuity,
    importance: n.relationship.importance,
    risk_level,
    record_safe_level
  });

  // action objective sanity (required for premium)
  const action_objective = n.strategy.action_objective || null;

  // alignment score: do we have enough structure to generate premium output?
  const completeness =
    (n.target.recipient_type ? 1 : 0) +
    (n.target.power_balance ? 1 : 0) +
    (n.relationship.importance ? 1 : 0) +
    (n.relationship.continuity ? 1 : 0) +
    (action_objective ? 1 : 0) +
    ((n.facts.what_happened || "").trim().length >= 40 ? 1 : 0);

  const action_alignment_score = clamp01(completeness / 6);

  return {
    risk_level,
    risk_score,
    record_safe_level,
    power_index,
    posture_profile: posture,

    direction_suggestion,
    direction_final,

    boundary_strength,        // 0..2
    escalation_ceiling,       // 0..2

    tone_recommendation,
    detail_recommendation,
    insight_candor_level,

    action_objective,
    action_alignment_score,

    constraints,

    _debug: {
      normalized: n,
      weights: { continuity_weight, importance_weight, power_weight, repeat_weight, exposure }
    }
  };
}

module.exports = { computeEngineDecisions };
