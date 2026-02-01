#!/bin/bash
# Phase 2 Cost Verification Script

set -e

FUNCTION_URL="https://rgmpclaxbfeyzxnyepjs.functions.supabase.co/generate-after-image"
TEST_IMAGE="test_cases/bathroom/cases/local_run/input.jpg"

if [ ! -f "$TEST_IMAGE" ]; then
    echo "❌ Test image not found: $TEST_IMAGE"
    exit 1
fi

echo "=== Phase 2 Cost Verification ==="
echo "Function URL: $FUNCTION_URL"
echo "Image: $TEST_IMAGE"
echo ""

for i in {1..3}; do
    echo "Generating Image #$i..."
    IDEMPOTENCY_KEY=$(uuidgen)
    CLIENT_ID="cost-test-$(date +%s)-$i"

    RESPONSE=$(curl -s -X POST "$FUNCTION_URL" \
      -F "image=@$TEST_IMAGE" \
      -F "idempotency_key=$IDEMPOTENCY_KEY" \
      -F "client_id=$CLIENT_ID" \
      -F 'step1={}' \
      -F 'answers={}')

    # Extract Debug Info
    DEBUG_INFO=$(echo "$RESPONSE" | jq '.debug_info')
    
    if [ "$DEBUG_INFO" != "null" ]; then
        echo "✅ Success!"
        echo "Debug Info:"
        echo "$DEBUG_INFO"
        
        INPUT_ORIG=$(echo "$DEBUG_INFO" | jq '.input_original_bytes')
        INPUT_RESIZED=$(echo "$DEBUG_INFO" | jq '.input_resized_bytes')
        
        if [ "$INPUT_RESIZED" -lt "$INPUT_ORIG" ]; then
             echo "💰 Cost Reduction Confirmed: $INPUT_ORIG -> $INPUT_RESIZED bytes"
        else
             echo "⚠️ No size reduction (image might be small already)"
        fi
    else
        echo "❌ Failed or no debug info"
        echo "Response: $RESPONSE"
    fi
    echo "--------------------------------"
    sleep 5 # slight delay
done
