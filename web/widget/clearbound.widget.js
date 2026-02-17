<script>
  window.CB_API_URL = "https://clearbound-v2.vercel.app/api/generate";
</script>

<!-- web/widget/clearbound.widget.html -->
<!-- ClearBound v2 — Premium Wizard (7-Step + Confirm + Unlock + Result)
     TEST MODE: payment skipped (Generate button)
-->

<div class="cb-app" data-cb-app>
  <div class="cb-quote" data-cb-quote></div>

  <div class="progress" aria-label="Progress">
    <div class="progressline" data-cb-steps></div>
  </div>

  <div class="card" data-cb-host></div>

  <div class="nav" data-cb-nav>
    <div class="cb-nav-left">
      <button type="button" data-cb-back class="cb-btn-secondary">Previous Step</button>
    </div>
    <div class="cb-nav-right">
      <button type="button" data-cb-next class="cb-btn-primary">Next Step</button>
    </div>
  </div>

  <div data-cb-msg></div>
</div>

<script>
(function(){
  const root = document.querySelector("[data-cb-app]");
  if (!root) return;
  if (root.dataset.cbInit === "1") return;
  root.dataset.cbInit = "1";

  const STORAGE_KEY = "cb_state_v2_premium";
  const TOTAL_STEPS = 7;

  const API_URL = (window.CB_API_URL || "").trim() || "https://clearbound-v2-api.vercel.app/api/generate";
  const host = root.querySelector("[data-cb-host]");
  const msg = root.querySelector("[data-cb-msg]");
  const backBtn = root.querySelector("[data-cb-back]");
  const nextBtn = root.querySelector("[data-cb-next]");
  const stepsHost = root.querySelector("[data-cb-steps]");
  const quoteEl = root.querySelector("[data-cb-quote]");
  const navEl = root.querySelector("[data-cb-nav]");

  const LIMITS = { factsMin: 40, factsMax: 1200 };

  function el(html){
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function setMessage(type, text){
    msg.innerHTML = "";
    if (!text) return;
    msg.appendChild(el(`<div class="${type}">${escapeHtml(text)}</div>`));
  }
  function attachChoose(node, fn){
    node.addEventListener("click", fn);
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }
  function makeTile({ label, desc, active, meta }){
    return el(`
      <div class="cb-tile" role="button" tabindex="0" data-active="${active ? "true":"false"}">
        <div style="display:flex;flex-direction:column;gap:6px;align-items:inherit;justify-content:center;width:100%;">
          <div class="cb-tile-label">${escapeHtml(label)}</div>
          ${desc ? `<div class="cb-tile-desc">${escapeHtml(desc)}</div>` : ""}
          ${meta ? `<div class="cb-tile-meta">${escapeHtml(meta)}</div>` : ""}
        </div>
      </div>
    `);
  }
  function makeChoiceTile({ title, desc, active, right }){
    return el(`
      <div class="cb-flag-tile" role="button" tabindex="0" data-active="${active ? "true":"false"}">
        <div class="cb-flag-title">${escapeHtml(title)}${right ? ` <span style="opacity:.78;font-weight:800;float:right;">${escapeHtml(right)}</span>` : ""}</div>
        ${desc ? `<div class="cb-flag-desc">${escapeHtml(desc)}</div>` : ""}
      </div>
    `);
  }

  // -------------------------
  // v2 state
  // -------------------------
  const defaultState = () => ({
    version: "cb.v2.premium",
    target: {
      recipient_type: null,    // supervisor|client|peer|subordinate|family|other
      power_balance: null,     // they_above|equal|i_above|informal_influence
      formality: "neutral"     // formal|neutral|informal
    },
    relationship: {
      importance: null,        // very_high|high|medium|low
      continuity: null         // ongoing|short_term|one_time
    },
    signals: {
      feels_off: [],           // max 2
      impact_signals: [],      // max 2
      happened_before: null    // boolean
    },
    facts: {
      what_happened: "",
      key_refs: ""             // optional short
    },
    strategy: {
      direction: null,         // maintain|reset|disengage|unsure
      action_objective: null,  // clarify_priority|confirm_expectations|...
      tone: "neutral",         // calm|neutral|firm|formal
      detail: "standard"       // concise|standard|detailed
    },
    paywall: {
      package: null,           // message|email|bundle
      addon_insight: false,
      price_usd: null
    },
    result: {
      message_text: "",
      subject: "",
      email_text: "",
      insight: null
    },
    engine_preview: null
  });

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch {
      return defaultState();
    }
  }
  function saveState(s){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }
  let state = loadState();

  // -------------------------
  // router
  // -------------------------
  let screen = "wizard"; // wizard|confirm|unlock|result
  let step = 1;

  const stepQuote = {
    1: "Strategy starts with who this is for.",
    2: "Continuity changes the posture.",
    3: "Signals shape the ceiling.",
    4: "Facts are the backbone.",
    5: "Direction sets the frame.",
    6: "Objective defines the ask.",
    7: "Expression decides how it lands."
  };

  const feelsOffOptions = [
    { key:"expectation_not_met", label:"An expectation wasn’t met", desc:"Something understood or agreed didn’t happen." },
    { key:"keeps_repeating", label:"This keeps repeating", desc:"You’ve seen this pattern before." },
    { key:"decision_changed_things", label:"A decision changed things", desc:"A choice shifted outcomes or burden." },
    { key:"felt_overlooked", label:"I felt overlooked", desc:"What you said or did wasn’t acknowledged." },
    { key:"power_uneven", label:"Power feels uneven", desc:"They hold more authority or leverage here." },
    { key:"may_step_back", label:"I may step back", desc:"You’re unsure continuing makes sense." }
  ];

  const impactOptions = [
    { key:"emotional_fallout", label:"Emotional fallout", desc:"This could carry emotional weight." },
    { key:"reputation_impact", label:"Reputation impact", desc:"This could affect perception at work." },
    { key:"documentation_sensitivity", label:"Documentation sensitivity", desc:"This may need to be record-safe." },
    { key:"they_have_leverage", label:"They have leverage", desc:"They have authority or influence here." }
  ];

  const recipientOptions = [
    { key:"supervisor", label:"Supervisor", desc:"Someone above you in authority." },
    { key:"client", label:"Client", desc:"A customer or paying partner." },
    { key:"peer", label:"Peer", desc:"A colleague at a similar level." },
    { key:"subordinate", label:"Subordinate", desc:"Someone who reports to you." },
    { key:"family", label:"Family", desc:"A family member or close personal tie." },
    { key:"other", label:"Other", desc:"A different relationship type." }
  ];

  const powerOptions = [
    { key:"they_above", label:"They have authority over me", desc:"Formal or practical authority above you." },
    { key:"equal", label:"Equal standing", desc:"No clear authority imbalance." },
    { key:"i_above", label:"I have authority", desc:"You lead or decide in this context." },
    { key:"informal_influence", label:"Informal influence", desc:"No title, but strong leverage." }
  ];

  const importanceOptions = [
    { key:"very_high", label:"Very important", desc:"Preserve carefully; long-term impact." },
    { key:"high", label:"Important", desc:"Matters and likely continues." },
    { key:"medium", label:"Situational", desc:"Relevant but not deeply anchored." },
    { key:"low", label:"Low importance", desc:"Minimal long-term consequence." }
  ];

  const continuityOptions = [
    { key:"ongoing", label:"Ongoing", desc:"You will interact repeatedly." },
    { key:"short_term", label:"Short-term", desc:"Likely continues briefly." },
    { key:"one_time", label:"One-time", desc:"Probably a single interaction." }
  ];

  const directionOptions = [
    { key:"maintain", label:"Maintain", desc:"Keep stable; clarify lightly." },
    { key:"reset", label:"Reset", desc:"Realign expectations; set a boundary." },
    { key:"disengage", label:"Disengage", desc:"Reduce scope or close loop." },
    { key:"unsure", label:"I’m not sure", desc:"Let ClearBound suggest direction." }
  ];

  const objectiveOptions = [
    { key:"clarify_priority", label:"Clarify priorities", desc:"Get an order of operations." },
    { key:"confirm_expectations", label:"Confirm expectations", desc:"Align on what is required." },
    { key:"request_adjustment", label:"Request an adjustment", desc:"Ask to revise scope or timing." },
    { key:"set_boundary", label:"Set a boundary", desc:"Define what you can and can’t do." },
    { key:"reduce_scope", label:"Reduce scope", desc:"Limit involvement or responsibilities." },
    { key:"close_loop", label:"Close the loop", desc:"End the interaction cleanly." },
    { key:"other", label:"Other objective", desc:"A different primary ask." }
  ];

  const toneOptions = [
    { key:"calm", label:"Calm", desc:"Steady, low pressure" },
    { key:"neutral", label:"Neutral", desc:"Procedural, balanced" },
    { key:"firm", label:"Firm", desc:"Clear boundaries, polite" },
    { key:"formal", label:"Formal", desc:"Documentation-friendly" }
  ];

  const detailOptions = [
    { key:"concise", label:"Concise", desc:"Tight and direct" },
    { key:"standard", label:"Standard", desc:"Balanced and structured" },
    { key:"detailed", label:"Detailed", desc:"Thorough, record-friendly" }
  ];

  const PRICES = { message:1.99, email:2.99, bundle:3.99, insight:1.99 };
  const packageOptions = [
    { key:"message", title:"Message", price:PRICES.message, desc:"Structured message draft." },
    { key:"email", title:"Email", price:PRICES.email, desc:"Email with subject and sections." },
    { key:"bundle", title:"Message + Email", price:PRICES.bundle, desc:"Both formats aligned." }
  ];

  function computePrice(){
    const pkg = state.paywall.package;
    if (!pkg) return null;
    const base = PRICES[pkg];
    const add = state.paywall.addon_insight ? PRICES.insight : 0;
    return Number((base + add).toFixed(2));
  }
  function formatMoney(n){
    const v = Number(n);
    if (!Number.isFinite(v)) return "$—";
    return "$" + v.toFixed(2);
  }

  // -------------------------
  // stepper
  // -------------------------
  function buildStepIndicator(){
    stepsHost.innerHTML = "";
    for (let i=1;i<=TOTAL_STEPS;i++){
      const dot = el(`<div class="cb-stepdot" data-dot="${i}" data-state="inactive">${i}</div>`);
      stepsHost.appendChild(dot);
      if (i < TOTAL_STEPS){
        const conn = el(`<div class="cb-connector" data-conn="${i}"><i></i></div>`);
        stepsHost.appendChild(conn);
      }
    }
  }
  function updateProgress(){
    if (quoteEl) quoteEl.textContent = stepQuote[step] || "";
    for (let i=1;i<=TOTAL_STEPS;i++){
      const dot = root.querySelector(`[data-dot="${i}"]`);
      if (!dot) continue;
      dot.dataset.state = (i === step) ? "active" : (i < step) ? "done" : "inactive";
    }
    for (let i=1;i<TOTAL_STEPS;i++){
      const conn = root.querySelector(`[data-conn="${i}"] > i`);
      if (!conn) continue;
      conn.style.width = (i < step-1) ? "100%" : (i === step-1) ? "50%" : "0%";
    }
  }

  function setWizardChromeVisible(visible){
    if (quoteEl) quoteEl.style.display = visible ? "" : "none";
    const progress = root.querySelector(".progress");
    if (progress) progress.style.display = visible ? "" : "none";
    if (navEl) navEl.style.display = visible ? "flex" : "none";
  }

  function requiredOk(){
    if (screen !== "wizard") return true;

    if (step === 1) return !!state.target.recipient_type && !!state.target.power_balance;
    if (step === 2) return !!state.relationship.importance && !!state.relationship.continuity;
    if (step === 3) return (state.signals.happened_before === true || state.signals.happened_before === false);
    if (step === 4) return (state.facts.what_happened || "").trim().length >= LIMITS.factsMin;
    if (step === 5) return !!state.strategy.direction;
    if (step === 6) return !!state.strategy.action_objective;
    if (step === 7) return !!state.strategy.tone && !!state.strategy.detail;
    return true;
  }

  function refreshNav(){
    saveState(state);
    updateProgress();
    backBtn.style.display = (step === 1) ? "none" : "";
    nextBtn.textContent = (step === TOTAL_STEPS) ? "Continue" : "Next Step";
    nextBtn.disabled = !requiredOk();
  }

  function render(){
    setMessage("", "");
    host.innerHTML = "";

    setWizardChromeVisible(screen === "wizard");

    if (screen === "wizard") {
      updateProgress();
      refreshNav();
      if (step === 1) return renderStep1();
      if (step === 2) return renderStep2();
      if (step === 3) return renderStep3();
      if (step === 4) return renderStep4();
      if (step === 5) return renderStep5();
      if (step === 6) return renderStep6();
      if (step === 7) return renderStep7();
    }

    if (screen === "confirm") return renderConfirm();
    if (screen === "unlock") return renderUnlock();
    if (screen === "result") return renderResult();
  }

  // -------------------------
  // Steps
  // -------------------------
  function renderStep1(){
    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 1</div>
          <h3 class="cb-stepq">Who is this for — and what’s the power balance?</h3>
        </div>
        <div class="help">This anchors strategy and keeps the recipient framing consistent.</div>

        <label>Recipient type</label>
        <div class="cb-tilegrid" data-rec style="grid-template-columns:1fr;"></div>

        <label>Power balance</label>
        <div class="cb-tilegrid" data-power style="grid-template-columns:1fr;"></div>
      </div>
    `);

    const rec = wrap.querySelector("[data-rec]");
    recipientOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.target.recipient_type === opt.key });
      attachChoose(tile, ()=>{ state.target.recipient_type = opt.key; saveState(state); render(); });
      rec.appendChild(tile);
    });

    const pow = wrap.querySelector("[data-power]");
    powerOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.target.power_balance === opt.key });
      attachChoose(tile, ()=>{ state.target.power_balance = opt.key; saveState(state); render(); });
      pow.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  function renderStep2(){
    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 2</div>
          <h3 class="cb-stepq">How important and ongoing is this relationship?</h3>
        </div>
        <div class="help">Continuity and importance shape posture and structure.</div>

        <label>Importance</label>
        <div class="cb-tilegrid" data-imp style="grid-template-columns:1fr;"></div>

        <label>Continuity</label>
        <div class="cb-tilegrid" data-con style="grid-template-columns:1fr;"></div>
      </div>
    `);

    const imp = wrap.querySelector("[data-imp]");
    importanceOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.relationship.importance === opt.key });
      attachChoose(tile, ()=>{ state.relationship.importance = opt.key; saveState(state); render(); });
      imp.appendChild(tile);
    });

    const con = wrap.querySelector("[data-con]");
    continuityOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.relationship.continuity === opt.key });
      attachChoose(tile, ()=>{ state.relationship.continuity = opt.key; saveState(state); render(); });
      con.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  function renderStep3(){
    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 3</div>
          <h3 class="cb-stepq">What signals are present?</h3>
        </div>
        <div class="help">Select up to 2 in each group. Then confirm whether it has happened before.</div>

        <label>What feels off? (up to 2)</label>
        <div class="cb-flaggrid" data-off></div>
        <div class="warn" data-offcap style="display:none;"></div>

        <label>What impact could this have? (up to 2)</label>
        <div class="cb-flaggrid" data-imp></div>
        <div class="warn" data-impcap style="display:none;"></div>

        <label>Has this happened before?</label>
        <div class="cb-tilegrid" data-repeat style="grid-template-columns:repeat(2,minmax(0,1fr));"></div>
      </div>
    `);

    const offGrid = wrap.querySelector("[data-off]");
    const offCap = wrap.querySelector("[data-offcap]");
    function toggleOff(key){
      const arr = state.signals.feels_off || [];
      const has = arr.includes(key);
      if (!has && arr.length >= 2){
        offCap.style.display = "block";
        offCap.textContent = "You can select up to 2.";
        return;
      }
      offCap.style.display = "none";
      state.signals.feels_off = has ? arr.filter(x=>x!==key) : [...arr, key];
      saveState(state);
      render();
    }
    feelsOffOptions.forEach(opt => {
      const tile = el(`
        <div class="cb-flag-tile" role="button" tabindex="0" data-active="${state.signals.feels_off.includes(opt.key) ? "true":"false"}">
          <div class="cb-flag-title">${escapeHtml(opt.label)}</div>
          <div class="cb-flag-desc">${escapeHtml(opt.desc)}</div>
        </div>
      `);
      attachChoose(tile, ()=>toggleOff(opt.key));
      offGrid.appendChild(tile);
    });

    const impGrid = wrap.querySelector("[data-imp]");
    const impCap = wrap.querySelector("[data-impcap]");
    function toggleImpact(key){
      const arr = state.signals.impact_signals || [];
      const has = arr.includes(key);
      if (!has && arr.length >= 2){
        impCap.style.display = "block";
        impCap.textContent = "You can select up to 2.";
        return;
      }
      impCap.style.display = "none";
      state.signals.impact_signals = has ? arr.filter(x=>x!==key) : [...arr, key];
      saveState(state);
      render();
    }
    impactOptions.forEach(opt => {
      const tile = el(`
        <div class="cb-flag-tile" role="button" tabindex="0" data-active="${state.signals.impact_signals.includes(opt.key) ? "true":"false"}">
          <div class="cb-flag-title">${escapeHtml(opt.label)}</div>
          <div class="cb-flag-desc">${escapeHtml(opt.desc)}</div>
        </div>
      `);
      attachChoose(tile, ()=>toggleImpact(opt.key));
      impGrid.appendChild(tile);
    });

    const rep = wrap.querySelector("[data-repeat]");
    [{label:"Yes", value:true},{label:"No", value:false}].forEach(opt => {
      const tile = makeTile({ label: opt.label, desc:"", active: state.signals.happened_before === opt.value });
      attachChoose(tile, ()=>{ state.signals.happened_before = opt.value; saveState(state); render(); });
      rep.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  function renderStep4(){
    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 4</div>
          <h3 class="cb-stepq">What happened?</h3>
        </div>
        <div class="help">Write facts only. Keep it clear and grounded.</div>

        <label>Factual description</label>
        <textarea data-facts maxlength="${LIMITS.factsMax}" placeholder="2–6 factual sentences. Include what was said/done and any concrete constraints."></textarea>

        <label>Optional key references</label>
        <input type="text" data-refs placeholder="Dates, times, project name, order ID, etc. (optional)" />

        <div class="warn" data-warn style="display:none;"></div>
      </div>
    `);

    const ta = wrap.querySelector("[data-facts]");
    const refs = wrap.querySelector("[data-refs]");
    const warn = wrap.querySelector("[data-warn]");

    ta.value = state.facts.what_happened || "";
    refs.value = state.facts.key_refs || "";

    function check(){
      const ok = (state.facts.what_happened || "").trim().length >= LIMITS.factsMin;
      warn.style.display = ok ? "none" : "block";
      warn.textContent = ok ? "" : "Please provide a short factual description (at least a few sentences).";
      refreshNav();
    }

    ta.addEventListener("input", ()=>{ state.facts.what_happened = ta.value; saveState(state); check(); });
    refs.addEventListener("input", ()=>{ state.facts.key_refs = refs.value; saveState(state); });

    check();
    host.appendChild(wrap);
  }

  function renderStep5(){
    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 5</div>
          <h3 class="cb-stepq">Choose your direction</h3>
        </div>
        <div class="help">This sets the posture of the communication.</div>

        <div class="cb-tilegrid" data-dir style="grid-template-columns:1fr;"></div>
      </div>
    `);

    const grid = wrap.querySelector("[data-dir]");
    directionOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.strategy.direction === opt.key });
      attachChoose(tile, ()=>{ state.strategy.direction = opt.key; saveState(state); render(); });
      grid.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  function renderStep6(){
    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 6</div>
          <h3 class="cb-stepq">What do you want them to do?</h3>
        </div>
        <div class="help">A premium message has one clear action objective.</div>

        <div class="cb-tilegrid" data-obj style="grid-template-columns:1fr;"></div>
      </div>
    `);

    const grid = wrap.querySelector("[data-obj]");
    objectiveOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.strategy.action_objective === opt.key });
      attachChoose(tile, ()=>{ state.strategy.action_objective = opt.key; saveState(state); render(); });
      grid.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  function renderStep7(){
    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 7</div>
          <h3 class="cb-stepq">How should this be expressed?</h3>
        </div>
        <div class="help">Tone and detail define delivery, not intent.</div>

        <label>Tone</label>
        <div class="cb-tilegrid" data-tone style="grid-template-columns:1fr;"></div>

        <label>Detail</label>
        <div class="cb-tilegrid" data-detail style="grid-template-columns:1fr;"></div>
      </div>
    `);

    const tg = wrap.querySelector("[data-tone]");
    toneOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.strategy.tone === opt.key });
      attachChoose(tile, ()=>{ state.strategy.tone = opt.key; saveState(state); render(); });
      tg.appendChild(tile);
    });

    const dg = wrap.querySelector("[data-detail]");
    detailOptions.forEach(opt => {
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: state.strategy.detail === opt.key });
      attachChoose(tile, ()=>{ state.strategy.detail = opt.key; saveState(state); render(); });
      dg.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  // -------------------------
  // Confirm / Unlock / Result
  // -------------------------
  function renderConfirm(){
    const map = {
      recipient: state.target.recipient_type || "—",
      power: state.target.power_balance || "—",
      importance: state.relationship.importance || "—",
      continuity: state.relationship.continuity || "—",
      direction: state.strategy.direction || "—",
      objective: state.strategy.action_objective || "—",
      tone: state.strategy.tone || "—",
      detail: state.strategy.detail || "—"
    };

    const wrap = el(`
      <div>
        <h2 style="margin:0 0 10px;font-size:28px;letter-spacing:-0.02em;">Confirm your strategy</h2>
        <div style="opacity:.72;font-weight:650;margin:0 0 18px;">
          This is a strategy dashboard — not a preview.
        </div>

        <div class="card" style="margin:0 0 12px;">
          <div style="font-weight:900;margin-bottom:10px;">Strategy Map</div>
          <div style="font-size:15px;line-height:1.65;">
            Target: <b>${escapeHtml(map.recipient)}</b><br/>
            Power balance: <b>${escapeHtml(map.power)}</b><br/>
            Relationship: <b>${escapeHtml(map.importance)}</b> · <b>${escapeHtml(map.continuity)}</b><br/>
            Direction: <b>${escapeHtml(map.direction)}</b><br/>
            Objective: <b>${escapeHtml(map.objective)}</b><br/>
            Tone: <b>${escapeHtml(map.tone)}</b> · Detail: <b>${escapeHtml(map.detail)}</b>
          </div>
        </div>

        <div class="card" style="margin:0;">
          <div style="font-weight:900;margin-bottom:10px;">Strategic check</div>
          <ul style="margin:0;padding-left:18px;line-height:1.7;">
            <li>Is the objective a single clear ask?</li>
            <li>Does the direction match the relationship importance and continuity?</li>
            <li>Is the tone appropriate for the power balance?</li>
          </ul>
          <div style="margin-top:10px;font-size:13px;opacity:.65;font-weight:650;">
            (This is a pause for clarity — not a warning.)
          </div>
        </div>

        <div class="nav" style="margin-top:26px;">
          <div class="cb-nav-left">
            <button type="button" class="cb-btn-secondary" data-back>Back</button>
          </div>
          <div class="cb-nav-right">
            <button type="button" class="cb-btn-primary" data-go>Continue</button>
          </div>
        </div>
      </div>
    `);

    wrap.querySelector("[data-back]").addEventListener("click", ()=>{ screen="wizard"; step=7; render(); });
    wrap.querySelector("[data-go]").addEventListener("click", ()=>{ screen="unlock"; render(); });

    host.appendChild(wrap);
  }

  function renderUnlock(){
    const total = computePrice();
    const payLabel = total != null ? formatMoney(total) : "—";

    const wrap = el(`
      <div>
        <h2 style="margin:0 0 10px;font-size:28px;letter-spacing:-0.02em;">Unlock your message</h2>
        <div style="opacity:.72;font-weight:650;margin:0 0 18px;">
          Choose your format. Add optional insight if you want it.
        </div>

        <div class="cb-flaggrid" data-pkgs style="grid-template-columns:1fr;"></div>

        <div class="card" style="margin:14px 0 0;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;">
            <div>
              <div style="font-weight:800;">Strategic Insight</div>
              <div style="opacity:.72;font-weight:650;margin-top:6px;">
                Optional positioning panel (paid add-on).
              </div>
            </div>
            <button type="button" class="cb-btn-secondary" data-addon>
              ${state.paywall.addon_insight ? "Added" : ("+ " + formatMoney(PRICES.insight))}
            </button>
          </div>
        </div>

        <div class="nav" style="margin-top:26px;">
          <div class="cb-nav-left">
            <button type="button" class="cb-btn-secondary" data-back>Back</button>
          </div>
          <div class="cb-nav-right">
            <button type="button" class="cb-btn-primary" data-generate disabled>
              Generate — ${escapeHtml(payLabel)}
            </button>
          </div>
        </div>
      </div>
    `);

    const pkgGrid = wrap.querySelector("[data-pkgs]");
    const genBtn = wrap.querySelector("[data-generate]");
    const addonBtn = wrap.querySelector("[data-addon]");

    function updateGenerateButton(){
      state.paywall.price_usd = computePrice();
      const ok = !!state.paywall.package;
      genBtn.disabled = !ok;
      genBtn.innerHTML = `Generate — ${escapeHtml(ok ? formatMoney(state.paywall.price_usd) : "$—")}`;
      saveState(state);
    }

    packageOptions.forEach(p => {
      const active = state.paywall.package === p.key;
      const tile = makeChoiceTile({
        title: p.title,
        desc: p.desc,
        active,
        right: formatMoney(p.price)
      });
      attachChoose(tile, ()=>{ state.paywall.package = p.key; updateGenerateButton(); render(); });
      pkgGrid.appendChild(tile);
    });

    addonBtn.addEventListener("click", ()=>{
      state.paywall.addon_insight = !state.paywall.addon_insight;
      addonBtn.textContent = state.paywall.addon_insight ? "Added" : ("+ " + formatMoney(PRICES.insight));
      updateGenerateButton();
      render();
    });

    wrap.querySelector("[data-back]").addEventListener("click", ()=>{ screen="confirm"; render(); });

    genBtn.addEventListener("click", async ()=>{
      if (!state.paywall.package) return;

      setMessage("", "");

      const payloadState = {
        target: state.target,
        relationship: state.relationship,
        signals: state.signals,
        facts: state.facts,
        strategy: state.strategy,
        paywall: {
          package: state.paywall.package,
          addon_insight: state.paywall.addon_insight
        }
      };

      try{
        const r = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ state: payloadState })
        });

        const text = await r.text();
        const data = (()=>{ try { return JSON.parse(text); } catch { return null; } })();

        if (!r.ok || !data || data.ok !== true) {
          const errMsg = data?.message || data?.error || ("HTTP_" + r.status);
          setMessage("warn", "Generation failed: " + errMsg);
          return;
        }

        state.result.message_text = (data?.data?.message_text || "").trim();
        state.result.subject = (data?.data?.subject || "").trim();
        state.result.email_text = (data?.data?.email_text || "").trim();
        state.result.insight = data?.data?.insight || null;

        saveState(state);
        screen = "result";
        render();

      } catch {
        setMessage("warn", "Generation failed: NETWORK_ERROR");
      }
    });

    updateGenerateButton();
    host.appendChild(wrap);
  }

  function normalizeInsightObject(ins){
    if (!ins) return null;
    if (typeof ins === "string") { try { return JSON.parse(ins); } catch { return null; } }
    if (typeof ins === "object") return ins;
    return null;
  }

  function insightToPlainText(ins){
    const obj = normalizeInsightObject(ins);
    if (!obj) return "";
    const lines = [];
    lines.push(obj.insight_title || "Strategic Insight");
    lines.push("");
    const sections = Array.isArray(obj.insight_sections) ? obj.insight_sections : [];
    sections.forEach(sec => {
      if (sec?.title) lines.push(sec.title);
      const bullets = Array.isArray(sec?.bullets) ? sec.bullets : [];
      bullets.forEach(b => lines.push("- " + String(b)));
      lines.push("");
    });
    if (obj.disclaimer_line) lines.push(obj.disclaimer_line);
    return lines.join("\n").trim();
  }

  function renderResult(){
    const hasMsg = !!(state.result.message_text || "").trim();
    const hasEmail = !!(state.result.email_text || "").trim();
    const hasSubj = !!(state.result.subject || "").trim();
    const insightObj = normalizeInsightObject(state.result.insight);
    const hasInsight = !!insightObj;

    const wrap = el(`
      <div>
        <h2 style="margin:0 0 10px;font-size:28px;letter-spacing:-0.02em;">Your message</h2>
        <div style="opacity:.72;font-weight:650;margin:0 0 18px;">
          Generated output aligned to your strategy.
        </div>

        <div class="card" style="margin:0;">
          <div style="font-weight:900;margin-bottom:10px;">Result</div>

          ${hasMsg ? `
            <div style="font-weight:900;margin:14px 0 8px;">Message</div>
            <div class="mono" data-msg></div>
          ` : ""}

          ${hasEmail ? `
            <div style="font-weight:900;margin:14px 0 8px;">Email</div>
            ${hasSubj ? `<div style="opacity:.8;font-weight:800;margin-bottom:6px;">Subject: ${escapeHtml(state.result.subject)}</div>` : ""}
            <div class="mono" data-email></div>
          ` : ""}
        </div>

        ${hasInsight ? `
          <details class="card" style="margin-top:14px;" open>
            <summary style="cursor:pointer;font-weight:800;">
              Strategic Insight — Understand the positioning behind this message
            </summary>
            <div data-ins style="margin-top:12px;"></div>
          </details>
        ` : ""}

        <div style="display:flex;gap:10px;margin-top:14px;">
          <button type="button" class="cb-btn-secondary" data-copy>Copy</button>
          <button type="button" class="cb-btn-secondary" data-download>Download</button>
        </div>

        <div style="margin-top:18px;">
          <button type="button" class="cb-btn-secondary" data-new>Start New Situation</button>
        </div>
      </div>
    `);

    const msgEl = wrap.querySelector("[data-msg]");
    const emailEl = wrap.querySelector("[data-email]");
    if (msgEl) msgEl.textContent = (state.result.message_text || "").trim();
    if (emailEl) emailEl.textContent = (state.result.email_text || "").trim();

    const insWrap = wrap.querySelector("[data-ins]");
    if (insWrap && hasInsight) {
      // minimal render
      const secs = Array.isArray(insightObj.insight_sections) ? insightObj.insight_sections : [];
      insWrap.innerHTML = `
        <div style="font-weight:900;margin-bottom:10px;">${escapeHtml(insightObj.insight_title || "Strategic Insight")}</div>
        ${secs.map(sec => `
          <div style="margin-top:12px;">
            <div style="font-weight:900;margin-bottom:6px;">${escapeHtml(sec.title || "")}</div>
            <ul style="margin:0;padding-left:18px;line-height:1.7;">
              ${(Array.isArray(sec.bullets)?sec.bullets:[]).map(b=>`<li>${escapeHtml(String(b))}</li>`).join("")}
            </ul>
          </div>
        `).join("")}
        ${insightObj.disclaimer_line ? `<div style="margin-top:14px;opacity:.65;font-weight:650;">${escapeHtml(insightObj.disclaimer_line)}</div>` : ""}
      `;
    }

    wrap.querySelector("[data-copy]").addEventListener("click", async ()=>{
      const parts = [];
      if (state.result.message_text) parts.push(state.result.message_text.trim());
      if (state.result.email_text) {
        const subj = state.result.subject ? ("Subject: " + state.result.subject.trim() + "\n\n") : "";
        parts.push(subj + state.result.email_text.trim());
      }
      if (state.result.insight) parts.push(insightToPlainText(state.result.insight));
      const text = parts.filter(Boolean).join("\n\n---\n\n");
      if (!text) return;

      try{
        await navigator.clipboard.writeText(text);
        setMessage("ok", "Copied.");
      } catch {
        setMessage("warn", "Copy failed in this browser context.");
      }
    });

    wrap.querySelector("[data-download]").addEventListener("click", ()=>{
      const parts = [];
      if (state.result.message_text) parts.push("MESSAGE\n" + state.result.message_text.trim());
      if (state.result.email_text) {
        const subj = state.result.subject ? ("SUBJECT\n" + state.result.subject.trim() + "\n\n") : "";
        parts.push("EMAIL\n" + subj + state.result.email_text.trim());
      }
      if (state.result.insight) {
        const it = insightToPlainText(state.result.insight);
        if (it) parts.push("INSIGHT\n" + it);
      }
      const text = parts.join("\n\n---\n\n");
      const blob = new Blob([text], { type:"text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "clearbound.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    wrap.querySelector("[data-new]").addEventListener("click", ()=>{
      state = defaultState();
      saveState(state);
      screen = "wizard";
      step = 1;
      render();
    });

    host.appendChild(wrap);
  }

  // -------------------------
  // nav events
  // -------------------------
  backBtn.addEventListener("click", ()=>{
    if (screen !== "wizard") return;
    if (step > 1) step -= 1;
    render();
  });
  nextBtn.addEventListener("click", ()=>{
    if (screen !== "wizard") return;
    if (!requiredOk()) return;

    if (step < TOTAL_STEPS) {
      step += 1;
      render();
      return;
    }
    screen = "confirm";
    render();
  });

  // boot
  buildStepIndicator();
  setWizardChromeVisible(true);
  screen = "wizard";
  step = Math.min(Math.max(step, 1), TOTAL_STEPS);
  render();
})();
</script>
