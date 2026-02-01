# Generate After-Image Edge Function

## Purpose
Generates AI after-renovation images using Gemini with production-grade guardrails.

## Guardrails
- **Circuit Breaker**: `IMAGE_GEN_ENABLED` env var
- **Rate Limits** (rolling 24h):
  - Cooldown: 1 generation / 60s per user
  - Per-user: 3 generations / 24h
  - Global: 50 generations / 24h
- **Idempotency**: Same `idempotency_key` never triggers Gemini twice
- **Structured Logging**: All events logged as JSON

## Required Environment Variables

Set in Supabase Dashboard → Edge Functions → Secrets:

```bash
GOOGLE_API_KEY=your_gemini_api_key
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
IMAGE_GEN_ENABLED=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_BUCKET=ai-offert-images
SUPABASE_SIGNED_URL_TTL_SECONDS=3600
```

## Database Setup

Run the migration before deploying:

```sql
-- Execute migrations/001_guardrails.sql in Supabase SQL Editor
```

## Deployment

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to project
supabase link --project-ref your-project-ref

# Deploy function
supabase functions deploy generate-after-image

# Set secrets
supabase secrets set GOOGLE_API_KEY=xxx
supabase secrets set IMAGE_GEN_ENABLED=true
# ... (set all required secrets)
```

## Testing

```bash
# Get function URL from Supabase Dashboard
FUNCTION_URL="https://your-project.supabase.co/functions/v1/generate-after-image"

# Test with curl
curl -X POST $FUNCTION_URL \
  -F "image=@test.jpg" \
  -F "idempotency_key=$(uuidgen)" \
  -F "client_id=test-user" \
  -F "step1={...}" \
  -F "answers={...}"
```

## Request Format

**Multipart Form Data**:
- `image` or `before_image`: Image file (JPEG/PNG)
- `idempotency_key`: UUID (required)
- `client_id`: User identifier (optional, falls back to IP)
- `step1`: JSON string (optional)
- `step2`: JSON string (optional)
- `answers`: JSON string (optional)
- `description`: String (optional)

## Response Format

**Success (200)**:
```json
{
  "after_image_url": "https://...",
  "after_image_path": "ai-offert/after-images/2026-02-01/uuid.png",
  "mime_type": "image/png",
  "provider": "gemini",
  "model": "gemini-2.5-flash-image",
  "latency_ms": 3200
}
```

**Rate Limited (429)**:
```json
{
  "error": "Too Many Requests",
  "message": "Cooldown active. Please wait 45 seconds.",
  "retry_after_seconds": 45
}
```

**Service Unavailable (503)**:
```json
{
  "error": "Service Unavailable",
  "message": "Image generation temporarily disabled"
}
```

## Monitoring

View logs in Supabase Dashboard → Edge Functions → Logs.

**Key Events**:
- `image_gen_attempt`: Generation started
- `image_gen_success`: Generation completed
- `image_gen_blocked`: Rate limit hit
- `image_gen_failure`: Error occurred
- `image_gen_idempotency_hit`: Cached response returned
