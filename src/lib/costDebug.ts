export const COST_CONSTANTS = {
    GEMINI_FLASH_TEXT: {
        INPUT_PER_1M: 0.075,
        OUTPUT_PER_1M: 0.30,
    },
    GEMINI_FLASH_IMAGE: {
        // Conservative estimate: treating it as similar to Imagen 3 if paid per image
        PER_IMAGE: 0.04,
        // Fallback: if billed as text tokens
        INPUT_PER_1M: 0.075,
        OUTPUT_PER_1M: 0.30,
    }
};

export interface CostEstimate {
    step: string;
    model: string;
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_text?: number;
    input_tokens_image?: number;
    estimated_cost_usd: number;
}

export function estimateTextCostUsd({
    model,
    input_tokens,
    output_tokens
}: {
    model: string;
    input_tokens: number;
    output_tokens: number;
}): number {
    // Assuming Gemini Flash pricing for all 'gemini-*-flash' models for now
    // Normalize model name check if needed
    const inputCost = (input_tokens / 1_000_000) * COST_CONSTANTS.GEMINI_FLASH_TEXT.INPUT_PER_1M;
    const outputCost = (output_tokens / 1_000_000) * COST_CONSTANTS.GEMINI_FLASH_TEXT.OUTPUT_PER_1M;
    return Number((inputCost + outputCost).toFixed(6));
}

export function estimateImageCostUsd({
    model,
    input_tokens_text = 0,
    input_tokens_image = 0,
    output_tokens = 0
}: {
    model: string;
    input_tokens_text?: number;
    input_tokens_image?: number; // e.g. 258 per image
    output_tokens?: number;
}): number {
    // If we assume per-image pricing (conservative):
    // Ignoring token counts for price, just returning fixed price.
    if (model.includes('image')) {
        return COST_CONSTANTS.GEMINI_FLASH_IMAGE.PER_IMAGE;
    }

    // If we wanted to calculate based on tokens:
    /*
    const totalInput = input_tokens_text + input_tokens_image;
    const inputCost = (totalInput / 1_000_000) * COST_CONSTANTS.GEMINI_FLASH_IMAGE.INPUT_PER_1M;
    const outputCost = (output_tokens / 1_000_000) * COST_CONSTANTS.GEMINI_FLASH_IMAGE.OUTPUT_PER_1M;
    return Number((inputCost + outputCost).toFixed(6));
    */

    return 0.04; // Default fallback
}
