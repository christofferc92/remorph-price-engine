import { AfterImageProvider, AfterImageRequest, AfterImageResponse } from './types';
import { GeminiAfterImageProvider } from './providers/gemini';

// Export types
export * from './types';

/**
 * Get the configured after-image provider
 */
function getProvider(): AfterImageProvider {
    const providerName = process.env.AFTER_IMAGE_PROVIDER || 'gemini';

    switch (providerName.toLowerCase()) {
        case 'gemini':
            return new GeminiAfterImageProvider();
        case 'openai':
            throw new Error('OpenAI provider not yet implemented');
        default:
            throw new Error(`Unknown after-image provider: ${providerName}`);
    }
}

/**
 * Generate an after-renovation image
 * 
 * @param request - Request containing before image and optional context
 * @returns Promise with base64-encoded after image
 */
export async function generateAfterImage(
    request: AfterImageRequest
): Promise<AfterImageResponse> {
    const provider = getProvider();
    return provider.generateAfterImage(request);
}
