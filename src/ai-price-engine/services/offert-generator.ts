import { GoogleGenerativeAI } from '@google/generative-ai';
import { AnalysisResponse, OffertResponse } from '../types';
import { buildStep2Prompt } from '../prompts/bathroom/step2';

function getGenAIClient() {
    if (!process.env.GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY is not set in environment');
    }
    return new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
}

/**
 * Normalize user answers by mapping them to the expected keys
 * Uses prefill_guess as default if user doesn't provide an answer
 */
function normalizeAnswers(
    step1: AnalysisResponse,
    answers: Record<string, any>
): Record<string, any> {
    const normalized: Record<string, any> = {};

    for (const question of step1.follow_up_questions) {
        const answer = answers[question.id];

        if (answer !== undefined && answer !== null && answer !== '') {
            // User provided an answer - validate and use it
            if (question.type === 'number') {
                const num = Number(answer);
                if (isNaN(num)) {
                    throw new Error(
                        `Invalid answer for ${question.id}: expected number, got "${answer}"`
                    );
                }
                normalized[question.maps_to] = num;
            } else {
                normalized[question.maps_to] = answer;
            }
        } else if (question.prefill_guess !== undefined && question.prefill_guess !== null) {
            // No user answer, but we have a prefill - use it
            normalized[question.maps_to] = question.prefill_guess;
        } else {
            // No answer and no prefill - mark as unknown
            normalized[question.maps_to] = 'unknown';
        }
    }

    return normalized;
}

/**
 * Generate offertunderlag using STEP 1 analysis and user answers
 */
export async function generateOffertunderlag(
    step1: AnalysisResponse,
    answers: Record<string, any>
): Promise<OffertResponse> {
    const genAI = getGenAIClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Normalize answers using maps_to keys
    const normalizedAnswers = normalizeAnswers(step1, answers);

    // Build prompt using bathroom-specific prompt builder
    const prompt = buildStep2Prompt(
        step1.image_observations,
        step1.scope_guess,
        normalizedAnswers
    );

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        let text = response.text();

        // Strip markdown code blocks if present (```json ... ```)
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            text = jsonMatch[1];
        }

        // Parse JSON response
        const offert: OffertResponse = JSON.parse(text);

        return offert;
    } catch (error) {
        console.error('Error generating offert:', error);
        if (error instanceof SyntaxError) {
            console.error('Failed to parse AI response as JSON');
        }
        throw new Error('Failed to generate offert');
    }
}
