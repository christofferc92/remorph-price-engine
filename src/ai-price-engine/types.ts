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
    inferred_project_type: string;
    image_observations: ImageObservations;
    scope_guess: ScopeGuess;
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
