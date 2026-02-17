// api/sim/v1/run.js
const fs = require("fs");
const path = require("path");
const { computeStrategyMapV1 } = require("../../engine/strategyMapV1");

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === "1"; // /api/sim/v1/run?debug=1
  const full = req.query?.full === "1";   // /api/sim/v1/run?full=1

  try {
    // 1) Method gate (GET only)
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "METHOD_NOT_ALLOWED",
        message: "Use GET"
      });
    }

    // 2) Optional auth gate (recommended for public deployments)
    // If SIM_KEY is set, require x-sim-key header.
    if (process.env.SIM_KEY) {
      const key = req.headers["x-sim-key"];
      if (!key || key !== process.env.SIM_KEY) {
        return res.status(403).json({ ok: false, error: "FORBIDDEN" });
      }
    }

    const matrixPath = path.join(
      process.cwd(),
      "api",
      "engine",
      "sim",
      "simulation_matrix_v1.json"
    );

    // 3) Better file read errors
    let raw;
    try {
      raw = fs.readFileSync(matrixPath, "utf8");
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "MATRIX_READ_FAILED",
        message: e?.message || String(e),
        matrixPath: debug ? matrixPath : undefined,
        stack: debug ? (e?.stack || null) : undefined
      });
    }

    let matrix;
    try {
      matrix = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: "MATRIX_PARSE_FAILED",
        message: e?.message || String(e),
        matrixPath: debug ? matrixPath : undefined
      });
    }

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

    // Light QC summary (quick sanity checks)
    const qc_summary = {
      cases: results.length,
      extreme_count: tier_counts.extreme || 0
    };

    // 4) Default response is compact; full results only when requested
    return res.status(200).json({
      ok: true,
      version: "1.0",
      count: results.length,
      tier_counts,
      qc_summary,
      results: full ? results : undefined
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SIM_RUN_FAILED",
      message: e?.message || String(e),
      stack: debug ? (e?.stack || null) : undefined
    });
  }
};
