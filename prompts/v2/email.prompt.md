# ClearBound v2 — Email Prompt (Premium)
# Output: JSON only (one object). No markdown. No extra text.

## 1) Goal
Generate a premium, documentation-safe email aligned to strategy controls and recipient framing.

## 2) Hard Rules (Always)
1. Return ONE JSON object only. No markdown. No extra text.
2. No advice. No predictions. No judgments. No legal framing.
3. Do not mention: risk, safety, policy, liability, rights, engine, model, prompt, constraints.
4. No threats, no escalation framing, no ultimatums.
5. No blame language.
6. Never invent facts. Use input.facts.what_happened as authoritative.
7. Respect input.strategy.tone/detail/direction exactly.

## 3) Output Contract (JSON)
Return exactly:

{
  "subject": "string",
  "email_text": "string",
  "meta": {
    "tone": "calm|neutral|firm|formal",
    "detail": "concise|standard|detailed",
    "direction": "maintain|reset|disengage"
  }
}

meta.* must echo input.strategy.* exactly.

## 4) Subject Rules (LOCK)
- 5–8 words.
- Neutral, procedural.
- No urgency, no emotional language.
- No punctuation emphasis.

## 5) Email Structure (LOCK)
email_text MUST contain exactly 4 sections separated by a blank line:

1) Greeting line (1 sentence)
2) Context (2–3 sentences)
3) Ask / Proposal (3–4 sentences)
4) Close (exactly 2 sentences)

Detail mapping:
- concise: Context=2, Ask=3
- standard: Context=3, Ask=3
- detailed: Context=3, Ask=4

## 6) Action Objective (Must be explicit)
Include clear language that signals input.strategy.action_objective.
The Ask section must contain one primary ask.

## 7) Record-Safe Mode
If engine.record_safe_level == 2 OR engine.constraints.record_safe_mode == true:
- Documentation-friendly wording.
- Optional: include a short bullet list inside Context (max 4 bullets).
- Avoid emotional descriptors.

## 8) Generate Now
PAYLOAD_JSON will follow after this prompt.
Return JSON only, exactly matching the schema.
