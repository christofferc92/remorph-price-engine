-- Gemini Image Generation Guardrails
-- Migration: 001_guardrails.sql
-- Purpose: Rate limiting and idempotency tracking

-- Rate limit tracking (rolling 24h window)
CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  user_identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('client_id', 'ip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_user ON rate_limits(user_identifier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_global ON rate_limits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON rate_limits(created_at);

-- Idempotency cache (48h retention)
CREATE TABLE IF NOT EXISTS idempotency_cache (
  idempotency_key UUID PRIMARY KEY,
  user_identifier TEXT NOT NULL,
  response_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for cleanup
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_cache(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_cleanup ON idempotency_cache(created_at);

-- Cleanup function (optional - can be run via cron or manually)
-- DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '25 hours';
-- DELETE FROM idempotency_cache WHERE created_at < NOW() - INTERVAL '48 hours';
