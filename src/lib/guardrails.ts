import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Rate limit configuration
const COOLDOWN_SECONDS = 60;
const USER_DAILY_LIMIT = 3;
const GLOBAL_DAILY_LIMIT = 50;

// Initialize Supabase client
const supabase = SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

export interface RateLimitResult {
    allowed: boolean;
    reason?: string;
    retryAfter?: number; // seconds
}

export interface IdempotencyResult {
    exists: boolean;
    data?: any;
}

/**
 * Check if circuit breaker allows image generation
 */
export function isCircuitBreakerOpen(): boolean {
    const enabled = process.env.IMAGE_GEN_ENABLED;
    // Default to true if not set
    if (enabled === undefined || enabled === null || enabled === '') {
        return true;
    }
    return enabled.toLowerCase() === 'true' || enabled === '1';
}

/**
 * Check all rate limits (cooldown, user daily, global daily)
 */
export async function checkRateLimits(
    userIdentifier: string,
    identifierType: 'client_id' | 'ip'
): Promise<RateLimitResult> {
    if (!supabase) {
        throw new Error('Supabase not configured for rate limiting');
    }

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
            // Fail open on DB errors to avoid blocking legitimate requests
            return { allowed: true };
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

        // Check user daily limit (last 24 hours)
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
                retryAfter: 86400, // 24 hours
            };
        }

        // Check global daily limit (last 24 hours)
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
                retryAfter: 3600, // Suggest retry in 1 hour
            };
        }

        return { allowed: true };
    } catch (error) {
        console.error('[Guardrails] Rate limit check failed:', error);
        // Fail open on unexpected errors
        return { allowed: true };
    }
}

/**
 * Record a generation attempt (call after rate limit check passes)
 */
export async function recordGeneration(
    userIdentifier: string,
    identifierType: 'client_id' | 'ip'
): Promise<void> {
    if (!supabase) {
        throw new Error('Supabase not configured for rate limiting');
    }

    try {
        const { error } = await supabase
            .from('rate_limits')
            .insert({
                user_identifier: userIdentifier,
                identifier_type: identifierType,
            });

        if (error) {
            console.error('[Guardrails] Failed to record generation:', error);
            // Don't throw - we don't want to block the request if recording fails
        }
    } catch (error) {
        console.error('[Guardrails] Record generation error:', error);
    }
}

/**
 * Check if an idempotency key has been used before
 */
export async function checkIdempotency(
    idempotencyKey: string,
    userIdentifier: string
): Promise<IdempotencyResult> {
    if (!supabase) {
        return { exists: false };
    }

    try {
        const { data, error } = await supabase
            .from('idempotency_cache')
            .select('response_data')
            .eq('idempotency_key', idempotencyKey)
            .eq('user_identifier', userIdentifier)
            .single();

        if (error) {
            // Not found is expected for new requests
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

/**
 * Cache a successful response for idempotency
 */
export async function cacheIdempotency(
    idempotencyKey: string,
    userIdentifier: string,
    responseData: any
): Promise<void> {
    if (!supabase) {
        return;
    }

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
            // Don't throw - caching failure shouldn't break the response
        }
    } catch (error) {
        console.error('[Guardrails] Cache idempotency error:', error);
    }
}

/**
 * Cleanup old records (can be called periodically or via cron)
 */
export async function cleanupOldRecords(): Promise<void> {
    if (!supabase) {
        return;
    }

    try {
        const rateLimitCutoff = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours
        const idempotencyCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours

        // Cleanup rate limits
        const { error: rateLimitError } = await supabase
            .from('rate_limits')
            .delete()
            .lt('created_at', rateLimitCutoff.toISOString());

        if (rateLimitError) {
            console.error('[Guardrails] Rate limit cleanup error:', rateLimitError);
        }

        // Cleanup idempotency cache
        const { error: idempotencyError } = await supabase
            .from('idempotency_cache')
            .delete()
            .lt('created_at', idempotencyCutoff.toISOString());

        if (idempotencyError) {
            console.error('[Guardrails] Idempotency cleanup error:', idempotencyError);
        }

        console.log('[Guardrails] Cleanup completed');
    } catch (error) {
        console.error('[Guardrails] Cleanup failed:', error);
    }
}
