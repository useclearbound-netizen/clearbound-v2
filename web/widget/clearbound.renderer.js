/* =========================================================
   ClearBound Renderer (non-module)
   - Exposes window.CB_Renderer.renderFromBlockPlan
   ========================================================= */

(function () {
  function renderFromBlockPlan(blockPlan, generatedBlocks) {
    const output = blockPlan?.outputs?.[0];
    const blocks = output?.blocks || [];
    const sepHint = output?.render_hints?.separator;
    const separator = (sepHint === "blank_line") ? "\n\n" : "\n";

    const ordered = [];

    blocks.forEach((b) => {
      if (!b) return;
      const id = b.id;
      const val = generatedBlocks?.[id];

      if (!b.required && !val) return;
      if (typeof val === "string" && val.trim()) ordered.push(val.trim());
    });

    return ordered.join(separator);
  }

  // expose
  window.CB_Renderer = window.CB_Renderer || {};
  window.CB_Renderer.renderFromBlockPlan = renderFromBlockPlan;
})();
