#!/bin/bash

# Fly.io After-Image Verification Script
# Usage: ./verify-fly-after-image.sh [path-to-image]

IMAGE_PATH="${1:-test_cases/bathroom/cases/local_run/input.jpg}"
FLY_URL="https://remorph-price-engine-cccc.fly.dev/api/ai/offert/after-image"

if [ ! -f "$IMAGE_PATH" ]; then
    echo "❌ Image file not found: $IMAGE_PATH"
    echo "Usage: $0 [path-to-image]"
    exit 1
fi

echo "--- FLY.IO AFTER-IMAGE VERIFICATION ---"
echo "Target: $FLY_URL"
echo "Image: $IMAGE_PATH"
echo ""
echo "Uploading and generating after-image..."
echo ""

# Make the request and parse response with Node.js
curl -X POST "$FLY_URL" \
  -F "image=@$IMAGE_PATH" \
  -F "description=Modern Swedish bathroom" \
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
