import { AnalysisResponse, ImageObservations, ScopeGuess } from '../../types';

/**
 * STEP 2 Prompt Builder for Bathroom Renovations
 * 
 * Future: Add prompts/kitchen, prompts/painting for other room types
 */

export function buildStep2Prompt(
    imageObservations: ImageObservations,
    scopeGuess: ScopeGuess,
    normalizedAnswers: Record<string, any>
): string {
    return `You are a Swedish renovation cost estimator. Generate a contractor-usable "offertunderlag" (quote basis) with realistic pricing in SEK.

STEP 1 ANALYSIS:
${JSON.stringify(imageObservations, null, 2)}

SCOPE GUESS:
${JSON.stringify(scopeGuess, null, 2)}

USER ANSWERS (normalized by maps_to keys):
${JSON.stringify(normalizedAnswers, null, 2)}

CRITICAL INSTRUCTIONS:
- Use CONSERVATIVE (not optimistic) pricing realistic for Swedish certified contractors
- Currency: SEK (kr), Units: metric (m², mm)
- Language: Swedish for all text fields
- Do NOT guess renovation age or compliance details. If unknown, mark as uncertainty and WIDEN the price range.
- Do NOT ask educational questions. Only compute and compile.
- Include "access/occupancy constraints" as a cost driver if unknown
- If answers contain "unknown" or "Vet ej", treat as HIGH UNCERTAINTY and widen ranges significantly
- Price ranges should reflect Swedish market rates for bathroom renovations (2026)
- Labor costs in Sweden: typically 500-800 SEK/hour for certified contractors
- Bathroom floor renovation typically: 15,000-50,000 SEK depending on scope
- Full bathroom renovation typically: 80,000-250,000 SEK depending on scope and quality

Return ONLY valid JSON matching this EXACT schema (no markdown, no code blocks):
{
  "project_type": "bathroom",
  "scope_summary_sv": "Brief summary in Swedish of what will be done",
  "assumptions_sv": ["assumption1 in Swedish", "assumption2 in Swedish"],
  "confirmed_inputs": {
    "floor_area_sqm": <number or null>,
    "scope_level": "<value from answers>",
    "waterproofing": "<value from answers>",
    "underfloor_heating": "<value from answers>",
    "floor_drain": "<value from answers>",
    "demolition": "<value from answers>",
    "tile_price_tier": "<value from answers>",
    "tile_size_category": "<value from answers>",
    "fixture_changes": "<value from answers>",
    "access_conditions": "<value from answers>",
    "location_municipality": "<value from answers>"
  },
  "price_range_sek": {
    "low": <number>,
    "high": <number>,
    "confidence": "low" | "medium" | "high"
  },
  "cost_breakdown_estimate": {
    "labor_sek": {
      "low": <number>,
      "high": <number>,
      "notes_sv": "Explanation in Swedish"
    },
    "materials_sek": {
      "low": <number>,
      "high": <number>,
      "notes_sv": "Explanation in Swedish"
    },
    "additional_costs_sek": {
      "low": <number>,
      "high": <number>,
      "items": ["item1 in Swedish", "item2 in Swedish"]
    }
  },
  "major_cost_drivers_sv": ["driver1 in Swedish", "driver2 in Swedish"],
  "risk_and_uncertainty_factors_sv": ["risk1 in Swedish", "risk2 in Swedish"],
  "what_can_change_price_sv": ["factor1 in Swedish", "factor2 in Swedish"],
  "contractor_summary_sv": "Professional summary in Swedish for contractor"
}

IMPORTANT: Return ONLY the JSON. No explanations, no markdown formatting, just pure JSON.`;
}
