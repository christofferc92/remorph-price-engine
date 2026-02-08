import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { AnalysisResponse } from '../types';

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

    // Detect room type from description first
    const { detectRoomType } = await import('../lib/roomTypeDetector');
    let roomDetection = detectRoomType(userDescription);

    // If unclear from text, ask AI to detect from image
    if (roomDetection.room_type === 'unclear' || roomDetection.confidence === 'low') {
        console.log(`[PERF_AI_ANALYZE] [${requestId}] text_detection=unclear, using image detection`);

        const imageDetectionPrompt = `Analyze this image and identify what type of room this is.

Respond with ONLY ONE WORD from this list:
- kitchen
- bathroom
- bedroom
- living_room
- unclear

Look for visual clues:
- Kitchen: cabinets, countertops, stove, sink, refrigerator, dishwasher
- Bathroom: toilet, shower, bathtub, sink, tiles, drain
- Bedroom: bed, closets, nightstands
- Living room: sofa, TV, coffee table

Respond with just the room type, nothing else.`;

        try {
            const detectionModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const detectionResult = await detectionModel.generateContent([
                {
                    inlineData: {
                        data: base64Image,
                        mimeType: 'image/jpeg',
                    },
                },
                { text: imageDetectionPrompt }
            ]);

            const detectedRoom = detectionResult.response.text().trim().toLowerCase();
            console.log(`[PERF_AI_ANALYZE] [${requestId}] image_detected_room=${detectedRoom}`);

            // Map AI response to our room types
            if (detectedRoom === 'kitchen') {
                roomDetection = {
                    room_type: 'kitchen',
                    confidence: 'high',
                    basis: 'Detected from image by AI'
                };
            } else if (detectedRoom === 'bathroom') {
                roomDetection = {
                    room_type: 'bathroom',
                    confidence: 'high',
                    basis: 'Detected from image by AI'
                };
            }
            // If still unclear or other room types, default to bathroom for now
        } catch (error) {
            console.warn(`[PERF_AI_ANALYZE] [${requestId}] image_detection_failed, defaulting to bathroom`);
            // Fall back to bathroom on error
        }
    }

    // Route to appropriate prompt builder based on room type
    let prompt: string;
    if (roomDetection.room_type === 'kitchen') {
        const { buildStep1Prompt: buildKitchenStep1 } = await import('../prompts/kitchen/step1');
        prompt = buildKitchenStep1(userDescription, isRetry);
    } else {
        // Default to bathroom (includes 'unclear' cases for backward compatibility)
        const { buildStep1Prompt: buildBathroomStep1 } = await import('../prompts/bathroom/step1');
        prompt = buildBathroomStep1(userDescription, isRetry);
    }

    console.log(`[PERF_AI_ANALYZE] [${requestId}] room_type=${roomDetection.room_type} confidence=${roomDetection.confidence} basis="${roomDetection.basis}"`);

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

        // Adaptive question count validation (with tolerance)
        const { analyzeDescription } = await import('../lib/descriptionAnalyzer');
        const expectedCount = analyzeDescription(userDescription).suggested_question_count;
        const actualCount = analysis.follow_up_questions.length;
        const tolerance = 2;

        if (actualCount < expectedCount - tolerance) {
            console.warn(`[PERF_AI_ANALYZE] [${requestId}] question_count_low expected=${expectedCount} actual=${actualCount}`);
            // Don't fail - AI might have good reasons for fewer questions
        } else if (actualCount > expectedCount + tolerance) {
            console.warn(`[PERF_AI_ANALYZE] [${requestId}] question_count_high expected=${expectedCount} actual=${actualCount}`);
            // Don't fail - AI might have good reasons for more questions
        } else {
            console.log(`[PERF_AI_ANALYZE] [${requestId}] question_count_ok expected=${expectedCount} actual=${actualCount}`);
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
