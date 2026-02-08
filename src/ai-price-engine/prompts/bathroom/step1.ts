/**
 * STEP 1 Prompt Builder for Bathroom Renovations
 * 
 * Future: Add prompts/kitchen, prompts/painting for other room types
 */

import { analyzeDescription, buildContextInstructions } from '../../lib/descriptionAnalyzer';

export function buildStep1Prompt(userDescription: string, simplified: boolean = false): string {
  // Analyze user description for intent and preferences
  const analysis = analyzeDescription(userDescription);
  const contextInstructions = buildContextInstructions(analysis);
  const questionCount = analysis.suggested_question_count;

  const schema = simplified
    ? `{
  "inferred_project_type": "bathroom",
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
    ... EXACTLY ${questionCount} total questions ...
  ]
}`
    : `{
  "inferred_project_type": "bathroom",
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
    ... EXACTLY ${questionCount} total questions ...
  ]
}`;

  const retryInstructions = simplified
    ? "\nSTRICT RULE: Be extremely concise. Max 10 words per text field. No long explanations. Swedish language."
    : "";

  return `You are an assistant for Swedish renovation estimating. Your job in STEP 1 is to analyze the provided image and the user's text description and generate EXACTLY ${questionCount} follow-up questions needed to produce a contractor-usable "offertunderlag" and an initial price range estimate in SEK (kr) later.
${retryInstructions}

USER'S DESCRIPTION: "${userDescription}"
${contextInstructions}

QUESTION COUNT RULES:
- Floor-only scope (5-7 questions): Focus on floor material, bathroom size, underfloor heating, current flooring, access constraints
- Partial renovation (8-10 questions): Identify scope boundaries (what to renovate vs preserve), plus key details for selected areas
- Full bathroom (11-15 questions): Comprehensive coverage of floor, walls, ceiling, fixtures, plumbing, electrical, ventilation

Key principles:
- Focus on questions that materially affect cost, scope, time, risk, and trade requirements in Sweden.
- Do NOT ask aesthetic/style questions unless they impact cost (e.g., tile size, tile price tier, pattern complexity).
- Prefer confirmation of inferred facts: if you can infer something from the image, propose your best guess with confidence and ask the user to confirm/correct.
- Do NOT invent hidden facts (e.g., age of waterproofing, condition behind walls). If unknown, ask explicitly with "Vet ej" option.
- Use Swedish language in questions and outputs.
- Currency is SEK (kr). Units should be metric (m², mm).
- Keep questions minimal but sufficient for an offertunderlag. If you must choose, prioritize cost drivers over "nice-to-have" info.

Bathroom-specific focus (for now):
- Scope lock first (floor-only vs full bathroom vs partial)
- Waterproofing/tätskikt and wet-room compliance implications
- Demolition/removal type (matta/klinker, etc.)
- Floor drain and slope/fall work
- Underfloor heating
- Fixture removals/reinstallations
- Material class and tile size/pattern complexity
- Accessibility constraints that affect labor (occupied home, timing, access)
- Region/kommun (affects labor rates) if needed

PREFILL/CONFIRM FLOW:
- For questions where you CAN infer an answer from the image:
  - Set ask_mode="confirm"
  - Provide prefill_guess with your best estimate
  - Set prefill_confidence based on how certain you are
  - Explain your reasoning in prefill_basis_sv
- For questions where you CANNOT infer from the image:
  - Set ask_mode="ask"
- Drain condition or placement (unless clearly visible)
- Electrical scope
- Waste disposal responsibility
- Municipality/location
- User preferences (timeline, budget tier, etc.)

Return ONLY valid JSON matching this exact schema:
${schema}

CRITICAL RULES:
- Must be EXACTLY 10 questions in follow_up_questions array
- Questions must be ordered by priority (highest pricing impact first)
- Each question must have a maps_to key from this list: scope_level, floor_area_sqm_confirmed, waterproofing_needed, demolition_existing_floor, subfloor_leveling_needed, floor_drain_present, slope_adjustment_needed, underfloor_heating, tile_price_tier, tile_size_category, laying_pattern_complexity, fixture_remove_reinstall, access_constraints, location_municipality, waste_disposal_needed, start_time_preference
- Use single_choice instead of text whenever possible
- Include "Vet ej" option where relevant for ask_mode="ask" questions
- All text in Swedish (question_sv, why_it_matters_sv, summary_sv, basis_sv, prefill_basis_sv)
- For ask_mode="confirm": MUST provide prefill_guess, prefill_confidence, and prefill_basis_sv
- For ask_mode="ask": prefill_guess, prefill_confidence, and prefill_basis_sv should be null
- Return ONLY the JSON, no markdown code blocks or extra text`;
}
