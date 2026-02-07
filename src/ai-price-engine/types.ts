/**
 * Type definitions for the Swedish bathroom renovation analysis API
 */

export type QuestionType = 'yes_no' | 'single_choice' | 'text' | 'number';

export type ScopeValue = 'floor_only' | 'floor_plus_heat' | 'partial_bathroom' | 'full_bathroom' | 'unclear';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type AskMode = 'confirm' | 'ask';

export interface FollowUpQuestion {
    id: string;
    priority: number;
    question_sv: string;
    type: QuestionType;
    options?: string[];
    maps_to: string;
    why_it_matters_sv: string;
    // Prefill fields for image-inferred answers
    prefill_guess?: string | number | null;
    prefill_confidence?: ConfidenceLevel | null;
    ask_mode: AskMode;
    prefill_basis_sv?: string | null;
}

export interface ImageObservations {
    summary_sv: string;
    inferred_size_sqm: {
        value: number;
        confidence: ConfidenceLevel;
        basis_sv: string;
    };
    visible_elements: string[];
    uncertainties: string[];
}

export interface ScopeGuess {
    value: ScopeValue;
    confidence: ConfidenceLevel;
    basis_sv: string;
}

export interface AnalysisResponse {
    user_description: string;  // Preserve original user input for downstream use
    inferred_project_type: string;
    image_observations?: ImageObservations;
    scope_guess?: ScopeGuess;
    follow_up_questions: FollowUpQuestion[];
}

// ============================================
// STEP 2: Offertunderlag Generation Types
// ============================================

export interface OffertRequest {
    step1: AnalysisResponse;
    answers: Record<string, any>; // keyed by question id
}

export interface ConfirmedInputs {
    floor_area_sqm: number | null;
    scope_level: string;
    waterproofing: string;
    underfloor_heating: string;
    floor_drain: string;
    demolition: string;
    tile_price_tier: string;
    tile_size_category: string;
    fixture_changes: string;
    access_conditions: string;
    location_municipality: string;
}

export interface PriceRange {
    low: number;
    high: number;
    confidence: ConfidenceLevel;
}

export interface CostItem {
    low: number;
    high: number;
    notes_sv: string;
}

export interface AdditionalCosts {
    low: number;
    high: number;
    items: string[];
}

export interface CostBreakdown {
    labor_sek: CostItem;
    materials_sek: CostItem;
    additional_costs_sek: AdditionalCosts;
}

export interface OffertResponse {
    project_type: string;
    scope_summary_sv: string;
    assumptions_sv: string[];
    confirmed_inputs: ConfirmedInputs;
    price_range_sek: PriceRange;
    cost_breakdown_estimate: CostBreakdown;
    major_cost_drivers_sv: string[];
    risk_and_uncertainty_factors_sv: string[];
    what_can_change_price_sv: string[];
    contractor_summary_sv: string;
}

// ============================================
// Estimate V2 Contract Types (Harden)
// ============================================

export type Currency = "SEK";
export type ItemType = 'labor' | 'material' | 'mixed' | 'other';
export type UnitType = 'm2' | 'st' | 'm' | 'tim' | 'pkt' | 'sum' | 'lpm' | 'kg'; // Added 'sum'

export interface RotInputV2 {
    apply_rot: boolean;
    owners_count: 1 | 2;
    rot_used_sek: number; // 0..100000
}

export interface RotParamsV2 {
    eligible_labor_base_ex_vat_sek: number;
    applied_percent: 0.30;
    max_cap_sek: number;
    remaining_cap_sek: number;
    max_cap_reached: boolean;
    warnings: string[];
}

export interface LineItemV2 {
    id: string; // UUID
    name_sv: string;
    description_sv?: string;

    // Explicit inputs
    qty: number;
    unit: UnitType;
    unit_price_incl_vat: number;

    type: ItemType;
    labor_share?: number; // 0..1, required if type === 'mixed'
    is_rot_eligible: boolean;

    // Calculated (Always present, Incl VAT)
    total_likely_incl_vat: number;
    total_low_incl_vat: number;
    total_high_incl_vat: number;

    // Override Metadata
    manual_override?: boolean;

    // Baseline (for resets - optional storage)
    original_qty?: number;
    original_unit_price?: number;
}

export interface SectionV2 {
    id: string;
    title_sv: string;
    items: LineItemV2[];
}

export interface EstimateSummaryV2 {
    total_likely_incl_vat: number;
    total_low_incl_vat: number; // RSS
    total_high_incl_vat: number; // RSS

    total_excl_vat: number;
    total_vat: number;

    total_rot_deduction: number;
    net_to_pay: number;

    breakdown: {
        labor: number;    // incl VAT
        material: number; // incl VAT
        other: number;    // incl VAT
    };
}

export interface EstimateResponseV2 {
    estimate_version: 2;
    estimate_id: string;
    currency: Currency;
    created_at_iso: string;
    updated_at_iso: string;

    rot_input: RotInputV2;
    rot_params: RotParamsV2;

    summary: EstimateSummaryV2;
    sections: SectionV2[];

    // Context
    scope_summary_sv: string;
    assumptions_sv: string[];
}

export interface RepriceRequestV2 {
    estimate_id: string;
    rot_input?: RotInputV2;

    edits?: Array<{
        line_item_id: string;
        qty?: number;
        unit?: UnitType;
        unit_price_sek_incl_vat?: number;
        labor_share_percent?: number;
        is_rot_eligible?: boolean;
        manual_override?: boolean;
    }>;

    reset_overrides?: boolean;
}
