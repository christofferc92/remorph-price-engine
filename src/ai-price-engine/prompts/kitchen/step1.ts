/**
 * STEP 1 Prompt Builder for Kitchen Renovations
 */

import { analyzeDescription, buildContextInstructions } from '../../lib/descriptionAnalyzer';

export function buildStep1Prompt(userDescription: string, simplified: boolean = false): string {
    // Analyze user description for intent and preferences
    const analysis = analyzeDescription(userDescription);
    const contextInstructions = buildContextInstructions(analysis);
    const questionCount = analysis.suggested_question_count;

    const schema = simplified
        ? `{
  "inferred_project_type": "kitchen",
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
  "inferred_project_type": "kitchen",
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
- Cabinet refresh only (5-7 questions): Focus on cabinet type, quantity, hardware, installation complexity
- Countertop replacement (5-7 questions): Material, size, edge profile, sink cutouts, installation
- Partial kitchen (8-10 questions): Identify what to replace vs keep, plus details for selected elements
- Full kitchen (11-15 questions): Comprehensive coverage of cabinets, countertops, appliances, plumbing, electrical, flooring

Key principles:
- Focus on questions that materially affect cost, scope, time, risk, and trade requirements in Sweden.
- Do NOT ask aesthetic/style questions unless they impact cost (e.g., IKEA vs custom cabinets, laminate vs stone countertops).
- Prefer confirmation of inferred facts: if you can infer something from the image, propose your best guess with confidence and ask the user to confirm/correct.
- Do NOT invent hidden facts (e.g., plumbing condition, electrical capacity). If unknown, ask explicitly with "Vet ej" option.
- Use Swedish language in questions and outputs.
- Currency is SEK (kr). Units should be metric (m², löpm for countertops).
- Keep questions minimal but sufficient for an offertunderlag. If you must choose, prioritize cost drivers over "nice-to-have" info.

Kitchen-specific focus:
- Scope lock first (cabinet-only vs countertop-only vs partial vs full kitchen)
- Cabinet type and quality (IKEA Metod, Marbodal, Ballingslöv, custom)
- Countertop material (laminat, komposit/Silestone, natursten/granit/marmor)
- Appliances to include/replace (spis, kyl, diskmaskin, fläkt)
- Plumbing relocations (diskho, diskmaskin)
- Electrical work (uttag, belysning, spisanslutning)
- Flooring changes
- Demolition and disposal of old kitchen
- Region/kommun (affects labor rates) if needed

PREFILL/CONFIRM FLOW:
- For questions where you CAN infer an answer from the image:
  - Set ask_mode="confirm"
  - Provide prefill_guess with your best estimate
  - Set prefill_confidence based on how certain you are
  - Explain your reasoning in prefill_basis_sv
- For questions where you CANNOT infer from the image:
  - Set ask_mode="ask"
  - Leave prefill_guess, prefill_confidence, prefill_basis_sv as null

QUESTION PRIORITIZATION:
- Priority 1 (always include): Scope definition, kitchen size, cabinet type, countertop material
- Priority 2 (include for partial/full): Appliances, plumbing changes, electrical work
- Priority 3 (include for full only): Flooring, demolition extent, layout changes

OUTPUT REQUIREMENTS:
- Must be valid JSON
- Must be EXACTLY ${questionCount} questions in follow_up_questions array
- Each question must have all required fields
- Questions should be ordered by priority (most important first)
- Use Swedish language for all user-facing text

Return ONLY valid JSON.
`;
}
