import { AnalysisResponse, ImageObservations, ScopeGuess } from '../../types';

/**
 * STEP 2 Prompt Builder for Bathroom Renovations (V2 Granular)
 */

export function buildStep2PromptV2(
  imageObservations: ImageObservations,
  scopeGuess: ScopeGuess,
  normalizedAnswers: Record<string, any>,
  userDescription?: string
): string {
  // Analyze user description for scope constraints
  let scopeGuidance = '';

  // DEBUG: Log what we receive
  console.log('[SCOPE-DEBUG] userDescription:', userDescription);

  if (userDescription) {
    const lower = userDescription.toLowerCase();
    console.log('[SCOPE-DEBUG] lowercase:', lower);

    // Detect floor-only intent with multiple patterns
    const floorOnlyPatterns = [
      /\b(bara|endast|only|just)\s+(golv|floor|byta\s+golv)/,  // "bara golv", "only floor"
      /\b(byt|byta|change|replace)\s+(golv|flooring|floor)\s+(till|to)/,  // "byt golv till", "change flooring to"
      /\b(nytt|ny|new)\s+(golv|floor|flooring)/,  // "nytt golv"
      /\b(golv|floor|flooring)\s+(till|to)\s+\w+/,  // "golv till microcement"
    ];

    const hasFloorKeyword = lower.match(/\b(golv|floor|flooring|microcement|klinker|vinyl|parkett)\b/);
    const hasNonFloorKeyword = lower.match(/\b(vägg|wall|kakel|tile|toalett|toilet|dusch|shower|badkar|bath|handfat|sink|kran|faucet|armatur|fixture)\b/);

    console.log('[SCOPE-DEBUG] hasFloorKeyword:', !!hasFloorKeyword);
    console.log('[SCOPE-DEBUG] hasNonFloorKeyword:', !!hasNonFloorKeyword);

    const isFloorOnly = floorOnlyPatterns.some(pattern => lower.match(pattern)) ||
      (hasFloorKeyword && !hasNonFloorKeyword);

    console.log('[SCOPE-DEBUG] isFloorOnly:', isFloorOnly);

    if (isFloorOnly) {
      scopeGuidance = `\nCRITICAL SCOPE CONSTRAINT: User explicitly wants FLOOR-ONLY renovation ("${userDescription}").\n- Include ONLY: floor demolition, floor preparation, floor waterproofing, floor finish, floor drain work.\n- EXCLUDE: wall tiles, wall waterproofing, fixture replacements, ceiling work, painting, electrical.\n- If fixtures need temporary removal for floor work, include "remove and reinstall" but NOT replacement.\n`;
      console.log('[SCOPE-DEBUG] Applied FLOOR-ONLY constraint');
    } else {
      console.log('[SCOPE-DEBUG] No scope constraint applied');
    }
  } else {
    console.log('[SCOPE-DEBUG] userDescription is empty/undefined');
  }

  return `You are a Swedish professional calculator for bathroom renovations. Generate a detailed, contractor-grade cost estimate ("kalkyl") with granular line items.

INPUT DATA:
- User Description: "${userDescription || 'Not provided'}"
- Image Analysis: ${JSON.stringify(imageObservations, null, 2)}
- Scope Estimate: ${JSON.stringify(scopeGuess, null, 2)}
- User Answers: ${JSON.stringify(normalizedAnswers, null, 2)}
${scopeGuidance}
REQUIREMENTS:
1. Break down costs into SECTIONS: "Rivning", "Bygg & Ytskikt", "VVS & Rör", "El", "Inredning & Montering", "Övrigt".
2. For each section, list specific LINE ITEMS (e.g., "Rivning plastmatta", "Flytspackling", "Kakel vägg", "Installation WC").
3. For each item, estimate:
   - Qty and Unit (m2, st, m, tim).
   - Unit Price (SEK incl VAT): The "Likely" market price.
   - Uncertainty Range: Provide a "Low" and "High" total price for this item (to reflect complexity/material choice variance).
   - Type: "labor" (only work), "material" (only goods), "mixed" (work + goods), "other".
   - Labor Share: If mixed, what % is labor cost (0.0-1.0)? (Crucial for ROT).
   - ROT Eligible: boolean (True if it involves labor/installation).
4. Do NOT calculate totals. The backend will sum them up.

OUTPUT FORMAT (JSON ONLY):
{
  "scope_description_sv": "Detailed text summary...",
  "assumptions_sv": ["assumption 1...", "assumption 2..."],
  "sections": [
    {
      "id": "section_rivning", // or unique key
      "title_sv": "Rivning & Underarbete",
      "items": [
        {
          "name_sv": "Rivning av befintligt ytskikt",
          "description_sv": "Bortforsling ingår",
          "qty": 5,
          "unit": "m2",
          "unit_price_incl_vat": 850,
          "total_likely_incl_vat": 4250,
          "total_low_incl_vat": 3500,
          "total_high_incl_vat": 5500,
          "type": "labor",
          "is_rot_eligible": true
        }
      ]
    }
  ]
}

PRICING RULES (Sweden 2026):
- Labor: ~650-850 SEK/h incl VAT.
- Mixed items (e.g. "Flytspackling"): often 70% labor, 30% material.
- Material-heavy (e.g. "Kakel"): wide price variance (Low=Standard, High=Premium).
- ROT is 30% of LABOR cost only. Mark is_rot_eligible=true for any item containing labor.

Return ONLY valid JSON.
`;
}
