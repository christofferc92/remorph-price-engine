
import {
    LineItemV2,
    SectionV2,
    EstimateSummaryV2,
    RotParamsV2,
    EstimateResponseV2,
    RotInputV2,
    ItemType
} from '../ai-price-engine/types';

// Deterministic Constants
const VAT_RATE = 0.25; // 25%
const ROT_PERCENT = 0.30; // 30%
const ROT_CAP_PER_PERSON = 50000;

/**
 * Pure function to compute totals for a single line item.
 * Calculates likely total and ensures low/high values exist (using fallback if needed).
 */
function computeLineTotals(item: LineItemV2): LineItemV2 {
    // Capture baseline if missing (First Run)
    const original_qty = item.original_qty ?? item.qty;
    const original_unit_price = item.original_unit_price ?? item.unit_price_sek_incl_vat;

    const likely = Math.round(item.qty * item.unit_price_sek_incl_vat);

    // Fallback uncertainty if not provided (e.g. from simplistic AI output)
    // If item has valid ranges, keep them. Otherwise, apply +/- 10% default.
    // We check if "total_low_sek_incl_vat" is 0 or missing (if it was optional, but it's required in V2).
    // We assume the caller (AI parser or Repricer) might pass incomplete items, so we ensure safety.

    let low = item.total_low_sek_incl_vat;
    let high = item.total_high_sek_incl_vat;

    // If ranges are seemingly invalid (low > likely or high < likely), we might reset them?
    // Or if they are equal to likely (no spread), we keep them.
    // If they are 0, we imply they need calculation.
    if (!low && !high) {
        low = Math.round(likely * 0.90);
        high = Math.round(likely * 1.10);
    }

    return {
        ...item,
        total_likely_sek_incl_vat: likely,
        total_low_sek_incl_vat: low,
        total_high_sek_incl_vat: high,
        original_qty,
        original_unit_price
    };
}

/**
 * Calculates Estimate V2 based on sections and ROT settings.
 */
export function calculateEstimate(
    rawSections: SectionV2[],
    rotInput: RotInputV2,
    estimateId: string,
    existingEstimate: Partial<EstimateResponseV2> = {}
): EstimateResponseV2 {

    // 1. Process Line Items (Compute Totals)
    const processedSections = rawSections.map(section => ({
        ...section,
        items: section.items.map(computeLineTotals)
    }));

    // Aggregators
    let totalLikely = 0;
    let sumSqDiffLow = 0;
    let sumSqDiffHigh = 0;

    let aggLaborIncl = 0;
    let aggMaterialIncl = 0;
    let aggOtherIncl = 0;

    let aggEligibleLaborBaseExVat = 0;

    // 2. Iterate to sum totals and variance
    for (const section of processedSections) {
        for (const item of section.items) {
            const likely = item.total_likely_sek_incl_vat;
            totalLikely += likely;

            // RSS Variance
            const dLow = Math.max(0, likely - item.total_low_sek_incl_vat);
            const dHigh = Math.max(0, item.total_high_sek_incl_vat - likely);
            sumSqDiffLow += (dLow * dLow);
            sumSqDiffHigh += (dHigh * dHigh);

            // Breakdown
            if (item.type === 'labor') {
                aggLaborIncl += likely;
                if (item.is_rot_eligible) {
                    aggEligibleLaborBaseExVat += likely / (1 + VAT_RATE);
                }
            } else if (item.type === 'material') {
                aggMaterialIncl += likely;
            } else if (item.type === 'mixed') {
                const share = item.labor_share_percent ?? 0;
                const laborPart = likely * share;
                const materialPart = likely - laborPart;

                aggLaborIncl += laborPart;
                aggMaterialIncl += materialPart;

                if (item.is_rot_eligible) {
                    aggEligibleLaborBaseExVat += laborPart / (1 + VAT_RATE);
                }
            } else {
                aggOtherIncl += likely;
            }
        }
    }

    // 3. RSS Totals
    const devLowTotal = Math.sqrt(sumSqDiffLow);
    const devHighTotal = Math.sqrt(sumSqDiffHigh);

    const totalLow = Math.max(0, Math.round(totalLikely - devLowTotal));
    const totalHigh = Math.round(totalLikely + devHighTotal);

    // 4. VAT
    const totalExVat = Math.round(totalLikely / (1 + VAT_RATE));
    const totalVat = totalLikely - totalExVat;

    // 5. ROT Calculation
    const rotCap = ROT_CAP_PER_PERSON * rotInput.owners_count;
    const remainingCap = Math.max(0, rotCap - rotInput.rot_used_sek);

    let rotDeduction = 0;
    let maxCapReached = false;
    let rotWarnings: string[] = [];

    if (rotInput.apply_rot) {
        const potentialRot = aggEligibleLaborBaseExVat * ROT_PERCENT;

        if (potentialRot > remainingCap) {
            rotDeduction = remainingCap;
            maxCapReached = true;
            rotWarnings.push("ROT-taket är redan uppnått eller begränsar avdraget.");
        } else {
            rotDeduction = potentialRot;
        }

        if (aggEligibleLaborBaseExVat <= 0) {
            rotWarnings.push("Inget ROT-grundande arbete i kalkylen.");
        }
        if (remainingCap <= 0) {
            rotWarnings.push("Inget ROT-utrymme kvar.");
        }
    }

    rotDeduction = Math.floor(rotDeduction); // Avrunda neråt för säkerhets skull? Standard round works too.
    const netToPay = Math.round(totalLikely - rotDeduction);

    // Construct Response
    const now = new Date().toISOString();

    const summary: EstimateSummaryV2 = {
        total_likely_incl_vat: Math.round(totalLikely),
        total_low_incl_vat: totalLow,
        total_high_incl_vat: totalHigh,
        total_excl_vat: totalExVat, // Added per schema
        total_vat: totalVat,
        total_rot_deduction: rotDeduction,
        net_to_pay: netToPay,
        breakdown: {
            labor: Math.round(aggLaborIncl),
            material: Math.round(aggMaterialIncl),
            other: Math.round(aggOtherIncl)
        }
    };

    const rotParams: RotParamsV2 = {
        eligible_labor_base_ex_vat_sek: Math.round(aggEligibleLaborBaseExVat),
        applied_percent: 0.30,
        max_cap_sek: rotCap,
        remaining_cap_sek: remainingCap,
        max_cap_reached: maxCapReached,
        warnings: rotWarnings
    };

    return {
        estimate_version: 2,
        estimate_id: estimateId,
        currency: "SEK",
        created_at_iso: existingEstimate.created_at_iso || now, // Preserve if exists
        updated_at_iso: now,
        rot_input: rotInput,
        rot_params: rotParams,
        summary,
        sections: processedSections,
        scope_summary_sv: existingEstimate.scope_summary_sv || "",
        assumptions_sv: existingEstimate.assumptions_sv || []
    };
}
