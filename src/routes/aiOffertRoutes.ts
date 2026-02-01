import { Router } from 'express';
import multer from 'multer';
import { analyzeBathroomImage } from '../ai-price-engine/services/gemini';
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

const router = Router();

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
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Image file is required (jpeg/png)' });
        }

        const imageBuffer = req.file.buffer;
        const description = req.body.description || '';

        // Call AI Price Engine Step 1
        const analysis = await analyzeBathroomImage(imageBuffer, description);

        res.json(analysis);
    } catch (error: any) {
        console.error('[AI-Offert] Analyze error:', error);

        // Handle specific AI errors if possible, otherwise 500
        // Using 502 for upstream AI failures/bad JSON
        if (error.message?.includes('Failed to parse AI response') || error.message?.includes('GoogleGenerativeAI')) {
            return res.status(502).json({ error: 'AI Service Error', details: error.message });
        }

        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

/**
 * POST /api/ai/offert/generate
 * Accepts JSON with { step1: AnalysisResponse, answers: Record<string, any> }.
 * Returns OffertResponse.
 */
router.post('/generate', async (req, res) => {
    try {
        const { step1, answers } = req.body;

        // Basic validation
        if (!step1 || !answers) {
            return res.status(400).json({ error: 'Missing required fields: step1, answers' });
        }

        // Call AI Price Engine Step 2
        const offert = await generateOffertunderlag(step1 as AnalysisResponse, answers);

        res.json(offert);
    } catch (error: any) {
        console.error('[AI-Offert] Generate error:', error);

        if (error.message?.includes('Failed to parse AI response')) {
            return res.status(502).json({ error: 'AI Service Error', details: error.message });
        }

        res.status(500).json({ error: 'Internal Server Error', details: error.message });
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
                error: error.message || String(error),
                error_code: error.code,
            }));
            console.error('[AI-Offert] After-image error:', error);

            // Handle Multer errors
            if (error.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({
                    error: 'Invalid upload field',
                    details: 'Use field name "image" or "before_image" for the image file',
                });
            }

            // Handle specific AI errors
            if (error.message?.includes('No image data') || error.message?.includes('Gemini image generation failed')) {
                return res.status(502).json({ error: 'AI Service Error', details: error.message });
            }

            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
);



export const aiOffertRouter = router;
