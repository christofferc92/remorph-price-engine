/**
 * Description Analysis Utility
 * Extracts intent signals from user descriptions to adapt question generation
 */

export interface DescriptionAnalysis {
    primary_intent: 'floor_only' | 'partial' | 'full' | 'unclear';
    explicit_requests: string[];
    explicit_exclusions: string[];
    budget_signals: 'budget' | 'mid' | 'premium' | 'unclear';
    urgency_signals: 'quick' | 'normal' | 'flexible';
    suggested_question_count: number;
}

/**
 * Analyze user description to extract renovation intent and preferences
 */
export function analyzeDescription(description: string): DescriptionAnalysis {
    const lower = description.toLowerCase();

    const analysis: DescriptionAnalysis = {
        primary_intent: 'unclear',
        explicit_requests: [],
        explicit_exclusions: [],
        budget_signals: 'unclear',
        urgency_signals: 'normal',
        suggested_question_count: 10,
    };

    // Detect primary intent
    if (lower.match(/\b(bara|endast|only|just)\s+(golv|floor|byta\s+golv)/)) {
        analysis.primary_intent = 'floor_only';
        analysis.suggested_question_count = 6;
    } else if (lower.match(/\b(golv|floor)\b/) && !lower.match(/\b(vägg|wall|kakel|tile|toalett|toilet|dusch|shower|badkar|bath)/)) {
        // If only mentions floor and nothing else
        analysis.primary_intent = 'floor_only';
        analysis.suggested_question_count = 6;
    } else if (lower.match(/\b(total|komplett|full|helt|complete)/)) {
        analysis.primary_intent = 'full';
        analysis.suggested_question_count = 12;
    } else if (lower.match(/\b(delvis|partial|vissa|byt.*och)/)) {
        analysis.primary_intent = 'partial';
        analysis.suggested_question_count = 10;
    }

    // Extract explicit requests
    const requestPatterns = [
        { pattern: /golvvärme|underfloor\s*heat/, value: 'golvvärme' },
        { pattern: /dusch|shower/, value: 'dusch' },
        { pattern: /badkar|bathtub|bath/, value: 'badkar' },
        { pattern: /toalett|toilet|wc/, value: 'toalett' },
        { pattern: /handfat|vanity|sink/, value: 'handfat' },
        { pattern: /kakel|tiles/, value: 'kakel' },
        { pattern: /tätskikt|waterproof/, value: 'tätskikt' },
        { pattern: /belysning|light/, value: 'belysning' },
    ];

    for (const { pattern, value } of requestPatterns) {
        if (lower.match(pattern)) {
            analysis.explicit_requests.push(value);
        }
    }

    // Extract exclusions
    const exclusionPatterns = [
        { pattern: /behåll.*?(toalett|toilet)/, value: 'behåll toalett' },
        { pattern: /behåll.*?(handfat|sink|vanity)/, value: 'behåll handfat' },
        { pattern: /behåll.*?(dusch|shower)/, value: 'behåll dusch' },
        { pattern: /behåll.*?(badkar|bathtub)/, value: 'behåll badkar' },
        { pattern: /(inte|not|don't).*?(vägg|wall)/, value: 'inte väggar' },
        { pattern: /(inte|not|don't).*?(tak|ceiling)/, value: 'inte tak' },
    ];

    for (const { pattern, value } of exclusionPatterns) {
        if (lower.match(pattern)) {
            analysis.explicit_exclusions.push(value);
        }
    }

    // Detect budget signals
    if (lower.match(/\b(budget|billig|cheap|ekonomisk)/)) {
        analysis.budget_signals = 'budget';
    } else if (lower.match(/\b(premium|lyx|luxury|high.?end|exklusiv)/)) {
        analysis.budget_signals = 'premium';
    } else if (lower.match(/\b(mellan|mid|standard|normal)/)) {
        analysis.budget_signals = 'mid';
    }

    // Detect urgency
    if (lower.match(/\b(snabb|quick|asap|fort|skynda)/)) {
        analysis.urgency_signals = 'quick';
    } else if (lower.match(/\b(flexibel|flexible|ingen brådska|no rush)/)) {
        analysis.urgency_signals = 'flexible';
    }

    return analysis;
}

/**
 * Generate context instructions for prompt based on analysis
 */
export function buildContextInstructions(analysis: DescriptionAnalysis): string {
    const instructions: string[] = [];

    // Intent-based instructions
    if (analysis.primary_intent === 'floor_only') {
        instructions.push('CONTEXT: User wants floor-only renovation.');
        instructions.push('- Prioritize: floor material, underfloor heating, drain, waterproofing');
        instructions.push('- De-prioritize or skip: fixture replacement, wall tiles, ceiling');
        instructions.push(`- Target ${analysis.suggested_question_count} questions (not 10)`);
    } else if (analysis.primary_intent === 'full') {
        instructions.push('CONTEXT: User wants full bathroom renovation.');
        instructions.push('- Cover all aspects: floor, walls, ceiling, fixtures, systems');
        instructions.push('- Include detailed material and finish questions');
        instructions.push(`- Target ${analysis.suggested_question_count} questions for comprehensive coverage`);
    } else if (analysis.primary_intent === 'partial') {
        instructions.push('CONTEXT: User wants partial renovation.');
        instructions.push('- Focus on identifying which areas to renovate vs preserve');
        instructions.push('- Ask about scope boundaries clearly');
    }

    // Explicit requests
    if (analysis.explicit_requests.length > 0) {
        instructions.push(`\nEXPLICIT USER REQUESTS: ${analysis.explicit_requests.join(', ')}`);
        instructions.push('- Include questions about these specific items');
        instructions.push('- Prioritize these in question ordering');
    }

    // Exclusions
    if (analysis.explicit_exclusions.length > 0) {
        instructions.push(`\nEXPLICIT EXCLUSIONS: ${analysis.explicit_exclusions.join(', ')}`);
        instructions.push('- Skip questions about excluded items');
        instructions.push('- Assume these items will be preserved');
    }

    // Budget signals
    if (analysis.budget_signals !== 'unclear') {
        instructions.push(`\nBUDGET TIER: ${analysis.budget_signals}`);
        if (analysis.budget_signals === 'budget') {
            instructions.push('- Focus on cost-effective options');
            instructions.push('- Emphasize material choices that affect price');
        } else if (analysis.budget_signals === 'premium') {
            instructions.push('- Include premium material and finish options');
            instructions.push('- Ask about high-end features');
        }
    }

    return instructions.length > 0 ? '\n' + instructions.join('\n') + '\n' : '';
}
