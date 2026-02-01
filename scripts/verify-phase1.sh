#!/bin/bash
# Phase 1 Verification Tests for Supabase Edge Function

set -e

FUNCTION_URL="https://rgmpclaxbfeyzxnyepjs.functions.supabase.co/generate-after-image"
TEST_IMAGE="test_cases/bathroom/cases/local_run/input.jpg"

# Check if test image exists
if [ ! -f "$TEST_IMAGE" ]; then
    echo "❌ Test image not found: $TEST_IMAGE"
    exit 1
fi

echo "=== Phase 1 Verification Tests ==="
echo "Function URL: $FUNCTION_URL"
echo ""

# Test 1: Success (200)
echo "Test 1: Success (200)"
echo "----------------------"
IDEMPOTENCY_KEY=$(uuidgen)
CLIENT_ID="test-user-$(date +%s)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$FUNCTION_URL" \
  -F "image=@$TEST_IMAGE" \
  -F "idempotency_key=$IDEMPOTENCY_KEY" \
  -F "client_id=$CLIENT_ID" \
  -F 'step1={}' \
  -F 'answers={}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | awk 'NR>1{print prev} {prev=$0}')

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Success: HTTP $HTTP_CODE"
    echo "Response: $BODY" | jq -r '.after_image_url' | head -c 50
    echo "..."
else
    echo "❌ Failed: HTTP $HTTP_CODE"
    echo "Response: $BODY"
fi
echo ""

# Test 2: Cooldown (429)
echo "Test 2: Cooldown (429)"
echo "----------------------"
sleep 2
IDEMPOTENCY_KEY_2=$(uuidgen)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$FUNCTION_URL" \
  -F "image=@$TEST_IMAGE" \
  -F "idempotency_key=$IDEMPOTENCY_KEY_2" \
  -F "client_id=$CLIENT_ID" \
  -F 'step1={}' \
  -F 'answers={}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | awk 'NR>1{print prev} {prev=$0}')

if [ "$HTTP_CODE" = "429" ]; then
    echo "✅ Cooldown enforced: HTTP $HTTP_CODE"
    echo "Message: $(echo "$BODY" | jq -r '.message')"
else
    echo "⚠️  Expected 429, got: HTTP $HTTP_CODE"
    echo "Response: $BODY"
fi
echo ""

# Test 3: Idempotency (cached 200)
echo "Test 3: Idempotency (cached 200)"
echo "--------------------------------"
echo "Waiting 60s for cooldown..."
sleep 60

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$FUNCTION_URL" \
  -F "image=@$TEST_IMAGE" \
  -F "idempotency_key=$IDEMPOTENCY_KEY" \
  -F "client_id=$CLIENT_ID" \
  -F 'step1={}' \
  -F 'answers={}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | awk 'NR>1{print prev} {prev=$0}')

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Idempotency hit: HTTP $HTTP_CODE (should be instant)"
    echo "Response: $BODY" | jq -r '.after_image_url' | head -c 50
    echo "..."
else
    echo "❌ Failed: HTTP $HTTP_CODE"
    echo "Response: $BODY"
fi
echo ""

# Test 4: Missing idempotency_key (400)
echo "Test 4: Missing idempotency_key (400)"
echo "-------------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$FUNCTION_URL" \
  -F "image=@$TEST_IMAGE" \
  -F "client_id=test-user-no-key" \
  -F 'step1={}' \
  -F 'answers={}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | awk 'NR>1{print prev} {prev=$0}')

if [ "$HTTP_CODE" = "400" ]; then
    echo "✅ Validation enforced: HTTP $HTTP_CODE"
    echo "Message: $(echo "$BODY" | jq -r '.message')"
else
    echo "⚠️  Expected 400, got: HTTP $HTTP_CODE"
    echo "Response: $BODY"
fi
echo ""

echo "=== Verification Complete ==="
echo ""
echo "Next: Check Supabase Dashboard → Edge Functions → Logs for structured JSON events"
