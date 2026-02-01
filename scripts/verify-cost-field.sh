#!/bin/bash
# Verify debug_cost field

# Load env vars
if [ -f .env ]; then
  export $(cat .env | grep -v '#' | xargs)
fi

FUNCTION_URL="https://rgmpclaxbfeyzxnyepjs.functions.supabase.co/generate-after-image"
IMAGE_FILE="test_cases/bathroom/cases/local_run/input.jpg"
IDEMPOTENCY_KEY=$(uuidgen)
CLIENT_ID="test-verification-script"

# Minimal Dummy JSONs
STEP1='{"inferred_project_type":"bathroom","image_observations":{"summary_sv":"test","inferred_size_sqm":{"value":5,"confidence":"medium","basis_sv":"visual"},"visible_elements":["toilet"],"uncertainties":[]},"scope_guess":{"value":"full_bathroom","confidence":"medium","basis_sv":"test"},"follow_up_questions":[]}'
ANSWERS='{}'

echo "Generating Image to check debug_cost..."
RESPONSE=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "idempotency-key: $IDEMPOTENCY_KEY" \
  -H "x-client-id: $CLIENT_ID" \
  -F "image=@$IMAGE_FILE" \
  -F "step1=$STEP1" \
  -F "answers=$ANSWERS")

echo "$RESPONSE" | grep "debug_cost"

# Extract and pretty print debug_cost
echo "$RESPONSE" | sed -n 's/.*"debug_cost":\({[^}]*}\).*/\1/p'
