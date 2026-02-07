import { AnalysisResponse, OffertResponse } from '../../ai-price-engine/types';

interface PromptBuilderInput {
    description?: string;
    step1: AnalysisResponse;
    answers: Record<string, string | number>;
    step2?: OffertResponse;
}

interface ParsedAnswers {
    scopeLevel: 'floor_only' | 'partial' | 'full' | 'unknown';
    floorFinish?: string;
    wallTileHeight?: string;
    underfloorHeating?: string;
    tilePriceTier?: string;
    tileSizeCategory?: string;
    fixtureChanges: {
        toilet?: string;
        vanity?: string;
        shower?: string;
        bathtub?: string;
    };
    concealPipes?: string;
    lightingChanges?: string;
}

/**
 * Parse answers into structured spec
 */
function parseAnswers(
    step1: AnalysisResponse,
    answers: Record<string, string | number>
): ParsedAnswers {
    const parsed: ParsedAnswers = {
        scopeLevel: 'unknown',
        fixtureChanges: {},
    };

    // Map answers using question IDs and maps_to fields
    for (const question of step1.follow_up_questions) {
        const answer = answers[question.id];
        if (!answer || answer === 'Vet ej') continue;

        const answerStr = String(answer).toLowerCase();
        const mapsTo = question.maps_to?.toLowerCase() || '';

        // Scope level detection
        if (mapsTo.includes('scope') || question.question_sv.toLowerCase().includes('omfattning')) {
            if (answerStr.includes('golv') && !answerStr.includes('vägg')) {
                parsed.scopeLevel = 'floor_only';
            } else if (answerStr.includes('totalrenovering') || answerStr.includes('komplett')) {
                parsed.scopeLevel = 'full';
            } else if (answerStr.includes('delvis') || answerStr.includes('partial')) {
                parsed.scopeLevel = 'partial';
            }
        }

        // Floor finish
        if ((mapsTo.includes('floor') || mapsTo.includes('golv')) && !mapsTo.includes('heating') && !mapsTo.includes('värme')) {
            parsed.floorFinish = String(answer);
        }

        // Wall tile height
        if (mapsTo.includes('wall') || mapsTo.includes('vägg') || question.question_sv.includes('vägg')) {
            if (answerStr.includes('hel') || answerStr.includes('full')) {
                parsed.wallTileHeight = 'full_height';
            } else if (answerStr.includes('våtrum') || answerStr.includes('wet')) {
                parsed.wallTileHeight = 'wet_zone_only';
            } else if (answerStr.includes('ingen') || answerStr.includes('no')) {
                parsed.wallTileHeight = 'none';
            }
        }

        // Underfloor heating
        if (mapsTo.includes('heating') || mapsTo.includes('värme') || question.question_sv.includes('golvvärme')) {
            parsed.underfloorHeating = answerStr.includes('ja') || answerStr.includes('yes') ? 'yes' : 'no';
        }

        // Tile quality/price tier
        if (mapsTo.includes('tile_price') || question.question_sv.includes('kakel') && question.question_sv.includes('kvalitet')) {
            parsed.tilePriceTier = String(answer);
        }

        // Tile size
        if (mapsTo.includes('tile_size') || question.question_sv.includes('kakel') && question.question_sv.includes('storlek')) {
            parsed.tileSizeCategory = String(answer);
        }

        // Fixture changes
        if (mapsTo.includes('toilet') || question.question_sv.includes('toalett')) {
            parsed.fixtureChanges.toilet = String(answer);
        }
        if (mapsTo.includes('vanity') || mapsTo.includes('sink') || question.question_sv.includes('handfat')) {
            parsed.fixtureChanges.vanity = String(answer);
        }
        if (mapsTo.includes('shower') || question.question_sv.includes('dusch')) {
            parsed.fixtureChanges.shower = String(answer);
        }
        if (mapsTo.includes('bathtub') || mapsTo.includes('bath') || question.question_sv.includes('badkar')) {
            parsed.fixtureChanges.bathtub = String(answer);
        }

        // Conceal pipes
        if (mapsTo.includes('pipes') || question.question_sv.includes('rör') || question.question_sv.includes('dölj')) {
            parsed.concealPipes = String(answer);
        }

        // Lighting
        if (mapsTo.includes('light') || question.question_sv.includes('belysning')) {
            parsed.lightingChanges = String(answer);
        }
    }

    return parsed;
}

/**
 * Build list of changes to make
 */
function buildChangesList(
    parsed: ParsedAnswers,
    description?: string
): string[] {
    const changes: string[] = [];

    // User description (highest priority)
    if (description) {
        changes.push(`User request: ${description}`);
    }

    // Scope-based changes
    if (parsed.scopeLevel === 'floor_only') {
        if (parsed.floorFinish) {
            changes.push(`Replace floor with: ${parsed.floorFinish}`);
        } else {
            changes.push('Replace floor with modern tiles');
        }
        if (parsed.underfloorHeating === 'yes') {
            changes.push('Install underfloor heating (not visible in image)');
        }
    } else if (parsed.scopeLevel === 'full' || parsed.scopeLevel === 'partial') {
        // Floor
        if (parsed.floorFinish) {
            changes.push(`Floor: ${parsed.floorFinish}`);
        }

        // Walls
        if (parsed.wallTileHeight === 'full_height') {
            changes.push('Wall tiles: full height on all walls');
        } else if (parsed.wallTileHeight === 'wet_zone_only') {
            changes.push('Wall tiles: wet zone only (around shower/bath)');
        }

        // Tile specs
        if (parsed.tilePriceTier) {
            changes.push(`Tile quality: ${parsed.tilePriceTier}`);
        }
        if (parsed.tileSizeCategory) {
            changes.push(`Tile size: ${parsed.tileSizeCategory}`);
        }

        // Fixtures
        if (parsed.fixtureChanges.toilet && !parsed.fixtureChanges.toilet.toLowerCase().includes('behåll')) {
            changes.push(`Replace toilet with: ${parsed.fixtureChanges.toilet}`);
        }
        if (parsed.fixtureChanges.vanity && !parsed.fixtureChanges.vanity.toLowerCase().includes('behåll')) {
            changes.push(`Replace vanity/sink with: ${parsed.fixtureChanges.vanity}`);
        }
        if (parsed.fixtureChanges.shower && !parsed.fixtureChanges.shower.toLowerCase().includes('behåll')) {
            changes.push(`Replace shower with: ${parsed.fixtureChanges.shower}`);
        }
        if (parsed.fixtureChanges.bathtub && !parsed.fixtureChanges.bathtub.toLowerCase().includes('behåll')) {
            changes.push(`Bathtub: ${parsed.fixtureChanges.bathtub}`);
        }

        // Other changes
        if (parsed.concealPipes?.toLowerCase().includes('ja') || parsed.concealPipes?.toLowerCase().includes('yes')) {
            changes.push('Conceal visible pipes with boxing/panels');
        }
        if (parsed.lightingChanges && !parsed.lightingChanges.toLowerCase().includes('behåll')) {
            changes.push(`Lighting: ${parsed.lightingChanges}`);
        }
    }

    return changes;
}

/**
 * Build list of things to preserve
 */
function buildPreserveList(
    step1: AnalysisResponse,
    parsed: ParsedAnswers
): string[] {
    const preserve: string[] = [];

    // Always preserve these
    preserve.push('Camera viewpoint and perspective');
    preserve.push('Room geometry and dimensions');
    preserve.push('Window and door positions');

    // Scope-specific preservation
    if (parsed.scopeLevel === 'floor_only') {
        preserve.push('All wall finishes (tiles, paint, etc.)');
        preserve.push('Ceiling finish');
        preserve.push('All fixtures in current positions (toilet, sink, shower, bathtub)');
        preserve.push('All visible pipes and installations');
        preserve.push('Lighting fixtures');

        // Add visible elements from step1
        if (step1.image_observations?.visible_elements && step1.image_observations.visible_elements.length > 0) {
            preserve.push(`Visible fixtures: ${step1.image_observations.visible_elements.join(', ')}`);
        }
    } else {
        // For partial/full renovations, preserve what's not being changed
        if (!parsed.fixtureChanges.toilet || parsed.fixtureChanges.toilet.toLowerCase().includes('behåll')) {
            preserve.push('Toilet position and type');
        }
        if (!parsed.fixtureChanges.vanity || parsed.fixtureChanges.vanity.toLowerCase().includes('behåll')) {
            preserve.push('Sink/vanity position and type');
        }
        if (!parsed.fixtureChanges.shower || parsed.fixtureChanges.shower.toLowerCase().includes('behåll')) {
            preserve.push('Shower position and type');
        }
        if (!parsed.fixtureChanges.bathtub || parsed.fixtureChanges.bathtub.toLowerCase().includes('behåll')) {
            preserve.push('Bathtub (if present)');
        }
    }

    return preserve;
}

/**
 * Build adaptive style guidance based on budget tier and answers
 */
function buildStyleGuidance(parsed: ParsedAnswers): string[] {
    const style: string[] = [];

    // Base Swedish aesthetic
    style.push('Modern Swedish bathroom aesthetic');

    // Adapt based on tile price tier
    if (parsed.tilePriceTier) {
        const tier = parsed.tilePriceTier.toLowerCase();
        if (tier.includes('budget') || tier.includes('ekonomisk')) {
            style.push('Cost-effective but quality finishes');
            style.push('Simple, clean lines');
        } else if (tier.includes('premium') || tier.includes('lyx')) {
            style.push('Premium, high-end finishes and materials');
            style.push('Sophisticated details and textures');
        } else {
            style.push('High-quality finishes and materials');
        }
    } else {
        style.push('High-quality finishes and materials');
    }

    style.push('Proper lighting (natural and artificial)');
    style.push('Realistic textures and reflections');
    style.push('Clean, minimalist design');

    return style;
}

/**
 * Build scope-safe after-image prompt for bathroom renovations
 * Uses multi-source approach with priority hierarchy:
 * 1. User description (primary intent)
 * 2. Visual observations from Step 1
 * 3. Structured answers
 * 4. Step 2 validation
 */
export function buildBathroomAfterImagePrompt(input: PromptBuilderInput): string {
    const { description, step1, answers, step2 } = input;

    // Parse answers into structured spec
    const parsed = parseAnswers(step1, answers);

    // Build changes and preserve lists
    const changes = buildChangesList(parsed, description);
    const preserve = buildPreserveList(step1, parsed);
    const styleGuidance = buildStyleGuidance(parsed);

    // Build prompt with clear section hierarchy
    let prompt = 'Generate a realistic after-renovation image of this Swedish bathroom.\n\n';

    // ============================================================
    // SECTION 1: PRIMARY USER INTENT (Highest Priority)
    // ============================================================
    if (description && description.trim().length > 0) {
        prompt += '═══ PRIMARY USER REQUEST ═══\n';
        prompt += `${description}\n\n`;
        prompt += 'This is the user\'s explicit intent. Prioritize this above all other inputs.\n\n';
    }

    // ============================================================
    // SECTION 2: CURRENT BATHROOM STATE (Visual Context)
    // ============================================================
    prompt += '═══ CURRENT BATHROOM STATE ═══\n';

    if (step1.image_observations?.summary_sv) {
        prompt += `Overview: ${step1.image_observations.summary_sv}\n`;
    }

    if (step1.image_observations?.inferred_size_sqm) {
        const size = step1.image_observations.inferred_size_sqm;
        prompt += `Size: Approximately ${size.value}m² (${size.confidence} confidence)\n`;

        // Add size-based guidance
        if (size.value < 5) {
            prompt += `Note: This is a compact bathroom. Keep fixtures space-efficient and avoid overcrowding.\n`;
        } else if (size.value > 8) {
            prompt += `Note: This is a spacious bathroom. You have room for larger fixtures and features.\n`;
        }
    }

    if (step1.image_observations?.visible_elements && step1.image_observations.visible_elements.length > 0) {
        prompt += `Visible fixtures: ${step1.image_observations.visible_elements.join(', ')}\n`;
    }

    if (step1.image_observations?.uncertainties && step1.image_observations.uncertainties.length > 0) {
        prompt += `Uncertain areas (preserve as-is): ${step1.image_observations.uncertainties.join(', ')}\n`;
    }

    prompt += '\n';

    // ============================================================
    // SECTION 3: HARD CONSTRAINTS (CRITICAL)
    // ============================================================
    prompt += '═══ HARD CONSTRAINTS (MUST FOLLOW) ═══\n';
    prompt += '- Keep the exact same camera viewpoint and perspective as the before image\n';
    prompt += '- Keep the exact same room geometry, dimensions, and layout\n';
    prompt += '- Do NOT add, remove, or move windows or doors\n';
    prompt += '- Do NOT move fixtures unless explicitly requested in PRIMARY USER REQUEST or CHANGES TO MAKE\n';
    prompt += '- Do NOT change anything not listed in PRIMARY USER REQUEST or CHANGES TO MAKE\n';
    prompt += '- Do NOT hallucinate new features or upgrades\n';
    prompt += '- If uncertain about a detail, preserve what is visible in the before image\n';
    prompt += '- Respect the size constraints mentioned in CURRENT BATHROOM STATE\n\n';

    // ============================================================
    // SECTION 4: CHANGES TO MAKE (From Answers + Description)
    // ============================================================
    if (changes.length > 0) {
        prompt += '═══ CHANGES TO MAKE ═══\n';
        changes.forEach(change => {
            prompt += `- ${change}\n`;
        });
        prompt += '\n';
    } else {
        prompt += '═══ CHANGES TO MAKE ═══\n';
        prompt += '- Refresh the bathroom with modern Swedish design while keeping everything else the same\n\n';
    }

    // ============================================================
    // SECTION 5: PRESERVE UNCHANGED
    // ============================================================
    prompt += '═══ PRESERVE UNCHANGED ═══\n';
    preserve.forEach(item => {
        prompt += `- ${item}\n`;
    });
    prompt += '\n';

    // ============================================================
    // SECTION 6: STYLE GUIDANCE (Adaptive)
    // ============================================================
    prompt += '═══ STYLE GUIDANCE ═══\n';
    styleGuidance.forEach(guideline => {
        prompt += `- ${guideline}\n`;
    });

    return prompt;
}
