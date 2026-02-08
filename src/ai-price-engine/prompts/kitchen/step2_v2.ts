/**
 * STEP 2 Prompt Builder for Kitchen Renovations (V2)
 */

import { ImageObservations, ScopeGuess } from '../../types';

export function buildStep2PromptV2(
    imageObservations: ImageObservations,
    scopeGuess: ScopeGuess,
    normalizedAnswers: Record<string, any>,
    userDescription?: string
): string {
    // Analyze user description for scope constraints
    let scopeGuidance = '';

    if (userDescription) {
        const lower = userDescription.toLowerCase();

        // Detect cabinet-only intent
        const cabinetOnlyPatterns = [
            /\b(bara|endast|only|just)\s+(skåp|luckor|cabinet|door)/,
            /\b(byt|byta|change|replace)\s+(luckor|skåp|cabinet|door)/,
            /\b(nya|new)\s+(luckor|skåp|cabinet|door)/,
        ];

        // Detect countertop-only intent
        const countertopOnlyPatterns = [
            /\b(bara|endast|only|just)\s+(bänk|countertop|worktop)/,
            /\b(byt|byta|change|replace)\s+(bänkskiva|countertop|worktop)/,
            /\b(ny|new)\s+(bänkskiva|countertop|worktop)/,
        ];

        const isCabinetOnly = cabinetOnlyPatterns.some(pattern => lower.match(pattern));
        const isCountertopOnly = countertopOnlyPatterns.some(pattern => lower.match(pattern));

        if (isCabinetOnly) {
            scopeGuidance = `\nCRITICAL SCOPE CONSTRAINT: User explicitly wants CABINET-ONLY renovation ("${userDescription}").\n- Include ONLY: cabinet removal, new cabinet installation, hardware, assembly labor.\n- EXCLUDE: countertops, appliances, plumbing, electrical (unless needed for cabinet installation), flooring.\n- If existing countertop needs temporary removal for cabinets, include "remove and reinstall" but NOT replacement.\n`;
        } else if (isCountertopOnly) {
            scopeGuidance = `\nCRITICAL SCOPE CONSTRAINT: User explicitly wants COUNTERTOP-ONLY replacement ("${userDescription}").\n- Include ONLY: countertop removal, new countertop fabrication and installation, sink cutouts, edge finishing.\n- EXCLUDE: cabinets, appliances, plumbing relocation, electrical work, flooring.\n- If sink needs temporary disconnection, include "disconnect and reconnect" but NOT replacement.\n`;
        }
    }

    return `You are a Swedish professional calculator for kitchen renovations. Generate a detailed, contractor-grade cost estimate ("kalkyl") with granular line items.
${scopeGuidance}

IMAGE OBSERVATIONS:
${JSON.stringify(imageObservations, null, 2)}

SCOPE GUESS:
${JSON.stringify(scopeGuess, null, 2)}

USER ANSWERS:
${JSON.stringify(normalizedAnswers, null, 2)}

OUTPUT FORMAT (JSON ONLY):
{
  "scope_description_sv": "Detailed text summary...",
  "assumptions_sv": ["assumption 1...", "assumption 2..."],
  "overall_confidence": "low" | "medium" | "high",
  "confidence_notes_sv": ["reason for uncertainty 1...", "reason for uncertainty 2..."],
  "sections": [
    {
      "id": "section_rivning", // or unique key
      "title_sv": "Rivning & Bortforsling",
      "items": [
        {
          "name_sv": "Rivning av befintligt kök",
          "description_sv": "Inkl. bortforsling",
          "qty": 1,
          "unit": "paket",
          "unit_price_incl_vat": 15000,
          "total_likely_incl_vat": 15000,
          "total_low_incl_vat": 12000,
          "total_high_incl_vat": 18000,
          "type": "labor",
          "is_rot_eligible": true,
          "price_confidence": "medium",
          "quantity_confidence": "high"
        }
      ]
    }
  ]
}

CONFIDENCE SCORING:
- price_confidence: "high" if standard market rate, "medium" if regional variation, "low" if specialized/rare work
- quantity_confidence: "high" if visible in image, "medium" if inferred from size, "low" if guessed
- overall_confidence: "high" if all items high confidence, "medium" if some uncertainty, "low" if significant unknowns
- confidence_notes_sv: List specific reasons for low/medium confidence (e.g., "Kökets exakta storlek oklar", "Specialskåp - prisvariation stor")

PRICING RULES (Sweden 2026):
- Labor: ~650-850 SEK/h incl VAT.
- Cabinet installation (IKEA): ~30 000-50 000 SEK for standard kitchen (8-12 cabinets)
- Cabinet installation (custom): ~50 000-80 000 SEK for standard kitchen
- Demolition and disposal: ~12 000-18 000 SEK for full kitchen
- Countertop installation: ~5 000-15 000 SEK depending on material and complexity
- Plumbing work (sink relocation): ~8 000-15 000 SEK
- Electrical work (new outlets, lighting): ~10 000-20 000 SEK
- Flooring (if included): ~400-800 SEK/m² installed
- ROT is 30% of LABOR cost only. Mark is_rot_eligible=true for any item containing labor.

MATERIAL PRICING (Sweden 2026):
Cabinets:
- IKEA Metod (budget): ~40 000-80 000 SEK for 8-12 cabinets with basic doors
- IKEA Metod (mid-range): ~80 000-120 000 SEK with better doors/finishes
- Marbodal/Ballingslöv (mid-range): ~150 000-250 000 SEK
- Custom cabinets (premium): ~250 000-400 000 SEK

Countertops (per m², installed):
- Laminat: ~1 500-2 500 SEK/m²
- Komposit (Silestone, Caesarstone): ~4 000-6 000 SEK/m²
- Natursten (granit, marmor): ~5 000-8 000 SEK/m²
- Trä (massiv ek, valnöt): ~3 000-5 000 SEK/m²

Appliances (if included):
- Budget range (IKEA/basic): ~15 000-25 000 SEK total
- Mid-range (Electrolux, Bosch): ~30 000-50 000 SEK total
- Premium (Miele, Gaggenau): ~80 000-150 000 SEK total

SECTION STRUCTURE:
Organize line items into logical sections:
1. "Rivning & Bortforsling" - Demolition and disposal
2. "Skåp & Stommar" - Cabinets and cabinet boxes
3. "Bänkskivor" - Countertops
4. "Vitvaror" - Appliances (if included)
5. "VVS-arbeten" - Plumbing work
6. "Elarbeten" - Electrical work
7. "Golv" - Flooring (if included)
8. "Övrigt" - Other items (painting, trim, etc.)

ITEM TYPES:
- "labor" = pure labor (installation, demolition)
- "material" = pure material (cabinets, countertops, appliances)
- "mixed" = material + installation (e.g., "Bänkskiva inkl. montering")
  - For mixed items, set labor_share to 0.2-0.4 (20-40% labor, rest material)

Return ONLY valid JSON.
`;
}
