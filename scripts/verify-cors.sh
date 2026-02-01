#!/bin/bash
# Verify CORS headers

FUNCTION_URL="https://rgmpclaxbfeyzxnyepjs.functions.supabase.co/generate-after-image"
ORIGIN="http://localhost:3000"

echo "1. Testing OPTIONS preflight..."
curl -v -X OPTIONS "$FUNCTION_URL" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type" 2>&1 | grep "< Access-Control-Allow"

echo ""
echo "2. Testing POST (Error case to check headers)..."
curl -v -X POST "$FUNCTION_URL" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1 | grep "< Access-Control-Allow"

echo ""
echo "Done. Check output for allowed origin/headers."
