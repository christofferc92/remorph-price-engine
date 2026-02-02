# Debugging Report: Price Engine Consistency

## Executive Summary
The backend price engine (`/api/estimate`) correctly calculates different prices for distinct, valid payloads. The reported issue of "identical prices" is likely caused by one of two factors:
1. **Frontend Payload Construction**: The frontend is sending identical payloads or payloads that normalize to the same "default" values due to missing fields.
2. **Incorrect Endpoint Usage**: If the frontend uses `/api/ai/offert/reprice` to handle scope changes (e.g., room size), this endpoint **ignores** structural changes and only recalculates based on existing line items.

## Evidence
### A) Reproduction
We created a script `debug-repro.ts` sending two distinct payloads to `http://localhost:3000/api/estimate`:
- **Payload A (Small, Basic)**: Resulted in ~150,538 SEK
- **Payload B (Large, Premium)**: Resulted in ~340,142 SEK

**Result**: ✅ Prices differ correctly.

### B) Instrumentation
We added logging to `apps/price-engine-service/src/server.ts` to capture:
- Request ID & Hash
- Derived Size Values
- Adapter Usage
- Line Item Counts

Logs confirm that when inputs differ (Hash A vs Hash B), the derived values and prices differ.

### C) Caching & Reuse
- **Caching**: No caching was found in the `/api/estimate` handler. It evaluates the contract on every request.
- **Deduplication**: `createResultId()` generates unique IDs per request.

### D) Canonicalization & Adapter Logic
The `adaptNormalizedPayload` function in `server.ts` manages invalid payloads.
- If `analysis.size_estimate` is missing/invalid, it defaults key buckets to "Medium".
- If `overrides` are missing, it uses the analysis defaults.
- **Risk**: If the frontend sends a payload that fails strict validation AND happens to omit explicit size overrides, the adapter will force it to the default "Medium" bucket, potentially leading to identical prices for "invalid" small/large inputs.

## Conclusion
The backend is **not** ignoring valid user inputs.
- If the logs show identical `Hash` values, the frontend is sending the same data.
- If the logs show `Adapter=true` and `Size=between_4_and_7_sqm` (default) despite user attempting "Small", the payload is malformed.

## Recommended Fix

### 1. Backend Logging (Already Applied)
Keep the instrumentation in `apps/price-engine-service/src/server.ts` to inspect live traffic.

### 2. Verify Endpoint Usage
If the frontend uses `/api/ai/offert/reprice` for size changes, switch to calling `/api/ai/offert/generate` or `/api/estimate`.

### 3. Minimal Code Change (If Adapter is too aggressive)
If the adapter's default to "Medium" is masking errors, we can force it to error out or use a smarter fallback. However, keeping the current forgiving behavior is usually desired unless it masks bugs.

**To debug live**: Monitor the server logs for `[DEBUG_ESTIMATE]` lines.
