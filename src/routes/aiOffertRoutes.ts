import { Router } from 'express';
import multer from 'multer';
import { analyzeBathroomImage, AiAnalysisError } from '../ai-price-engine/services/gemini';
import { generateOffertunderlag } from '../ai-price-engine/services/offert-generator';
import { AnalysisResponse, OffertResponse } from '../ai-price-engine/types';
import { generateAfterImage } from '../ai-image-engine';
import { uploadPngAndSign } from '../lib/supabaseStorage';
import {
    isCircuitBreakerOpen,
    checkRateLimits,
    recordGeneration,
    checkIdempotency,
    cacheIdempotency,
} from '../lib/guardrails';
import { estimateTextCostUsd } from '../lib/costDebug';
import { generateOffertunderlagV2 } from '../ai-price-engine/services/offert-generator';
import { calculateEstimate } from '../lib/pricing';
import { saveEstimate, loadEstimate } from '../lib/store';
import { RepriceRequestV2, SectionV2, LineItemV2 } from '../ai-price-engine/types';
import { sendError, rateLimitMiddleware } from '../lib/api-harden';

const router = Router();

// Apply rate limiting to all routes in this router
router.use(rateLimitMiddleware);

// Configure Multer for memory storage, 10MB limit, images only
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG and PNG images are allowed'));
        }
    },
});

/**
 * POST /api/ai/offert/analyze
 * Accepts multipart/form-data with 'image' file and optional 'description' text.
 * Returns AnalysisResponse.
 */
router.post('/analyze', upload.single('image'), async (req, res) => {
    const requestId = res.locals.requestId;
    try {
        if (!req.file) {
            return sendError(res, 400, 'Image file is required (jpeg/png)');
        }

        const imageBuffer = req.file.buffer;
        const description = req.body.description || '';

        // Call AI Price Engine Step 1 with automatic retry
        let analysis: AnalysisResponse | undefined;
        let usage: any;
        let lastError: any;

        try {
            // Attempt 1
            const result = await analyzeBathroomImage(imageBuffer, description, requestId, { isRetry: false });
            analysis = result.data;
            usage = result.usageMetadata;
        } catch (error: any) {
            if (error instanceof AiAnalysisError && (error.stage === 'gemini_parse' || error.stage === 'schema_validate')) {
                console.log(`[AI-Offert] [${requestId}] Attempt 1 failed (stage=${error.stage}). Retrying with simplified contract...`);
                try {
                    // Attempt 2 (Retry)
                    const result = await analyzeBathroomImage(imageBuffer, description, requestId, { isRetry: true });
                    analysis = result.data;
                    usage = result.usageMetadata;
                } catch (retryError: any) {
                    lastError = retryError;
                }
            } else {
                lastError = error;
            }
        }

        if (!analysis) {
            throw lastError;
        }

        const debug_cost = {
            step: 'analysis',
            model: 'gemini-2.5-flash',
            input_tokens: usage?.promptTokenCount || 0,
            output_tokens: usage?.candidatesTokenCount || 0,
            estimated_cost_usd: estimateTextCostUsd({
                model: 'gemini-2.5-flash',
                input_tokens: usage?.promptTokenCount || 0,
                output_tokens: usage?.candidatesTokenCount || 0
            })
        };

        // Include user_description in response so it's available for Step 2
        console.log(`[AI-Offert] [${requestId}] ANALYZE returning user_description: "${description}"`);
        res.json({ ...analysis, user_description: description, debug_cost, request_id: requestId });
    } catch (error: any) {
        if (error instanceof AiAnalysisError) {
            console.error(`[AI-Offert] Analyze model error [${requestId}] stage=${error.stage}:`, error.message);
            return res.status(422).json({
                error: "invalid_model_output",
                request_id: requestId,
                stage: error.stage,
                details: error.message
            });
        }

        console.error(`[AI-Offert] Analyze server error [${requestId}]:`, error);

        if (error.message?.includes('GoogleGenerativeAI')) {
            return sendError(res, 502, 'AI Service Unavailable', error.message);
        }

        sendError(res, 500, 'Internal Server Error', error.message);
    }
});

/**
 * POST /api/ai/offert/generate
 * Accepts JSON with { step1: AnalysisResponse, answers: Record<string, any> }.
 * Returns OffertResponse.
 */
router.post('/generate', async (req, res) => {
    const requestId = res.locals.requestId;
    try {
        const { step1, answers } = req.body;

        // Basic validation
        if (!step1 || !answers) {
            return sendError(res, 400, 'Missing required fields: step1, answers');
        }


        // Call AI Price Engine Step 2 (V2) - pass user description for scope detection
        console.log(`[AI-Offert] [${requestId}] GENERATE received user_description: "${step1.user_description}"`);
        const { data: estimate, usageMetadata } = await generateOffertunderlagV2(
            step1 as AnalysisResponse,
            answers,
            step1.user_description  // Now properly typed and available
        );

        // Save to FS Store (Mock persistence)
        await saveEstimate(estimate);

        const debug_cost = {
            step: 'estimation',
            model: 'gemini-2.5-flash',
            input_tokens: usageMetadata?.promptTokenCount || 0,
            output_tokens: usageMetadata?.candidatesTokenCount || 0,
            estimated_cost_usd: estimateTextCostUsd({
                model: 'gemini-2.5-flash',
                input_tokens: usageMetadata?.promptTokenCount || 0,
                output_tokens: usageMetadata?.candidatesTokenCount || 0
            })
        };

        // Return V2 estimate
        res.json({ ...estimate, debug_cost, request_id: requestId });
    } catch (error: any) {
        console.error(`[AI-Offert] Generate error [${requestId}]:`, error);

        if (error.message?.includes('Failed to parse AI response')) {
            return sendError(res, 502, 'AI Service Error', error.message);
        }

        sendError(res, 500, 'Internal Server Error', error.message);
    }
});

/**
 * POST /api/ai/offert/reprice
 * Recalculates estimate based on manual overrides and ROT settings.
 */
router.post('/reprice', async (req, res) => {
    const requestId = res.locals.requestId;
    try {
        const { estimate_id, edits, rot_input, reset_overrides } = req.body as RepriceRequestV2;

        if (!estimate_id) return sendError(res, 400, 'Missing estimate_id');

        // 1. Validation
        if (rot_input) {
            if (![1, 2].includes(rot_input.owners_count)) {
                return sendError(res, 400, 'owners_count must be 1 or 2');
            }
            if (rot_input.rot_used_sek < 0) {
                return sendError(res, 400, 'rot_used_sek must be positive');
            }
        }

        if (edits) {
            for (const edit of edits) {
                if (edit.qty !== undefined && edit.qty < 0) return sendError(res, 400, `Invalid qty for ${edit.line_item_id}`);
                if (edit.unit_price_sek_incl_vat !== undefined && edit.unit_price_sek_incl_vat < 0) {
                    return sendError(res, 400, `Invalid price for ${edit.line_item_id}`);
                }
                if (edit.labor_share_percent !== undefined && (edit.labor_share_percent < 0 || edit.labor_share_percent > 1)) {
                    return sendError(res, 400, `Invalid labor_share for ${edit.line_item_id}`);
                }
            }
        }

        const existing = await loadEstimate(estimate_id);
        if (!existing) return sendError(res, 404, 'Estimate not found');

        // 2. Prepare new sections
        const newSections = existing.sections.map(section => ({
            ...section,
            items: section.items.map(item => {
                // Logic A: Reset Overrides
                if (reset_overrides) {
                    return {
                        ...item,
                        qty: item.original_qty ?? item.qty,
                        unit_price_sek_incl_vat: item.original_unit_price ?? item.unit_price_sek_incl_vat,
                        manual_override: undefined
                    };
                }

                // Logic B: Apply Edits
                const edit = edits?.find(e => e.line_item_id === item.id);
                if (edit) {
                    return {
                        ...item,
                        // Apply overrides
                        qty: edit.qty ?? item.qty,
                        unit: edit.unit ?? item.unit,
                        unit_price_sek_incl_vat: edit.unit_price_sek_incl_vat ?? item.unit_price_sek_incl_vat,
                        labor_share_percent: edit.labor_share_percent ?? item.labor_share_percent,
                        is_rot_eligible: edit.is_rot_eligible ?? item.is_rot_eligible,
                        manual_override: true
                    };
                }
                return item;
            })
        }));

        // 3. Fallback ROT inputs
        const rotParamsInput = rot_input || existing.rot_input;

        // 4. Recalculate
        const updated = calculateEstimate(
            newSections,
            rotParamsInput,
            estimate_id,
            {
                created_at_iso: existing.created_at_iso,
                scope_summary_sv: existing.scope_summary_sv,
                assumptions_sv: existing.assumptions_sv
            }
        );

        await saveEstimate(updated);

        res.json({ ...updated, request_id: requestId });
    } catch (error: any) {
        console.error(`[AI-Offert] Reprice error [${requestId}]:`, error);
        sendError(res, 500, 'Internal Server Error', error.message);
    }
});



/**
 * POST /api/ai/offert/after-image (v1 contract)
 * Accepts multipart/form-data with:
 *   - image OR before_image (required): JPEG/PNG file
 *   - step1 (required): JSON string of Step 1 analysis
 *   - answers (required): JSON string of user answers
 *   - description (optional): Text description
 *   - step2 (optional): JSON string of Step 2 offert data
 * Returns { after_image_base64, mime_type, provider, model, latency_ms }
 */
router.post(
    '/after-image',
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'before_image', maxCount: 1 },
    ]),
    async (req, res) => {
        // Declare variables outside try block for error handler access
        let userId: string = 'unknown';
        let identifierType: 'client_id' | 'ip' = 'ip';
        let idempotencyKey: string = 'unknown';

        try {
            // ============================================================
            // GUARDRAILS: Circuit Breaker, Rate Limiting, Idempotency
            // ============================================================

            // 1. Circuit breaker check
            if (!isCircuitBreakerOpen()) {
                console.log(JSON.stringify({
                    event: 'image_gen_blocked',
                    timestamp: new Date().toISOString(),
                    reason: 'circuit_breaker',
                }));
                return res.status(503).json({
                    error: 'Service Unavailable',
                    message: 'Image generation temporarily disabled',
                });
            }

            // 2. Extract user identifier (client_id preferred, fallback to IP)
            const clientId = req.body.client_id || req.headers['x-client-id'];
            const ip = req.headers['fly-client-ip'] || req.ip || 'unknown';
            userId = clientId || ip;
            identifierType = clientId ? 'client_id' : 'ip';

            // 3. Extract and validate idempotency key
            idempotencyKey = (req.body.idempotency_key || req.headers['idempotency-key']) as string;
            if (!idempotencyKey) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'idempotency_key is required (UUID format)',
                });
            }

            // 4. Check idempotency cache
            const cachedResult = await checkIdempotency(idempotencyKey, userId);
            if (cachedResult.exists) {
                console.log(JSON.stringify({
                    event: 'image_gen_idempotency_hit',
                    timestamp: new Date().toISOString(),
                    user: userId,
                    identifier_type: identifierType,
                    idempotency_key: idempotencyKey,
                }));
                return res.json(cachedResult.data);
            }

            // 5. Check rate limits (cooldown, user daily, global daily)
            const rateLimitCheck = await checkRateLimits(userId, identifierType);
            if (!rateLimitCheck.allowed) {
                console.log(JSON.stringify({
                    event: 'image_gen_blocked',
                    timestamp: new Date().toISOString(),
                    user: userId,
                    identifier_type: identifierType,
                    idempotency_key: idempotencyKey,
                    reason: rateLimitCheck.reason,
                    retry_after_seconds: rateLimitCheck.retryAfter,
                }));

                const statusCode = rateLimitCheck.reason?.includes('Global') ? 503 : 429;
                return res.status(statusCode).json({
                    error: statusCode === 503 ? 'Service Unavailable' : 'Too Many Requests',
                    message: rateLimitCheck.reason,
                    retry_after_seconds: rateLimitCheck.retryAfter,
                });
            }

            // 6. Log attempt (allowed)
            console.log(JSON.stringify({
                event: 'image_gen_attempt',
                timestamp: new Date().toISOString(),
                user: userId,
                identifier_type: identifierType,
                idempotency_key: idempotencyKey,
                allowed: true,
            }));

            // 7. Record generation (optimistic - before calling Gemini)
            await recordGeneration(userId, identifierType);

            // ============================================================
            // EXISTING VALIDATION & PROCESSING
            // ============================================================

            // Accept either 'image' or 'before_image' field name
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            const file = files?.image?.[0] ?? files?.before_image?.[0];

            if (!file) {
                return res.status(400).json({ error: 'No image file provided' });
            }

            // Validate required fields
            if (!req.body.step1 || !req.body.answers) {
                return res.status(400).json({
                    error: 'Missing required fields',
                    details: 'step1 and answers are required',
                });
            }

            const beforeImage = file.buffer;
            const description = req.body.description || undefined;

            // Parse required JSON fields
            let step1Data: AnalysisResponse;
            let answers: Record<string, string | number>;

            try {
                step1Data = JSON.parse(req.body.step1);
            } catch (e: any) {
                return res.status(400).json({
                    error: 'Invalid JSON',
                    details: `Failed to parse step1: ${e.message}`,
                });
            }

            try {
                answers = JSON.parse(req.body.answers);
            } catch (e: any) {
                return res.status(400).json({
                    error: 'Invalid JSON',
                    details: `Failed to parse answers: ${e.message}`,
                });
            }

            // Parse optional step2
            let step2Data: OffertResponse | undefined;
            if (req.body.step2) {
                try {
                    step2Data = JSON.parse(req.body.step2);
                } catch (e: any) {
                    return res.status(400).json({
                        error: 'Invalid JSON',
                        details: `Failed to parse step2: ${e.message}`,
                    });
                }
            }

            const startTime = Date.now();

            // Build scope-safe prompt from step1 + answers
            const { buildBathroomAfterImagePrompt } = await import('../ai-image-engine/prompts/bathroomAfterImagePrompt');
            const customPrompt = buildBathroomAfterImagePrompt({
                description,
                step1: step1Data,
                answers,
                step2: step2Data,
            });

            // Generate after-image with custom prompt
            const result = await generateAfterImage({
                beforeImage,
                customPrompt,
            });

            // Upload to Supabase and get signed URL
            const { path: storagePath, signedUrl } = await uploadPngAndSign({
                bytes: result.image_buffer,
                mimeType: result.mime_type,
            });

            const latencyMs = Date.now() - startTime;

            // Check debug mode
            const isDebug = req.query.debug === '1' || process.env.RETURN_BASE64 === '1';

            const response = {
                after_image_url: signedUrl,
                after_image_path: storagePath,
                mime_type: result.mime_type,
                provider: process.env.AFTER_IMAGE_PROVIDER || 'gemini',
                model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
                latency_ms: latencyMs,
                // Only include base64 in debug mode
                after_image_base64: isDebug ? result.after_image_base64 : undefined,
            };

            // Cache response for idempotency
            await cacheIdempotency(idempotencyKey, userId, response);

            // Log success with metadata
            console.log(JSON.stringify({
                event: 'image_gen_success',
                timestamp: new Date().toISOString(),
                user: userId,
                identifier_type: identifierType,
                idempotency_key: idempotencyKey,
                model: response.model,
                latency_ms: latencyMs,
                mime_type: result.mime_type,
            }));

            res.json(response);
        } catch (error: any) {
            // Log failure with structured data
            console.log(JSON.stringify({
                event: 'image_gen_failure',
                timestamp: new Date().toISOString(),
                user: userId || 'unknown',
                identifier_type: identifierType || 'unknown',
                idempotency_key: idempotencyKey || 'unknown',
                request_id: res.locals.requestId,
                error: error.message || String(error),
                error_code: error.code,
            }));
            console.error(`[AI-Offert] After-image error [${res.locals.requestId}]:`, error);

            // Handle Multer errors
            if (error.code === 'LIMIT_UNEXPECTED_FILE') {
                return sendError(res, 400, 'Invalid upload field', 'Use field name "image" or "before_image" for the image file');
            }

            // Handle specific AI errors
            if (error.message?.includes('No image data') || error.message?.includes('Gemini image generation failed')) {
                return sendError(res, 502, 'AI Service Error', error.message);
            }

            sendError(res, 500, 'Internal Server Error', error.message);
        }
    }
);



export const aiOffertRouter = router;
