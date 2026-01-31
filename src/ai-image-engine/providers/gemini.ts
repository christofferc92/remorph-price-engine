import { GoogleGenerativeAI } from '@google/generative-ai';
import { AfterImageProvider, AfterImageRequest, AfterImageResponse } from '../types';

function getGenAIClient() {
    if (!process.env.GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY is not set in environment');
    }
    return new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
}

function buildPrompt(request: AfterImageRequest): string {
    let prompt = 'Generate a realistic after-renovation image of this Swedish bathroom.';

    if (request.description) {
        prompt += ` User wants: ${request.description}.`;
    }

    if (request.step1Data?.image_observations?.summary_sv) {
        prompt += ` Current state: ${request.step1Data.image_observations.summary_sv}.`;
    }

    if (request.step2Data?.scope_summary_sv) {
        prompt += ` Renovation scope: ${request.step2Data.scope_summary_sv}.`;
    }

    if (request.step2Data?.confirmed_inputs) {
        const inputs = request.step2Data.confirmed_inputs;
        const details: string[] = [];

        if (inputs.tile_price_tier) details.push(`tile quality: ${inputs.tile_price_tier}`);
        if (inputs.tile_size_category) details.push(`tile size: ${inputs.tile_size_category}`);
        if (inputs.waterproofing) details.push(`waterproofing: ${inputs.waterproofing}`);
        if (inputs.underfloor_heating) details.push(`floor heating: ${inputs.underfloor_heating}`);

        if (details.length > 0) {
            prompt += ` Details: ${details.join(', ')}.`;
        }
    }

    prompt += ' Show modern Swedish bathroom design with high-quality finishes, proper lighting, and realistic materials. Maintain the same room layout and perspective as the before image.';

    return prompt;
}

export class GeminiAfterImageProvider implements AfterImageProvider {
    private modelName: string;

    constructor() {
        this.modelName = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
    }

    async generateAfterImage(request: AfterImageRequest): Promise<AfterImageResponse> {
        const genAI = getGenAIClient();
        const model = genAI.getGenerativeModel({ model: this.modelName });

        // Use custom prompt if provided, otherwise build from request data
        const prompt = request.customPrompt || buildPrompt(request);
        const base64Image = request.beforeImage.toString('base64');

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

            // Extract image from response
            // Gemini image generation returns the image in the response parts
            const parts = response.candidates?.[0]?.content?.parts;

            if (!parts || parts.length === 0) {
                throw new Error('No image data in Gemini response');
            }

            // Look for inline data in response parts
            for (const part of parts) {
                if ('inlineData' in part && part.inlineData) {
                    const imageData = part.inlineData.data;
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    const buffer = Buffer.from(imageData, 'base64');

                    return {
                        image_buffer: buffer,
                        after_image_base64: imageData,
                        mime_type: mimeType,
                    };
                }
            }

            // If no inline data found, check for text response (error case)
            const textPart = parts.find(p => 'text' in p);
            if (textPart && 'text' in textPart) {
                throw new Error(`Gemini returned text instead of image: ${textPart.text}`);
            }

            throw new Error('No image data found in Gemini response parts');
        } catch (error) {
            console.error('[Gemini After-Image] Generation error:', error);

            if (error instanceof Error) {
                if (error.message.includes('No image data') || error.message.includes('returned text')) {
                    throw new Error(`Gemini image generation failed: ${error.message}`);
                }
            }

            throw new Error('Failed to generate after-image with Gemini');
        }
    }
}
