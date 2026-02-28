/**
 * STEP 1 Prompt Builder for Bathroom Renovations
 *
 * Generates EXACTLY 4 priority questions for the initial phase.
 * The AI also outputs a recommended_total_questions (5-20) based on
 * renovation complexity. The frontend uses that value to suggest how
 * many questions the user should answer in total.
 *
 * Question 5 is ALWAYS the address/location question – handled by the
 * frontend (optional geolocation), so we never include it here.
 * Questions 6+ are generated dynamically via /generate-more-questions.
 */

import { analyzeDescription, buildContextInstructions } from '../../lib/descriptionAnalyzer';

export function buildStep1Prompt(userDescription: string, simplified: boolean = false): string {
  // Analyze user description for intent and preferences
  const analysis = analyzeDescription(userDescription);
  const contextInstructions = buildContextInstructions(analysis);
  const recommendedTotal = analysis.recommended_total_questions;

  const schema = simplified
    ? `{
  "inferred_project_type": "bathroom",
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
  "inferred_project_type": "bathroom",
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
    "value": "floor_only" | "floor_plus_heat" | "partial_bathroom" | "full_bathroom" | "unclear",
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

  return `You are an assistant for Swedish renovation estimating. Your job in STEP 1 is to analyze the provided image and the user's text description and generate EXACTLY 4 high-priority follow-up questions. These are the FIRST 4 questions that will be presented to the user before they choose how many total questions they want to answer.
${retryInstructions}

USER'S DESCRIPTION: "${userDescription}"
${contextInstructions}

RECOMMENDED TOTAL QUESTIONS:
Based on the renovation complexity, set "recommended_total_questions" to a value between 5 and 20:
- Floor-only renovation: 5-7 questions total
- Partial renovation (some areas): 8-11 questions total
- Full bathroom renovation: 12-16 questions total
- Very complex (layout changes, premium materials, accessibility): 16-20 questions total
Your estimate this time: ${recommendedTotal} (adjust ±3 based on what you observe in the image and description)

CRITICAL: Output EXACTLY 4 follow_up_questions. No more, no less.
These 4 questions must be the HIGHEST priority questions – the ones most critical for establishing scope and major cost drivers.
DO NOT include an address, location, or municipality question – that is handled separately by the app.

Key principles for these 4 questions:
- Focus on questions that materially affect cost, scope, time, risk, and trade requirements in Sweden.
- Do NOT ask aesthetic/style questions unless they impact cost (e.g., tile size, tile price tier).
- Prefer confirmation of inferred facts: if you can infer something from the image, propose your best guess with confidence and ask the user to confirm/correct.
- Do NOT invent hidden facts. If unknown, ask explicitly with "Vet ej" option.
- Use Swedish language in questions and outputs.
- Currency is SEK (kr). Units should be metric (m², mm).

Bathroom-specific focus for the initial 4 questions:
1. Scope lock (floor-only vs full bathroom vs partial) – ALWAYS question 1
2. Approximate bathroom floor area (size) – ALWAYS question 2
3. Waterproofing/tätskikt need – critical cost driver, ask early
4. Key fixture change (e.g. new shower, toilet, bathtub) OR underfloor heating – pick the most impactful based on context

PREFILL/CONFIRM FLOW:
- For questions where you CAN infer an answer from the image:
  - Set ask_mode="confirm", provide prefill_guess, prefill_confidence, and prefill_basis_sv
- For questions where you CANNOT infer from the image:
  - Set ask_mode="ask", set prefill_* fields to null

Return ONLY valid JSON matching this exact schema:
${schema}

CRITICAL RULES:
- Must be EXACTLY 4 questions in follow_up_questions array
- Questions must be ordered by priority (highest pricing impact first)
- Each question must have a maps_to key from: scope_level, floor_area_sqm_confirmed, waterproofing_needed, demolition_existing_floor, subfloor_leveling_needed, floor_drain_present, slope_adjustment_needed, underfloor_heating, tile_price_tier, tile_size_category, laying_pattern_complexity, fixture_remove_reinstall, access_constraints, waste_disposal_needed, start_time_preference
- Use single_choice instead of text whenever possible
- Include "Vet ej" option where relevant for ask_mode="ask" questions
- All text in Swedish (question_sv, why_it_matters_sv, summary_sv, basis_sv, prefill_basis_sv)
- For ask_mode="confirm": MUST provide prefill_guess, prefill_confidence, and prefill_basis_sv
- For ask_mode="ask": prefill_guess, prefill_confidence, and prefill_basis_sv should be null
- Return ONLY the JSON, no markdown code blocks or extra text`;
}
