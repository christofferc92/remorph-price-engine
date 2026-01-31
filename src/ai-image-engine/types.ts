import { AnalysisResponse, OffertResponse } from '../ai-price-engine/types';

/**
 * Request for generating an after-renovation image
 */
export interface AfterImageRequest {
    beforeImage: Buffer;
    description?: string;
    step1Data?: AnalysisResponse;
    step2Data?: OffertResponse;
}

/**
 * Response containing the generated after-image
 */
export interface AfterImageResponse {
    after_image_base64: string;
    mime_type: string; // 'image/png' or 'image/jpeg'
}

/**
 * Provider interface for after-image generation
 */
export interface AfterImageProvider {
    generateAfterImage(request: AfterImageRequest): Promise<AfterImageResponse>;
}
