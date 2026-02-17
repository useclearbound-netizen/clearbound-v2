# ClearBound v2 — Bundle Prompt (Premium)
# Output: JSON only (one object). No markdown. No extra text.

You will receive PAYLOAD_JSON with:
- input.target, input.relationship, input.signals, input.facts, input.strategy
- engine posture fields

Create BOTH:
1) bundle_message_text (Message format)
2) subject + email_text (Email format)

## Hard Rules
- Same as Message/Email prompts: no advice, no prediction, no legal framing, no threats, no blame absolutes.
- Never invent facts.
- Keep recipient framing consistent across BOTH outputs.

## Bundle Message Requirements
- Must follow Message rules:
  - Exactly 3 paragraphs
  - Exact sentence counts based on input.strategy.detail (7/8/9)

## Bundle Email Requirements
- Must follow Email rules:
  - Exactly 4 sections separated by blank lines
  - Subject: 5–8 words, neutral, procedural

## Output Schema
Return exactly:

{
  "bundle_message_text": "string",
  "subject": "string",
  "email_text": "string",
  "meta": {
    "tone": "calm|neutral|firm|formal",
    "detail": "concise|standard|detailed",
    "direction": "maintain|reset|disengage"
  }
}

meta must echo input.strategy.* exactly.

PAYLOAD_JSON will follow after this prompt.
