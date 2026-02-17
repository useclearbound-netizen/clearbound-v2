// api/sim/v1/run.js
const fs = require("fs");
const path = require("path");
const { computeStrategyMapV1 } = require("../../engine/strategyMapV1");

module.exports = async function handler(req, res) {
  try {
    // Optional gate (recommended)
    // if (req.headers["x-sim-key"] !== process.env.SIM_KEY) {
    //   return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    // }

    const matrixPath = path.join(
      process.cwd(),
      "api",
      "engine",
      "sim",
      "simulation_matrix_v1.json"
    );

    const raw = fs.readFileSync(matrixPath, "utf8");
    const matrix = JSON.parse(raw);

    if (!matrix || !Array.isArray(matrix.cases)) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_MATRIX",
        message: "Expected { cases: [...] }"
      });
    }

    const results = matrix.cases.map((c) => {
      const strategyMap = computeStrategyMapV1(c.signals || {});
      return {
        id: c.id,
        label: c.label || null,
        risk_profile: strategyMap.risk_profile,
        strategy_presets: strategyMap.strategy_presets,
        drivers_count: Array.isArray(strategyMap.drivers) ? strategyMap.drivers.length : 0
        // drivers: strategyMap.drivers // 필요하면 켜기
      };
    });

    const tier_counts = results.reduce((acc, r) => {
      const t = r?.risk_profile?.overall_tier || "unknown";
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      ok: true,
      version: "1.0",
      count: results.length,
      tier_counts,
      results
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SIM_RUN_FAILED",
      message: e?.message || String(e)
    });
  }
};
