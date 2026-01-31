import { buildBathroomAfterImagePrompt } from '../src/ai-image-engine/prompts/bathroomAfterImagePrompt';
import { AnalysisResponse } from '../src/ai-price-engine/types';

// Mock Step 1 data
const mockStep1: AnalysisResponse = {
    inferred_project_type: 'bathroom_renovation',
    image_observations: {
        summary_sv: 'Ett badrum med klinker på golv och väggar, synlig dusch, toalett och handfat. Rummet är ca 5-6 m².',
        inferred_size_sqm: {
            value: 5.5,
            confidence: 'medium',
            basis_sv: 'Baserat på synliga element och proportioner',
        },
        visible_elements: ['dusch', 'toalett', 'handfat', 'kakel'],
        uncertainties: ['Exakt golvarea', 'Tillstånd bakom kakel'],
    },
    scope_guess: {
        value: 'floor_only',
        confidence: 'medium',
        basis_sv: 'Användaren nämnde golvbyte',
    },
    follow_up_questions: [
        {
            id: 'q1_scope',
            priority: 1,
            question_sv: 'Vad är omfattningen av renoveringen?',
            type: 'single_choice',
            options: ['Endast golvbyte', 'Delvis renovering', 'Totalrenovering'],
            maps_to: 'scope_level',
            why_it_matters_sv: 'Påverkar pris och arbetsomfattning',
            prefill_guess: 'Endast golvbyte',
            prefill_confidence: 'medium',
            ask_mode: 'confirm',
            prefill_basis_sv: 'Baserat på användarens beskrivning',
        },
        {
            id: 'q2_floor',
            priority: 2,
            question_sv: 'Vilken typ av golv vill du ha?',
            type: 'single_choice',
            options: ['Klinker', 'Klinker mosaik', 'Natursten'],
            maps_to: 'floor_finish',
            why_it_matters_sv: 'Påverkar materialkostnad',
            ask_mode: 'ask',
        },
        {
            id: 'q3_heating',
            priority: 3,
            question_sv: 'Vill du ha golvvärme?',
            type: 'yes_no',
            maps_to: 'underfloor_heating',
            why_it_matters_sv: 'Påverkar komfort och kostnad',
            ask_mode: 'ask',
        },
        {
            id: 'q4_walls',
            priority: 4,
            question_sv: 'Hur högt ska väggarna kaklas?',
            type: 'single_choice',
            options: ['Ingen förändring', 'Våtrumszon', 'Hela vägghöjden'],
            maps_to: 'wall_tile_height',
            why_it_matters_sv: 'Påverkar materialkostnad och arbete',
            ask_mode: 'ask',
        },
        {
            id: 'q5_toilet',
            priority: 5,
            question_sv: 'Ska toaletten bytas?',
            type: 'single_choice',
            options: ['Behåll befintlig', 'Byt till modern vägghängd', 'Byt till golvstående'],
            maps_to: 'toilet',
            why_it_matters_sv: 'Påverkar kostnad och utseende',
            ask_mode: 'ask',
        },
    ],
};

console.log('='.repeat(80));
console.log('EXAMPLE PROMPT A: FLOOR-ONLY SCENARIO');
console.log('='.repeat(80));
console.log('');

const answersFloorOnly = {
    q1_scope: 'Endast golvbyte',
    q2_floor: 'Klinker',
    q3_heating: 'Ja',
    q4_walls: 'Vet ej',
    q5_toilet: 'Vet ej',
};

const promptFloorOnly = buildBathroomAfterImagePrompt({
    description: 'Modern white tiles',
    step1: mockStep1,
    answers: answersFloorOnly,
});

console.log(promptFloorOnly);
console.log('');
console.log('');

console.log('='.repeat(80));
console.log('EXAMPLE PROMPT B: FULL RENOVATION SCENARIO');
console.log('='.repeat(80));
console.log('');

const answersFull = {
    q1_scope: 'Totalrenovering',
    q2_floor: 'Klinker',
    q3_heating: 'Ja',
    q4_walls: 'Hela vägghöjden',
    q5_toilet: 'Byt till modern vägghängd',
};

const promptFull = buildBathroomAfterImagePrompt({
    description: 'Modern Scandinavian bathroom with clean lines',
    step1: mockStep1,
    answers: answersFull,
});

console.log(promptFull);
console.log('');
