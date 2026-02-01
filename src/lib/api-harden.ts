import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Enhanced Error Response Structure
 */
export interface ErrorResponse {
    error: string;
    details?: any;
    request_id: string;
}

/**
 * Middleware to attach unique Request ID
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
    const requestId = crypto.randomBytes(8).toString('hex');
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
}

/**
 * Helper to send standardized error responses
 */
export function sendError(res: Response, status: number, message: string, details?: any) {
    const requestId = res.locals.requestId || 'unknown';
    const response: ErrorResponse = {
        error: message,
        details,
        request_id: requestId
    };
    return res.status(status).json(response);
}

/**
 * In-memory Rate Limiter
 * 30 requests / 10 minutes per IP
 */
const rateLimitMap = new Map<string, { count: number, resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_LIMIT = 30;

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const ip = req.headers['fly-client-ip'] || req.ip || 'unknown';
    const now = Date.now();

    let record = rateLimitMap.get(ip as string);

    if (!record || now > record.resetAt) {
        record = { count: 1, resetAt: now + WINDOW_MS };
        rateLimitMap.set(ip as string, record);
        return next();
    }

    if (record.count >= MAX_LIMIT) {
        console.warn(`[RateLimit] Blocked IP: ${ip}, Request ID: ${res.locals.requestId}`);
        return sendError(res, 429, 'Too Many Requests', {
            retry_after_ms: record.resetAt - now
        });
    }

    record.count++;
    next();
}

/**
 * Strict CORS Enforcement for AI Offert routes
 * Returns 403 if origin is present but not allowed
 */
export function strictCorsEnforcement(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    // Note: isAllowedOrigin check is already performed in server.ts middleware
    // This second middleware will catch the case where Origin exists but headers were not set (i.e. disallowed)
    if (origin && !res.getHeader('Access-Control-Allow-Origin')) {
        console.warn(`[CORS-Strict] Forbidden origin: ${origin}, Request ID: ${res.locals.requestId}`);
        return sendError(res, 403, 'CORS Forbidden', 'Origin not allowed');
    }
    next();
}
