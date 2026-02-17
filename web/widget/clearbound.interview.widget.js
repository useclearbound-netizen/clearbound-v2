/* =========================================================
   ClearBound Interview Widget — v2 (Engine-First)
   - Independent from existing tile wizard
   - Produces: signals -> strategy_map -> optional output format
   - Uses existing CSS tokens/classes where possible
   ========================================================= */

(function(){
  const root = document.querySelector('[data-cb-app="interview"]') || document.querySelector("[data-cb-app]");
  if (!root) return;

  // Prevent double-init
  if (root.dataset.cbInterviewInit === "1") return;
  root.dataset.cbInterviewInit = "1";

  const API_URL = (window.CB_API_URL || "").trim() || "https://clearbound-v2.vercel.app/api/generate";

  const host = root.querySelector("[data-cb-host]");
  const msg  = root.querySelector("[data-cb-msg]");
  const backBtn = root.querySelector("[data-cb-back]");
  const nextBtn = root.querySelector("[data-cb-next]");
  const stepsHost = root.querySelector("[data-cb-steps]");
  const quoteEl = root.querySelector("[data-cb-quote]");
  const navEl = root.querySelector("[data-cb-nav]");

  if (!host || !msg || !backBtn || !nextBtn || !stepsHost) return;

  // -------------------------
  // Utils
  // -------------------------
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
    node.addEventListener("keydown", (e)=>{
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }

  // 1–5 -> 0–100
  function norm15(v){
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const clamped = Math.max(1, Math.min(5, n));
    return Math.round(((clamped - 1) / 4) * 100);
  }

  // -------------------------
  // Storage
  // -------------------------
  const STORAGE_KEY = "cb_interview_state_v1";
  function defaultState(){
    return {
      version: "cb.interview.v1",
      // Signals (0–100 / enums)
      signals: {
        stakes: {
          severity: 0,
          irreversibility: 0,
          time_pressure: 0
        },
        counterparty: {
          power_asymmetry: 0,
          trust_level: 0,
          predictability: 0
        },
        domain: {
          workplace: 0,
          legal_exposure: 0,
          financial_exposure: 0,
          safety_exposure: 0
        },
        history: {
          pattern_repetition: 0,
          prior_boundaries_failed: 0,
          prior_documentation_exists: 0
        },
        communication: {
          channel_risk: 0,
          audience_spillover_risk: 0,
          misinterpretation_risk: 0
        },
        intent: {
          goal_type: null,            // resolve|clarify|boundary|negotiate|record
          relationship_goal: null     // repair|maintain|boundary|exit
        }
      },

      // Facts for Realizer
      facts: {
        what_happened: "",
        key_refs: ""
      },

      // Output selection (optional)
      output: {
        format: null, // message|email|script
        include_insight: true
      },

      // Result
      result: {
        strategy_map: null,
        message_text: "",
        subject: "",
        email_text: "",
        script_text: ""
      }
    };
  }
  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch {
      return defaultState();
    }
  }
  function saveState(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  let state = loadState();

  // -------------------------
  // Flow
  // -------------------------
  const TOTAL_STEPS = 6;
  let step = 1;
  let screen = "interview"; // interview|review|format|result

  const stepQuote = {
    1: "Start with who they are and how power moves.",
    2: "Risk = probability × cost. Measure the stakes.",
    3: "Patterns change the posture.",
    4: "Facts are the backbone. Evidence reduces chaos.",
    5: "Intent decides structure and CTA.",
    6: "Channel and timing define misread risk."
  };

  // Stepper
  function buildStepIndicator(){
    stepsHost.innerHTML = "";
    for (let i=1;i<=TOTAL_STEPS;i++){
      stepsHost.appendChild(el(`<div class="cb-stepdot" data-dot="${i}" data-state="inactive">${i}</div>`));
      if (i < TOTAL_STEPS){
        stepsHost.appendChild(el(`<div class="cb-connector" data-conn="${i}"><i></i></div>`));
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

  function setChromeVisible(visible){
    if (quoteEl) quoteEl.style.display = visible ? "" : "none";
    const progress = root.querySelector(".progress");
    if (progress) progress.style.display = visible ? "" : "none";
    if (navEl) navEl.style.display = visible ? "flex" : "none";
  }

  function requiredOk(){
    if (screen !== "interview") return true;

    const s = state.signals;
    if (step === 1) return true; // sliders only, ok
    if (step === 2) return true;
    if (step === 3) return true;
    if (step === 4) return (state.facts.what_happened || "").trim().length >= 40;
    if (step === 5) return !!s.intent.goal_type && !!s.intent.relationship_goal;
    if (step === 6) return true;
    return true;
  }

  function refreshNav(){
    saveState();
    updateProgress();
    backBtn.style.display = (step === 1) ? "none" : "";
    nextBtn.textContent = (step === TOTAL_STEPS) ? "Review" : "Next";
    nextBtn.disabled = !requiredOk();
  }

  // -------------------------
  // UI building blocks
  // -------------------------
  function makeTile({ label, desc, active }){
    return el(`
      <div class="cb-tile" role="button" tabindex="0" data-active="${active ? "true":"false"}">
        <div style="display:flex;flex-direction:column;gap:6px;align-items:inherit;justify-content:center;width:100%;">
          <div class="cb-tile-label">${escapeHtml(label)}</div>
          ${desc ? `<div class="cb-tile-desc">${escapeHtml(desc)}</div>` : ""}
        </div>
      </div>
    `);
  }

  function makeSlider({ label, help, value15, onChange }){
    const wrap = el(`
      <div style="margin-top:16px;">
        <label style="margin:18px 0 8px;">${escapeHtml(label)}</label>
        ${help ? `<div class="help" style="margin-top:0;">${escapeHtml(help)}</div>` : ""}
        <div class="card" style="padding:18px;margin:10px 0 0;">
          <input type="range" min="1" max="5" step="1" value="${value15}" data-s />
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-weight:700;opacity:.75;">
            <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
          </div>
        </div>
      </div>
    `);
    const input = wrap.querySelector("[data-s]");
    input.addEventListener("input", (e)=> onChange(Number(e.target.value)));
    return wrap;
  }

  // -------------------------
  // Render
  // -------------------------
  function render(){
    setMessage("", "");
    host.innerHTML = "";

    setChromeVisible(screen === "interview");

    if (screen === "interview"){
      updateProgress();
      refreshNav();

      if (step === 1) return renderStep1();
      if (step === 2) return renderStep2();
      if (step === 3) return renderStep3();
      if (step === 4) return renderStep4();
      if (step === 5) return renderStep5();
      if (step === 6) return renderStep6();
    }

    if (screen === "review") return renderReview();
    if (screen === "format") return renderFormat();
    if (screen === "result") return renderResult();
  }

  // -------------------------
  // Step 1: Counterparty & Power
  // -------------------------
  function renderStep1(){
    const s = state.signals;

    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 1</div>
          <h3 class="cb-stepq">Counterparty & Power</h3>
        </div>
        <div class="help">This determines tone ceiling and documentation posture.</div>
        <div data-sliders></div>
      </div>
    `);

    const box = wrap.querySelector("[data-sliders]");

    box.appendChild(makeSlider({
      label: "How much power or authority do they have over you?",
      help: "Think: decision rights, leverage, influence.",
      value15: Math.round(s.counterparty.power_asymmetry/25)+1,
      onChange: (v)=>{ s.counterparty.power_asymmetry = norm15(v); saveState(); refreshNav(); }
    }));

    box.appendChild(makeSlider({
      label: "How much do you trust them to act fairly?",
      help: "Higher trust reduces escalation risk.",
      value15: Math.round(s.counterparty.trust_level/25)+1,
      onChange: (v)=>{ s.counterparty.trust_level = norm15(v); saveState(); refreshNav(); }
    }));

    box.appendChild(makeSlider({
      label: "How predictable is their reaction?",
      help: "Low predictability increases misinterpretation risk.",
      value15: Math.round(s.counterparty.predictability/25)+1,
      onChange: (v)=>{ s.counterparty.predictability = norm15(v); saveState(); refreshNav(); }
    }));

    host.appendChild(wrap);
  }

  // -------------------------
  // Step 2: Stakes & Exposure
  // -------------------------
  function renderStep2(){
    const s = state.signals;

    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 2</div>
          <h3 class="cb-stepq">Stakes & Exposure</h3>
        </div>
        <div class="help">Risk is probability × cost. This captures the cost.</div>
        <div data-sliders></div>
      </div>
    `);

    const box = wrap.querySelector("[data-sliders]");

    box.appendChild(makeSlider({
      label: "Severity if this goes wrong",
      help: "Reputation, money, relationship, job risk.",
      value15: Math.round(s.stakes.severity/25)+1,
      onChange: (v)=>{ s.stakes.severity = norm15(v); saveState(); refreshNav(); }
    }));

    box.appendChild(makeSlider({
      label: "How irreversible is the damage?",
      help: "If it fails, can you recover quickly?",
      value15: Math.round(s.stakes.irreversibility/25)+1,
      onChange: (v)=>{ s.stakes.irreversibility = norm15(v); saveState(); refreshNav(); }
    }));

    box.appendChild(makeSlider({
      label: "Time pressure",
      help: "Urgency increases escalation probability.",
      value15: Math.round(s.stakes.time_pressure/25)+1,
      onChange: (v)=>{ s.stakes.time_pressure = norm15(v); saveState(); refreshNav(); }
    }));

    // domain exposures
    box.appendChild(makeSlider({
      label: "Legal/HR exposure",
      help: "Higher = avoid admissions, avoid absolutes, record-safe language.",
      value15: Math.round(s.domain.legal_exposure/25)+1,
      onChange: (v)=>{ s.domain.legal_exposure = norm15(v); saveState(); refreshNav(); }
    }));

    box.appendChild(makeSlider({
      label: "Financial exposure",
      help: "Higher = formal structure, clearer constraints.",
      value15: Math.round(s.domain.financial_exposure/25)+1,
      onChange: (v)=>{ s.domain.financial_exposure = norm15(v); saveState(); refreshNav(); }
    }));

    host.appendChild(wrap);
  }

  // -------------------------
  // Step 3: History & Pattern
  // -------------------------
  function renderStep3(){
    const s = state.signals;

    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 3</div>
          <h3 class="cb-stepq">History & Pattern</h3>
        </div>
        <div class="help">Patterns change the boundary strength and CTA type.</div>
        <div data-sliders></div>
      </div>
    `);

    const box = wrap.querySelector("[data-sliders]");

    box.appendChild(makeSlider({
      label: "How repetitive is this issue?",
      help: "Repeated patterns require boundary or record posture.",
      value15: Math.round(s.history.pattern_repetition/25)+1,
      onChange: (v)=>{ s.history.pattern_repetition = norm15(v); saveState(); refreshNav(); }
    }));

    box.appendChild(makeSlider({
      label: "Have prior boundaries failed?",
      help: "Higher = more structured boundary + confirm CTA.",
      value15: Math.round(s.history.prior_boundaries_failed/25)+1,
      onChange: (v)=>{ s.history.prior_boundaries_failed = norm15(v); saveState(); refreshNav(); }
    }));

    box.appendChild(makeSlider({
      label: "Is there existing documentation (emails, logs)?",
      help: "Higher = align with evidence language, timestamps.",
      value15: Math.round(s.history.prior_documentation_exists/25)+1,
      onChange: (v)=>{ s.history.prior_documentation_exists = norm15(v); saveState(); refreshNav(); }
    }));

    host.appendChild(wrap);
  }

  // -------------------------
  // Step 4: Facts & Evidence
  // -------------------------
  function renderStep4(){
    const s = state.signals;

    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 4</div>
          <h3 class="cb-stepq">Facts & Evidence</h3>
        </div>
        <div class="help">Facts feed the generator. Signals below tune structure.</div>

        <label>Factual description</label>
        <textarea data-facts maxlength="1200" placeholder="2–6 factual sentences. Avoid assumptions."></textarea>

        <label>Optional key references</label>
        <input type="text" data-refs placeholder="Dates, IDs, project name, etc. (optional)" />

        <div class="warn" data-warn style="display:none;margin-top:14px;"></div>

        <div style="margin-top:10px;" data-sliders></div>
      </div>
    `);

    const ta = wrap.querySelector("[data-facts]");
    const refs = wrap.querySelector("[data-refs]");
    const warn = wrap.querySelector("[data-warn]");
    const box = wrap.querySelector("[data-sliders]");

    ta.value = state.facts.what_happened || "";
    refs.value = state.facts.key_refs || "";

    function check(){
      const ok = (state.facts.what_happened || "").trim().length >= 40;
      warn.style.display = ok ? "none" : "block";
      warn.textContent = ok ? "" : "Please provide facts (at least a few sentences).";
      refreshNav();
    }

    ta.addEventListener("input", ()=>{
      state.facts.what_happened = ta.value;
      saveState();
      check();
    });
    refs.addEventListener("input", ()=>{
      state.facts.key_refs = refs.value;
      saveState();
    });

    box.appendChild(makeSlider({
      label: "Misinterpretation risk",
      help: "Higher = more explicit structure + clarification buffer.",
      value15: Math.round(s.communication.misinterpretation_risk/25)+1,
      onChange: (v)=>{ s.communication.misinterpretation_risk = norm15(v); saveState(); refreshNav(); }
    }));

    check();
    host.appendChild(wrap);
  }

  // -------------------------
  // Step 5: Intent
  // -------------------------
  function renderStep5(){
    const s = state.signals;

    const goalOptions = [
      { key:"clarify",   label:"Clarify",   desc:"Align facts, expectations, timeline." },
      { key:"resolve",   label:"Resolve",   desc:"Close the issue with a clean action." },
      { key:"negotiate", label:"Negotiate", desc:"Propose options and tradeoffs." },
      { key:"boundary",  label:"Boundary",  desc:"Define what you can/can’t do." },
      { key:"record",    label:"Record",    desc:"Document safely; minimal emotion." }
    ];

    const relOptions = [
      { key:"repair",   label:"Repair",   desc:"Preserve relationship; soften edges." },
      { key:"maintain", label:"Maintain", desc:"Keep stable; procedural tone." },
      { key:"boundary", label:"Redefine", desc:"Reset expectations; stronger frame." },
      { key:"exit",     label:"Exit",     desc:"Close loop and disengage." }
    ];

    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 5</div>
          <h3 class="cb-stepq">Intent & Relationship Goal</h3>
        </div>
        <div class="help">These two selections drive structure blocks and CTA type.</div>

        <label>Primary goal</label>
        <div class="cb-tilegrid" data-goal style="grid-template-columns:1fr;"></div>

        <label>Relationship goal</label>
        <div class="cb-tilegrid" data-rel style="grid-template-columns:1fr;"></div>
      </div>
    `);

    const g = wrap.querySelector("[data-goal]");
    goalOptions.forEach(opt=>{
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: s.intent.goal_type === opt.key });
      attachChoose(tile, ()=>{ s.intent.goal_type = opt.key; saveState(); render(); });
      g.appendChild(tile);
    });

    const r = wrap.querySelector("[data-rel]");
    relOptions.forEach(opt=>{
      const tile = makeTile({ label: opt.label, desc: opt.desc, active: s.intent.relationship_goal === opt.key });
      attachChoose(tile, ()=>{ s.intent.relationship_goal = opt.key; saveState(); render(); });
      r.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  // -------------------------
  // Step 6: Timing & Channel
  // -------------------------
  function renderStep6(){
    const s = state.signals;

    const channelOptions = [
      { key:"text",  label:"Text / Chat", desc:"Fast but easy to misread." , risk: 70 },
      { key:"email", label:"Email",      desc:"Structured, record-friendly.", risk: 45 },
      { key:"note",  label:"Formal Note",desc:"Most conservative; documentation posture.", risk: 30 }
    ];

    const wrap = el(`
      <div>
        <div class="cb-stephead">
          <div class="cb-stepkicker">Step 6</div>
          <h3 class="cb-stepq">Timing & Channel Risk</h3>
        </div>
        <div class="help">This affects tone, structure, and ambiguity buffer.</div>

        <div data-sliders></div>

        <label>Audience spillover risk</label>
        <div class="help">Could this be forwarded or shared?</div>

        <div data-spill></div>

        <label>Preferred channel</label>
        <div class="cb-tilegrid" data-channel style="grid-template-columns:1fr;"></div>
      </div>
    `);

    const box = wrap.querySelector("[data-sliders]");
    box.appendChild(makeSlider({
      label: "Channel risk baseline",
      help: "General risk from the communication medium.",
      value15: Math.round(s.communication.channel_risk/25)+1,
      onChange: (v)=>{ s.communication.channel_risk = norm15(v); saveState(); refreshNav(); }
    }));

    const spill = wrap.querySelector("[data-spill]");
    spill.appendChild(makeSlider({
      label: "Audience spillover risk",
      help: "Higher = safer wording + record posture.",
      value15: Math.round(s.communication.audience_spillover_risk/25)+1,
      onChange: (v)=>{ s.communication.audience_spillover_risk = norm15(v); saveState(); refreshNav(); }
    }));

    const chGrid = wrap.querySelector("[data-channel]");
    channelOptions.forEach(opt=>{
      const active = (s.communication.channel_risk === opt.risk);
      const tile = makeTile({ label: opt.label, desc: opt.desc, active });
      attachChoose(tile, ()=>{
        s.communication.channel_risk = opt.risk;
        saveState(); render();
      });
      chGrid.appendChild(tile);
    });

    host.appendChild(wrap);
  }

  // -------------------------
  // Review Screen (Strategy Map preview, no generation yet)
  // -------------------------
  function renderReview(){
    setChromeVisible(false);

    const s = state.signals;

    const wrap = el(`
      <div>
        <h2 style="margin:0 0 10px;font-size:28px;letter-spacing:-0.02em;">Review signals</h2>
        <div style="opacity:.72;font-weight:650;margin:0 0 18px;">
          This is the engine input. Next: choose output format and generate.
        </div>

        <div class="card" style="margin:0;">
          <div style="font-weight:900;margin-bottom:10px;">Signals (normalized)</div>
          <div class="mono">${escapeHtml(JSON.stringify(s, null, 2))}</div>
        </div>

        <div class="nav" style="margin-top:18px;">
          <div class="cb-nav-left">
            <button type="button" class="cb-btn-secondary" data-back>Back</button>
          </div>
          <div class="cb-nav-right">
            <button type="button" class="cb-btn-primary" data-next>Continue</button>
          </div>
        </div>
      </div>
    `);

    wrap.querySelector("[data-back]").addEventListener("click", ()=>{
      screen = "interview";
      step = 6;
      render();
    });
    wrap.querySelector("[data-next]").addEventListener("click", ()=>{
      screen = "format";
      render();
    });

    host.appendChild(wrap);
  }

  // -------------------------
  // Format selection + Generate
  // -------------------------
  function renderFormat(){
    setChromeVisible(false);

    const formats = [
      { key:"message", label:"Message", desc:"Short, structured draft." },
      { key:"email",   label:"Email",   desc:"Subject + structured email." },
      { key:"script",  label:"Conversation Script", desc:"A safe talk track." }
    ];

    const wrap = el(`
      <div>
        <h2 style="margin:0 0 10px;font-size:28px;letter-spacing:-0.02em;">Choose output</h2>
        <div style="opacity:.72;font-weight:650;margin:0 0 18px;">
          Strategy map will always be generated. Output format is optional.
        </div>

        <div class="card" style="margin:0 0 12px;">
          <div style="font-weight:900;margin-bottom:10px;">Include Strategic Insight</div>
          <div style="opacity:.72;font-weight:650;">Recommended. This is what makes it a strategy engine.</div>
          <div style="margin-top:12px;">
            <button type="button" class="cb-btn-secondary" data-toggle>
              ${state.output.include_insight ? "Included" : "Off"}
            </button>
          </div>
        </div>

        <label>Format</label>
        <div class="cb-tilegrid" data-fmt style="grid-template-columns:1fr;"></div>

        <div class="nav" style="margin-top:18px;">
          <div class="cb-nav-left">
            <button type="button" class="cb-btn-secondary" data-back>Back</button>
          </div>
          <div class="cb-nav-right">
            <button type="button" class="cb-btn-primary" data-generate ${state.output.format ? "" : "disabled"}>Generate</button>
          </div>
        </div>

        <div data-hint style="margin-top:12px;"></div>
      </div>
    `);

    const fmtGrid = wrap.querySelector("[data-fmt]");
    const genBtn = wrap.querySelector("[data-generate]");
    const hint = wrap.querySelector("[data-hint]");

    function refreshGen(){
      genBtn.disabled = !state.output.format;
      saveState();
    }

    formats.forEach(f=>{
      const tile = makeTile({ label:f.label, desc:f.desc, active: state.output.format === f.key });
      attachChoose(tile, ()=>{
        state.output.format = f.key;
        refreshGen();
        render(); // rerender to show active
      });
      fmtGrid.appendChild(tile);
    });

    wrap.querySelector("[data-toggle]").addEventListener("click", ()=>{
      state.output.include_insight = !state.output.include_insight;
      saveState();
      render();
    });

    wrap.querySelector("[data-back]").addEventListener("click", ()=>{
      screen = "review";
      render();
    });

    genBtn.addEventListener("click", async ()=>{
      if (!state.output.format) return;

      // facts requirement is already enforced at step 4, but double-check
      if ((state.facts.what_happened || "").trim().length < 40){
        hint.innerHTML = "<div class='warn'>Facts are required (Step 4).</div>";
        return;
      }

      genBtn.disabled = true;
      hint.innerHTML = "<div class='ok'>Generating…</div>";

      // Payload contract (engine-first)
      const payload = {
        state: {
          signals: state.signals,
          facts: state.facts,
          output: {
            format: state.output.format,
            include_insight: state.output.include_insight
          },
          // package mapping for existing backend switches
          paywall: {
            package: state.output.format === "script" ? "message" : state.output.format,
            addon_insight: !!state.output.include_insight
          }
        }
      };

      try{
        const r = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify(payload)
        });

        const text = await r.text();
        const data = (()=>{ try { return JSON.parse(text); } catch { return null; } })();

        if (!r.ok || !data || data.ok !== true){
          const errMsg = data?.message || data?.error || ("HTTP_" + r.status);
          hint.innerHTML = `<div class='warn'>Generation failed: ${escapeHtml(errMsg)}</div>`;
          genBtn.disabled = false;
          return;
        }

        // Store results (strategy_map + selected output)
        const d = data.data || {};
        state.result.strategy_map = d.strategy_map || d.insight || null;

        // Backward compatible fields
        state.result.message_text = (d.message_text || "").trim();
        state.result.subject = (d.subject || "").trim();
        state.result.email_text = (d.email_text || "").trim();

        // If backend later returns script_text, keep it
        state.result.script_text = (d.script_text || "").trim();

        saveState();
        screen = "result";
        render();

      } catch {
        hint.innerHTML = "<div class='warn'>Network error.</div>";
        genBtn.disabled = false;
      }
    });

    refreshGen();
    host.appendChild(wrap);
  }

  // -------------------------
  // Result
  // -------------------------
  function renderResult(){
    setChromeVisible(false);

    const strategy = state.result.strategy_map;
    const hasStrategy = !!strategy;

    const outFmt = state.output.format;

    const textOut =
      outFmt === "email"
        ? ((state.result.subject ? ("Subject: " + state.result.subject + "\n\n") : "") + (state.result.email_text || ""))
        : outFmt === "script"
          ? (state.result.script_text || state.result.message_text || "")
          : (state.result.message_text || "");

    const wrap = el(`
      <div>
        <h2 style="margin:0 0 10px;font-size:28px;letter-spacing:-0.02em;">Result</h2>
        <div style="opacity:.72;font-weight:650;margin:0 0 18px;">
          Strategy map + output draft.
        </div>

        ${hasStrategy ? `
          <details class="card" open>
            <summary style="cursor:pointer;font-weight:800;">Strategy Map</summary>
            <div class="mono" style="margin-top:12px;">${escapeHtml(
              typeof strategy === "string" ? strategy : JSON.stringify(strategy, null, 2)
            )}</div>
          </details>
        ` : ""}

        <div class="card" style="margin-top:14px;">
          <div style="font-weight:900;margin-bottom:10px;">Output (${escapeHtml(outFmt || "—")})</div>
          <div class="mono" data-out></div>
        </div>

        <div style="display:flex;gap:10px;margin-top:14px;">
          <button type="button" class="cb-btn-secondary" data-copy>Copy</button>
          <button type="button" class="cb-btn-secondary" data-download>Download</button>
        </div>

        <div style="margin-top:18px;">
          <button type="button" class="cb-btn-secondary" data-new>Start Over</button>
        </div>
      </div>
    `);

    const outEl = wrap.querySelector("[data-out]");
    outEl.textContent = (textOut || "").trim();

    wrap.querySelector("[data-copy]").addEventListener("click", async ()=>{
      const parts = [];
      if (hasStrategy) parts.push("STRATEGY_MAP\n" + (typeof strategy === "string" ? strategy : JSON.stringify(strategy, null, 2)));
      if (textOut) parts.push("OUTPUT\n" + textOut.trim());
      const full = parts.join("\n\n---\n\n");
      try{
        await navigator.clipboard.writeText(full);
        setMessage("ok", "Copied.");
      } catch {
        setMessage("warn", "Copy failed in this browser context.");
      }
    });

    wrap.querySelector("[data-download]").addEventListener("click", ()=>{
      const parts = [];
      if (hasStrategy) parts.push("STRATEGY_MAP\n" + (typeof strategy === "string" ? strategy : JSON.stringify(strategy, null, 2)));
      if (textOut) parts.push("OUTPUT\n" + textOut.trim());
      const full = parts.join("\n\n---\n\n");
      const blob = new Blob([full], { type:"text/plain;charset=utf-8" });
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
      saveState();
      screen = "interview";
      step = 1;
      render();
    });

    host.appendChild(wrap);
  }

  // -------------------------
  // Nav events
  // -------------------------
  backBtn.addEventListener("click", ()=>{
    if (screen !== "interview") return;
    if (step > 1) step -= 1;
    render();
  });

  nextBtn.addEventListener("click", ()=>{
    if (screen !== "interview") return;
    if (!requiredOk()) return;

    if (step < TOTAL_STEPS){
      step += 1;
      render();
      return;
    }
    screen = "review";
    render();
  });

  // -------------------------
  // Boot
  // -------------------------
  buildStepIndicator();
  screen = "interview";
  step = 1;
  render();

})();
