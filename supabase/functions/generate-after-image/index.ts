// Supabase Edge Function: generate-after-image
// Purpose: Generate AI after-renovation images with guardrails

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.24.1';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

// ============================================================
// CONFIGURATION
// ============================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY')!;
const GEMINI_MODEL = Deno.env.get('GEMINI_IMAGE_MODEL') || 'gemini-2.5-flash-image';
const IMAGE_GEN_ENABLED = Deno.env.get('IMAGE_GEN_ENABLED') || 'true';
const BUCKET = Deno.env.get('SUPABASE_BUCKET') || 'ai-offert-images';
const SIGNED_URL_TTL = parseInt(Deno.env.get('SUPABASE_SIGNED_URL_TTL_SECONDS') || '3600', 10);
const IMAGE_GEN_DEBUG = Deno.env.get('IMAGE_GEN_DEBUG') === 'true';

// Rate limit configuration
const COOLDOWN_SECONDS = 60;
const USER_DAILY_LIMIT = 3;
const GLOBAL_DAILY_LIMIT = 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// ============================================================
// GUARDRAILS FUNCTIONS
// ============================================================

function isCircuitBreakerOpen(): boolean {
    const enabled = IMAGE_GEN_ENABLED;
    if (!enabled || enabled === '') return true;
    return enabled.toLowerCase() === 'true' || enabled === '1';
}

interface RateLimitResult {
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
}

async function checkRateLimits(
    userIdentifier: string,
    identifierType: 'client_id' | 'ip'
): Promise<RateLimitResult> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cooldownAgo = new Date(now.getTime() - COOLDOWN_SECONDS * 1000);

    try {
        // Check cooldown (last 60 seconds)
        const { data: recentRequests, error: cooldownError } = await supabase
            .from('rate_limits')
            .select('created_at')
            .eq('user_identifier', userIdentifier)
            .gte('created_at', cooldownAgo.toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

        if (cooldownError) {
            console.error('[Guardrails] Cooldown check error:', cooldownError);
            return { allowed: true }; // Fail open
        }

        if (recentRequests && recentRequests.length > 0) {
            const lastRequest = new Date(recentRequests[0].created_at);
            const secondsSinceLastRequest = Math.floor((now.getTime() - lastRequest.getTime()) / 1000);
            const retryAfter = COOLDOWN_SECONDS - secondsSinceLastRequest;

            return {
                allowed: false,
                reason: `Cooldown active. Please wait ${retryAfter} seconds.`,
                retryAfter,
            };
        }

        // Check user daily limit
        const { count: userCount, error: userError } = await supabase
            .from('rate_limits')
            .select('*', { count: 'exact', head: true })
            .eq('user_identifier', userIdentifier)
            .gte('created_at', oneDayAgo.toISOString());

        if (userError) {
            console.error('[Guardrails] User daily check error:', userError);
            return { allowed: true };
        }

        if (userCount !== null && userCount >= USER_DAILY_LIMIT) {
            return {
                allowed: false,
                reason: `User daily limit reached (${USER_DAILY_LIMIT} generations per 24 hours)`,
                retryAfter: 86400,
            };
        }

        // Check global daily limit
        const { count: globalCount, error: globalError } = await supabase
            .from('rate_limits')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', oneDayAgo.toISOString());

        if (globalError) {
            console.error('[Guardrails] Global daily check error:', globalError);
            return { allowed: true };
        }

        if (globalCount !== null && globalCount >= GLOBAL_DAILY_LIMIT) {
            return {
                allowed: false,
                reason: `Global capacity reached. System is at maximum daily limit.`,
                retryAfter: 3600,
            };
        }

        return { allowed: true };
    } catch (error) {
        console.error('[Guardrails] Rate limit check failed:', error);
        return { allowed: true }; // Fail open
    }
}

async function recordGeneration(
    userIdentifier: string,
    identifierType: 'client_id' | 'ip'
): Promise<void> {
    try {
        const { error } = await supabase
            .from('rate_limits')
            .insert({
                user_identifier: userIdentifier,
                identifier_type: identifierType,
            });

        if (error) {
            console.error('[Guardrails] Failed to record generation:', error);
        }
    } catch (error) {
        console.error('[Guardrails] Record generation error:', error);
    }
}

interface IdempotencyResult {
    exists: boolean;
    data?: any;
}

async function checkIdempotency(
    idempotencyKey: string,
    userIdentifier: string
): Promise<IdempotencyResult> {
    try {
        const { data, error } = await supabase
            .from('idempotency_cache')
            .select('response_data')
            .eq('idempotency_key', idempotencyKey)
            .eq('user_identifier', userIdentifier)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return { exists: false };
            }
            console.error('[Guardrails] Idempotency check error:', error);
            return { exists: false };
        }

        return {
            exists: true,
            data: data.response_data,
        };
    } catch (error) {
        console.error('[Guardrails] Idempotency check failed:', error);
        return { exists: false };
    }
}

async function cacheIdempotency(
    idempotencyKey: string,
    userIdentifier: string,
    responseData: any
): Promise<void> {
    try {
        const { error } = await supabase
            .from('idempotency_cache')
            .insert({
                idempotency_key: idempotencyKey,
                user_identifier: userIdentifier,
                response_data: responseData,
            });

        if (error) {
            console.error('[Guardrails] Failed to cache idempotency:', error);
        }
    } catch (error) {
        console.error('[Guardrails] Cache idempotency error:', error);
    }
}

// ============================================================
// IMAGE GENERATION
// ============================================================

function buildPrompt(data: any): string {
    let prompt = 'Generate a realistic after-renovation image of this Swedish bathroom.';

    if (data.description) {
        prompt += ` User wants: ${data.description}.`;
    }

    if (data.step1?.image_observations?.summary_sv) {
        prompt += ` Current state: ${data.step1.image_observations.summary_sv}.`;
    }

    if (data.step2?.scope_summary_sv) {
        prompt += ` Renovation scope: ${data.step2.scope_summary_sv}.`;
    }

    if (data.answers) {
        const details: string[] = [];
        if (data.answers.tile_price_tier) details.push(`tile quality: ${data.answers.tile_price_tier}`);
        if (data.answers.tile_size_category) details.push(`tile size: ${data.answers.tile_size_category}`);
        if (data.answers.waterproofing) details.push(`waterproofing: ${data.answers.waterproofing}`);
        if (data.answers.underfloor_heating) details.push(`floor heating: ${data.answers.underfloor_heating}`);

        if (details.length > 0) {
            prompt += ` Details: ${details.join(', ')}.`;
        }
    }

    prompt += ' Show modern Swedish bathroom design with high-quality finishes, proper lighting, and realistic materials. Maintain the same room layout and perspective as the before image.';

    return prompt;
}

async function generateAfterImage(beforeImageBase64: string, prompt: string) {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const result = await model.generateContent([
        {
            inlineData: {
                data: beforeImageBase64,
                mimeType: 'image/jpeg',
            },
        },
        { text: prompt },
    ]);

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts || parts.length === 0) {
        throw new Error('No image data in Gemini response');
    }

    for (const part of parts) {
        if ('inlineData' in part && part.inlineData) {
            const imageData = part.inlineData.data;
            const mimeType = part.inlineData.mimeType || 'image/png';

            return {
                imageData,
                mimeType,
                usageMetadata: response.usageMetadata || null,
            };
        }
    }

    throw new Error('No image data found in Gemini response parts');
}

async function uploadAndSign(imageData: string, mimeType: string): Promise<{ path: string; signedUrl: string }> {
    const buffer = Uint8Array.from(atob(imageData), c => c.charCodeAt(0));

    const date = new Date().toISOString().split('T')[0];
    const uuid = crypto.randomUUID();
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const path = `ai-offert/after-images/${date}/${uuid}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, {
            contentType: mimeType,
            upsert: false,
        });

    if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: signData, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);

    if (signError || !signData) {
        throw new Error(`Signing failed: ${signError?.message || 'Unknown error'}`);
    }

    // Extract only plain string value to avoid SDK object circular refs
    const signedUrlString = String(signData.signedUrl || '');

    return {
        path: String(path),
        signedUrl: signedUrlString,
    };
}

// ============================================================
// MAIN HANDLER
// ============================================================

serve(async (req) => {
    // CORS headers
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, idempotency-key, x-client-id',
            },
        });
    }

    let userId = 'unknown';
    let identifierType: 'client_id' | 'ip' = 'ip';
    let idempotencyKey = 'unknown';
    let lastStep = 'STEP_0';

    try {
        console.log('STEP_10');
        lastStep = 'STEP_10';

        // 1. Circuit breaker check
        if (!isCircuitBreakerOpen()) {
            console.log('event=image_gen_blocked reason=circuit_breaker');
            return new Response(JSON.stringify({
                error: 'Service Unavailable',
                message: 'Image generation temporarily disabled',
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        // 2. Parse form data
        const formData = await req.formData();

        // 3. Extract user identifier
        const clientId = formData.get('client_id') || req.headers.get('x-client-id');
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown';
        userId = (clientId as string) || ip;
        identifierType = clientId ? 'client_id' : 'ip';

        // 4. Extract and validate idempotency key
        idempotencyKey = (formData.get('idempotency_key') || req.headers.get('idempotency-key')) as string;
        if (!idempotencyKey) {
            return new Response(JSON.stringify({
                error: 'Bad Request',
                message: 'idempotency_key is required (UUID format)',
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        // 5. Check idempotency cache
        const cachedResult = await checkIdempotency(idempotencyKey, userId);
        if (cachedResult.exists) {
            console.log('event=image_gen_idempotency_hit user=' + userId);

            // Return cached data as plain object
            const cachedData = cachedResult.data || {};
            return new Response(JSON.stringify({
                after_image_url: cachedData.after_image_url || '',
                after_image_path: cachedData.after_image_path || '',
                mime_type: cachedData.mime_type || 'image/png',
                provider: cachedData.provider || 'gemini',
                model: cachedData.model || GEMINI_MODEL,
                latency_ms: cachedData.latency_ms || 0,
            }), {
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        console.log('STEP_20');
        lastStep = 'STEP_20';

        // 6. Check rate limits
        const rateLimitCheck = await checkRateLimits(userId, identifierType);
        if (!rateLimitCheck.allowed) {
            console.log('event=image_gen_blocked reason=' + (rateLimitCheck.reason || 'unknown'));

            const statusCode = rateLimitCheck.reason?.includes('Global') ? 503 : 429;
            return new Response(JSON.stringify({
                error: statusCode === 503 ? 'Service Unavailable' : 'Too Many Requests',
                message: rateLimitCheck.reason,
                retry_after_seconds: rateLimitCheck.retryAfter,
            }), {
                status: statusCode,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        // 7. Log attempt
        console.log('event=image_gen_attempt user=' + userId);

        // 8. Record generation (optimistic)
        await recordGeneration(userId, identifierType);

        console.log('STEP_30');
        lastStep = 'STEP_30';

        // 9. Extract image and metadata
        const imageFile = formData.get('image') || formData.get('before_image');
        if (!imageFile || !(imageFile instanceof File)) {
            return new Response(JSON.stringify({
                error: 'Bad Request',
                message: 'No image file provided',
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        const imageBuffer = await imageFile.arrayBuffer();
        const originalSizeBytes = imageBuffer.byteLength;

        // Resize image to max 768px to reduce token usage and cost
        let resizedBuffer = new Uint8Array(imageBuffer);
        let resizedSizeBytes = originalSizeBytes;

        try {
            console.log('STEP_35_RESIZE_START');
            const image = await Image.decode(new Uint8Array(imageBuffer));

            // Only resize if larger than 768px in either dimension
            if (image.width > 768 || image.height > 768) {
                const resized = image.resize(image.width > image.height ? 768 : Image.RESIZE_AUTO, image.height > image.width ? 768 : Image.RESIZE_AUTO);
                resizedBuffer = await resized.encodeJPEG(80); // Encode as JPEG with 80% quality
                resizedSizeBytes = resizedBuffer.byteLength;
                console.log('RESIZE_COMPLETE: ' + originalSizeBytes + ' -> ' + resizedSizeBytes + ' bytes');
            } else {
                // Optimization: re-encode to JPEG 80 even if small to ensure compression
                resizedBuffer = await image.encodeJPEG(80);
                resizedSizeBytes = resizedBuffer.byteLength;
                console.log('COMPRESS_COMPLETE: ' + originalSizeBytes + ' -> ' + resizedSizeBytes + ' bytes');
            }
        } catch (resizeError) {
            console.error('RESIZE_FAILED: ' + resizeError);
            // Fallback to original buffer if resize fails
        }

        // Convert to base64
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < resizedBuffer.length; i += chunkSize) {
            const chunk = resizedBuffer.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64Image = btoa(binary);

        console.log('STEP_40');
        lastStep = 'STEP_40';

        // Parse JSON fields
        const step1 = formData.get('step1') ? JSON.parse(formData.get('step1') as string) : null;
        const step2 = formData.get('step2') ? JSON.parse(formData.get('step2') as string) : null;
        const answers = formData.get('answers') ? JSON.parse(formData.get('answers') as string) : null;
        const description = formData.get('description') as string || '';

        const prompt = buildPrompt({ description, step1, step2, answers });

        console.log('STEP_50');
        lastStep = 'STEP_50';

        // 10. Generate image
        const startTime = Date.now();

        let imageData: string;
        let mimeType: string;
        let usageMetadata: any = null;

        try {
            console.log('STEP_60');
            lastStep = 'STEP_60';

            const result = await generateAfterImage(base64Image, prompt);
            imageData = result.imageData;
            mimeType = result.mimeType;
            usageMetadata = result.usageMetadata;

            console.log('STEP_61');
            lastStep = 'STEP_61';

            // Optimize output image (convert to JPEG 85)
            // Gemini usually returns PNG (~1.5MB). Converting to JPEG 85 (~200KB) saves storage & bandwidth.
            try {
                const rawOutputBuffer = Uint8Array.from(atob(imageData), c => c.charCodeAt(0));
                const outputImage = await Image.decode(rawOutputBuffer);
                const optimizedBuffer = await outputImage.encodeJPEG(85);

                // Update imageData and mimeType
                let binary = '';
                for (let i = 0; i < optimizedBuffer.length; i += chunkSize) {
                    const chunk = optimizedBuffer.subarray(i, i + chunkSize);
                    binary += String.fromCharCode.apply(null, Array.from(chunk));
                }
                imageData = btoa(binary);
                mimeType = 'image/jpeg';

                console.log('OUTPUT_OPTIMIZED: ' + rawOutputBuffer.byteLength + ' -> ' + optimizedBuffer.byteLength + ' bytes');
            } catch (optError) {
                console.error('OUTPUT_OPTIMIZATION_FAILED: ' + optError);
                // Fallback to original
            }

        } catch (geminiError: any) {
            console.log('GEMINI_ERROR_MESSAGE=' + (geminiError?.message || String(geminiError)));
            console.log('GEMINI_ERROR_STACK=' + (geminiError?.stack || ''));
            throw geminiError;
        }

        console.log('STEP_70');
        lastStep = 'STEP_70';

        // 11. Upload and sign
        console.log('STEP_80');
        lastStep = 'STEP_80';

        const { path, signedUrl } = await uploadAndSign(imageData, mimeType);

        console.log('STEP_81');
        lastStep = 'STEP_81';

        const latencyMs = Date.now() - startTime;

        // Calculate approximate output size
        const outputSizeBytes = Math.ceil((imageData.length * 3) / 4); // Approx base64 to bytes

        // 12. Build response (ensure all values are primitives)
        const response: any = {
            after_image_url: String(signedUrl),
            after_image_path: String(path),
            mime_type: String(mimeType),
            provider: 'gemini',
            model: String(GEMINI_MODEL),
            latency_ms: Number(latencyMs),
        };

        // Add debug info if enabled
        if (IMAGE_GEN_DEBUG) {
            response.debug_info = {
                input_original_bytes: originalSizeBytes,
                input_resized_bytes: resizedSizeBytes,
                output_bytes: outputSizeBytes,
                token_counts: usageMetadata ? {
                    prompt: usageMetadata.promptTokenCount || 0,
                    candidates: usageMetadata.candidatesTokenCount || 0,
                    total: usageMetadata.totalTokenCount || 0
                } : null
            };
        }

        console.log('STEP_90');
        lastStep = 'STEP_90';

        // 13. Cache response
        await cacheIdempotency(idempotencyKey, userId, response);

        // 14. Log success (extract only scalar fields)
        const safeUsageMetadata = usageMetadata ? {
            promptTokenCount: usageMetadata.promptTokenCount || 0,
            candidatesTokenCount: usageMetadata.candidatesTokenCount || 0,
            totalTokenCount: usageMetadata.totalTokenCount || 0,
        } : null;

        // Structured logging for cost analysis
        console.log(JSON.stringify({
            event: 'image_gen_success',
            user: userId,
            latency_ms: latencyMs,
            model: GEMINI_MODEL,
            input_original_bytes: originalSizeBytes,
            input_resized_bytes: resizedSizeBytes,
            output_bytes: outputSizeBytes,
            usage_metadata: safeUsageMetadata
        }));

        console.log('STEP_100');
        lastStep = 'STEP_100';

        return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });

    } catch (error: any) {
        // Log failure (no JSON.stringify on error object)
        console.log('event=image_gen_failure user=' + userId + ' error=' + (error.message || String(error)) + ' last_step=' + lastStep);
        console.error('[Edge Function] Error:', error);

        return new Response(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message || 'Image generation failed',
            last_step: lastStep,
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }
});
