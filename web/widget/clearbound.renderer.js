export function renderFromBlockPlan(blockPlan, generatedBlocks) {

  const output = blockPlan.outputs[0];
  const blocks = output.blocks;
  const separator = output.render_hints?.separator === "blank_line" ? "\n\n" : "\n";

  const ordered = [];

  blocks.forEach(b => {
    if (!b.required && !generatedBlocks[b.id]) return;
    if (generatedBlocks[b.id]) {
      ordered.push(generatedBlocks[b.id].trim());
    }
  });

  return ordered.join(separator);
}
