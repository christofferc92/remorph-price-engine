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

/**
 * Analyzes a bathroom image and generates follow-up questions
 * @param imageBuffer The image file buffer
 * @param userDescription Optional user description
 * @returns Analysis response with observations and questions
 */
export async function analyzeBathroomImage(
    imageBuffer: Buffer,
    userDescription: string = ''
): Promise<{ data: AnalysisResponse; usageMetadata: any }> {
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
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 1024,
        }
    });

    // Convert optimized image to base64
    const base64Image = optimizedBuffer.toString('base64');

    // Build prompt using bathroom-specific prompt builder
    const prompt = buildStep1Prompt(userDescription);

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
            { text: prompt + "\nReturn ONLY concise JSON. No markdown." },
        ]);

        const response = result.response;
        const gemini_time_ms = Math.round(performance.now() - tGeminiStart);
        const total_ms = Math.round(performance.now() - tTotalStart);

        console.log(`[PERF_AI_ANALYZE] original_bytes=${original_bytes} resized_bytes=${resized_bytes} resize_time_ms=${resize_time_ms} gemini_time_ms=${gemini_time_ms} total_ms=${total_ms}`);

        let text = response.text();

        // Strip markdown code blocks if present (though JSON mode should prevent this)
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            text = jsonMatch[1];
        }

        // Parse JSON response
        const analysis: AnalysisResponse = JSON.parse(text);

        return {
            data: analysis,
            usageMetadata: response.usageMetadata
        };
    } catch (error) {
        console.error('Error analyzing bathroom image:', error);
        if (error instanceof SyntaxError) {
            console.error('Failed to parse AI response as JSON. Raw response:', error);
        }
        throw new Error('Failed to analyze bathroom image');
    }
}
