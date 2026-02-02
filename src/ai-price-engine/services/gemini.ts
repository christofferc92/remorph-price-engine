import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { AnalysisResponse } from '../types';
import { buildStep1Prompt } from '../prompts/bathroom/step1';

// Validate API key exists at runtime, but don't load dotenv here (environment's responsibility)
function getGenAIClient() {
    if (!process.env.GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY is not set in environment');
    }
    return new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
}

export type AiAnalysisStage = 'gemini_parse' | 'schema_validate' | 'mapping';

export class AiAnalysisError extends Error {
    constructor(
        message: string,
        public stage: AiAnalysisStage,
        public rawOutput?: string
    ) {
        super(message);
        this.name = 'AiAnalysisError';
    }
}

function extractJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch (e) {
        // Find the first { and the last }
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            const possibleJson = text.substring(start, end + 1);
            try {
                return JSON.parse(possibleJson);
            } catch (e2) {
                // Ignore e2 and fall through
            }
        }
        throw e;
    }
}

/**
 * Analyzes a bathroom image and generates follow-up questions
 * @param imageBuffer The image file buffer
 * @param userDescription Optional user description
 * @param requestId Unique request ID for logging
 * @param options Retry options
 * @returns Analysis response with observations and questions
 */
export async function analyzeBathroomImage(
    imageBuffer: Buffer,
    userDescription: string = '',
    requestId: string = 'unknown',
    options: { isRetry?: boolean } = {}
): Promise<{ data: AnalysisResponse; usageMetadata: any }> {
    const isRetry = options.isRetry || false;
    const attempt = isRetry ? 2 : 1;
    const tTotalStart = performance.now();
    const original_bytes = imageBuffer.length;

    // 1. Image Preprocessing: Downscale to 1024px and JPEG 75
    const tResizeStart = performance.now();
    const optimizedBuffer = await sharp(imageBuffer)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    const tResizeEnd = performance.now();
    const resize_time_ms = Math.round(tResizeEnd - tResizeStart);
    const resized_bytes = optimizedBuffer.length;

    const genAI = getGenAIClient();
    const modelName = 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 4096,
        }
    });

    // Convert optimized image to base64
    const base64Image = optimizedBuffer.toString('base64');

    // Build prompt using bathroom-specific prompt builder
    // Retry uses simplified contract
    const prompt = buildStep1Prompt(userDescription, isRetry);

    try {
        // 2. Generate content with optimized image and constraints
        const tGeminiStart = performance.now();
        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64Image,
                    mimeType: 'image/jpeg',
                },
            },
            { text: prompt },
        ]);

        const response = result.response;
        const gemini_time_ms = Math.round(performance.now() - tGeminiStart);
        const total_ms = Math.round(performance.now() - tTotalStart);

        let text = response.text();
        const output_len = text.length;

        console.log(`[PERF_AI_ANALYZE] [${requestId}] model=${modelName} attempt=${attempt}/2 original_bytes=${original_bytes} resized_bytes=${resized_bytes} output_len=${output_len} resize_time_ms=${resize_time_ms} gemini_time_ms=${gemini_time_ms} total_ms=${total_ms}`);

        // Parse JSON response with hardening
        let analysis: AnalysisResponse;
        try {
            const parsed = extractJson(text);
            analysis = parsed;
        } catch (e: any) {
            const rawOutput = text.slice(0, 1000);
            console.error(`[PERF_AI_ANALYZE] [${requestId}] attempt=${attempt}/2 stage=gemini_parse error="${e.message}" len=${output_len} raw="${rawOutput}"`);
            throw new AiAnalysisError(`Failed to parse Gemini output: ${e.message}`, 'gemini_parse', rawOutput);
        }

        // Schema validation
        if (!analysis.follow_up_questions || !Array.isArray(analysis.follow_up_questions)) {
            const rawOutput = text.slice(0, 1000);
            console.error(`[PERF_AI_ANALYZE] [${requestId}] attempt=${attempt}/2 stage=schema_validate error="Missing follow_up_questions" raw="${rawOutput}"`);
            throw new AiAnalysisError('Gemini output missing follow_up_questions', 'schema_validate', rawOutput);
        }

        console.log(`[PERF_AI_ANALYZE] [${requestId}] attempt=${attempt}/2 status=success output_len=${output_len}`);

        return {
            data: analysis,
            usageMetadata: response.usageMetadata
        };
    } catch (error) {
        if (error instanceof AiAnalysisError) {
            throw error;
        }
        console.error('Error analyzing bathroom image:', error);
        throw error;
    }
}
