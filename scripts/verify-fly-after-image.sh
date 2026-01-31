#!/bin/bash

# Fly.io After-Image Verification Script (v1 Contract)
# Usage: ./verify-fly-after-image.sh [path-to-image] [scenario]

IMAGE_PATH="${1:-test_cases/bathroom/cases/local_run/input.jpg}"
SCENARIO="${2:-floor_only}"
FLY_BASE="https://remorph-price-engine-cccc.fly.dev/api/ai/offert"

if [ ! -f "$IMAGE_PATH" ]; then
    echo "❌ Image file not found: $IMAGE_PATH"
    echo "Usage: $0 [path-to-image] [scenario]"
    echo "Scenarios: floor_only (default), full"
    exit 1
fi

echo "--- FLY.IO AFTER-IMAGE VERIFICATION (v1 Contract) ---"
echo "Target: $FLY_BASE/after-image"
echo "Image: $IMAGE_PATH"
echo "Scenario: $SCENARIO"
echo ""

# Step 1: Get step1 data from /analyze
echo "[1/2] Calling /analyze to get step1 data..."
STEP1_RESPONSE=$(curl -X POST "$FLY_BASE/analyze" \
  -F "image=@$IMAGE_PATH" \
  -F "description=Swedish bathroom renovation" \
  --silent \
  --show-error \
  --fail-with-body)

if [ $? -ne 0 ]; then
    echo "❌ Analyze failed"
    echo "$STEP1_RESPONSE"
    exit 1
fi

echo "✅ Got step1 data"

# Step 2: Build answers based on scenario
if [ "$SCENARIO" = "floor_only" ]; then
    ANSWERS='{"scope":"Endast golvbyte","floor":"Klinker","heating":"Ja"}'
    DESCRIPTION="Modern floor tiles"
elif [ "$SCENARIO" = "full" ]; then
    ANSWERS='{"scope":"Totalrenovering","floor":"Klinker","walls":"Hela vägghöjden","tile_quality":"Standard","tile_size":"Medium","heating":"Ja"}'
    DESCRIPTION="Modern Swedish bathroom"
else
    echo "❌ Unknown scenario: $SCENARIO"
    exit 1
fi

echo "[2/2] Calling /after-image with step1 + answers..."
echo ""

# Make the request and parse response with Node.js
curl -X POST "$FLY_BASE/after-image" \
  -F "image=@$IMAGE_PATH" \
  -F "step1=$STEP1_RESPONSE" \
  -F "answers=$ANSWERS" \
  -F "description=$DESCRIPTION" \
  --silent \
  --show-error \
  --fail-with-body | node -e "
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        
        console.log('✅ Response received');
        console.log('MIME Type:', data.mime_type || 'missing');
        console.log('Base64 Length:', data.after_image_base64?.length || 0);
        console.log('Provider:', data.provider || 'unknown');
        console.log('Model:', data.model || 'unknown');
        console.log('Latency:', data.latency_ms || 'unknown', 'ms');
        
        // Assertions
        if (!data.after_image_base64) {
          console.error('❌ Missing after_image_base64');
          process.exit(1);
        }
        if (!data.mime_type) {
          console.error('❌ Missing mime_type');
          process.exit(1);
        }
        if (data.after_image_base64.length < 10000) {
          console.error('❌ Base64 too short:', data.after_image_base64.length);
          process.exit(1);
        }
        
        console.log('');
        console.log('✅ All checks passed');
      } catch (err) {
        console.error('❌ Failed to parse response:', err.message);
        console.error('Raw response:', Buffer.concat(chunks).toString().substring(0, 500));
        process.exit(1);
      }
    });
  "

if [ $? -eq 0 ]; then
    echo "--- VERIFICATION PASSED ---"
else
    echo "--- VERIFICATION FAILED ---"
    exit 1
fi
