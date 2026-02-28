/**
 * STEP 1 Prompt Builder for Kitchen Renovations
 *
 * Generates EXACTLY 4 priority questions for the initial phase.
 * The AI also outputs a recommended_total_questions (5-20) based on
 * renovation complexity. The frontend uses that value to suggest how
 * many questions the user should answer in total.
 */

import { analyzeDescription, buildContextInstructions } from '../../lib/descriptionAnalyzer';

export function buildStep1Prompt(userDescription: string, simplified: boolean = false): string {
  // Analyze user description for intent and preferences
  const analysis = analyzeDescription(userDescription);
  const contextInstructions = buildContextInstructions(analysis);
  const recommendedTotal = analysis.recommended_total_questions;

  const schema = simplified
    ? `{
  "inferred_project_type": "kitchen",
  "recommended_total_questions": <integer between 5 and 20>,
  "follow_up_questions": [
    {
      "id": "q1",
      "priority": 1,
      "question_sv": "Short question in Swedish?",
      "type": "yes_no" | "single_choice" | "number",
      "options": ["option1", "option2"],
      "maps_to": "scope_level",
      "why_it_matters_sv": "1 short sentence in Swedish",
      "ask_mode": "ask",
      "prefill_guess": null,
      "prefill_confidence": null,
      "prefill_basis_sv": null
    }
    ... EXACTLY 4 total questions ...
  ]
}`
    : `{
  "inferred_project_type": "kitchen",
  "recommended_total_questions": <integer between 5 and 20>,
  "image_observations": {
    "summary_sv": "Brief summary in Swedish of what you see",
    "inferred_size_sqm": {
      "value": <number>,
      "confidence": "low" | "medium" | "high",
      "basis_sv": "Explanation in Swedish"
    },
    "visible_elements": ["element1", "element2", ...],
    "uncertainties": ["uncertainty1", ...]
  },
  "scope_guess": {
    "value": "cabinet_refresh" | "countertop_only" | "partial_kitchen" | "full_kitchen" | "unclear",
    "confidence": "low" | "medium" | "high",
    "basis_sv": "Explanation in Swedish"
  },
  "follow_up_questions": [
    {
      "id": "q1",
      "priority": 1,
      "question_sv": "Question in Swedish?",
      "type": "yes_no" | "single_choice" | "text" | "number",
      "options": ["option1", "option2", "Vet ej"],
      "maps_to": "scope_level",
      "why_it_matters_sv": "Short explanation in Swedish",
      "ask_mode": "confirm" | "ask",
      "prefill_guess": "value from image" | null,
      "prefill_confidence": "low" | "medium" | "high" | null,
      "prefill_basis_sv": "Why I guessed this from the image" | null
    }
    ... EXACTLY 4 total questions ...
  ]
}`;

  const retryInstructions = simplified
    ? "\nSTRICT RULE: Be extremely concise. Max 10 words per text field. No long explanations. Swedish language."
    : "";

  return `You are an assistant for Swedish renovation estimating. Your job in STEP 1 is to analyze the provided image and the user's text description and generate EXACTLY 4 high-priority follow-up questions. These are the FIRST 4 questions presented to the user before they decide how many questions to answer in total.
${retryInstructions}

USER'S DESCRIPTION: "${userDescription}"
${contextInstructions}

RECOMMENDED TOTAL QUESTIONS:
Based on the renovation complexity, set "recommended_total_questions" to a value between 5 and 20:
- Cabinet refresh or countertop-only: 5-7 questions total
- Partial kitchen (some elements): 8-11 questions total
- Full kitchen renovation: 12-16 questions total
- Very complex (layout changes, structural, premium): 16-20 questions total
Your estimate this time: ${recommendedTotal} (adjust ±3 based on what you observe in the image and description)

CRITICAL: Output EXACTLY 4 follow_up_questions. No more, no less.
These 4 questions must be the HIGHEST priority – establishing scope and major cost drivers.
DO NOT include an address, location, or municipality question – that is handled separately by the app.

Key principles for these 4 questions:
- Focus on questions that materially affect cost, scope, time, risk, and trade requirements in Sweden.
- Do NOT ask aesthetic/style questions unless they impact cost (e.g., IKEA vs custom cabinets, laminate vs stone countertops).
- Prefer confirmation of inferred facts: if you can infer from the image, propose your best guess.
- Do NOT invent hidden facts (e.g., plumbing condition, electrical capacity). If unknown, ask with "Vet ej" option.
- Use Swedish language in questions and outputs.
- Currency is SEK (kr). Units should be metric (m², löpm for countertops).

Kitchen-specific focus for the initial 4 questions:
1. Scope lock (cabinet-refresh vs countertop-only vs partial vs full kitchen) – ALWAYS question 1
2. Kitchen size / cabinet count – ALWAYS question 2
3. Cabinet quality tier (IKEA Metod, semi-custom Marbodal, fully custom) – key cost driver
4. Countertop material (laminat, komposit/Silestone, natursten) OR appliances included – pick most impactful

PREFILL/CONFIRM FLOW:
- For questions where you CAN infer an answer from the image:
  - Set ask_mode="confirm", provide prefill_guess, prefill_confidence, and prefill_basis_sv
- For questions where you CANNOT infer from the image:
  - Set ask_mode="ask", set prefill_* fields to null

OUTPUT REQUIREMENTS:
- Must be valid JSON
- Must be EXACTLY 4 questions in follow_up_questions array
- Each question must have all required fields
- Questions should be ordered by priority (most important first)
- Use Swedish language for all user-facing text

Return ONLY valid JSON.
`;
}
