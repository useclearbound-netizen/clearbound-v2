// api/engine/sim/run_v1.js
// Run v1 simulation matrix → dump results JSON

const fs = require("fs");
const path = require("path");
const { computeStrategyMapV1 } = require("../strategyMapV1");

const matrixPath = path.join(__dirname, "simulation_matrix_v1.json");
const outPath = path.join(__dirname, "simulation_results_v1.json");

function main() {
  const raw = fs.readFileSync(matrixPath, "utf8");
  const matrix = JSON.parse(raw);

  if (!matrix || !Array.isArray(matrix.cases)) {
    throw new Error("Invalid matrix: expected { cases: [...] }");
  }

  const results = matrix.cases.map((c) => {
    const strategyMap = computeStrategyMapV1(c.signals || {});
    return {
      id: c.id,
      label: c.label || null,
      risk_profile: strategyMap.risk_profile,
      strategy_presets: strategyMap.strategy_presets,
      drivers_count: Array.isArray(strategyMap.drivers) ? strategyMap.drivers.length : 0,
      // Uncomment if you want full driver audit:
      // drivers: strategyMap.drivers
    };
  });

  fs.writeFileSync(outPath, JSON.stringify({ version: "1.0", results }, null, 2), "utf8");
  console.log(`OK: wrote ${results.length} results → ${outPath}`);
}

main();
