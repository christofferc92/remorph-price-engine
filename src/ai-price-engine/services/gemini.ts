import { GoogleGenerativeAI } from '@google/generative-ai';
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
    const genAI = getGenAIClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Convert image to base64
    const base64Image = imageBuffer.toString('base64');

    // Build prompt using bathroom-specific prompt builder
    const prompt = buildStep1Prompt(userDescription);

    try {
        // Generate content with image and prompt
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
        let text = response.text();

        // Strip markdown code blocks if present (```json ... ```)
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
