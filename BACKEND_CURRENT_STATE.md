# Remorph Price Engine Backend - Current State Documentation

> **Document Purpose**: This document provides a complete technical reference for the Remorph renovation estimator backend. It is written for engineers who need to understand, modify, or debug the system safely.

---

## A) System Overview

### What the Backend Does

The Remorph price engine is a **bathroom renovation cost estimator** that:
- Accepts bathroom analysis data (from AI image analysis or manual input)
- Accepts user-selected renovation options (fixtures, finishes, layout changes)
- Calculates detailed line-item pricing with labor/material breakdowns
- Returns structured estimates with ROT tax deduction calculations
- Supports site condition allowances for logistics complexity

### High-Level Request Flow

```
Frontend → POST /api/estimate → Adapter/Canonicalizer → Pricing Engine → Response
```

**Detailed Flow**:
1. **Frontend sends** a JSON payload to `POST /api/estimate` with:
   - `analysis`: Room analysis (size, fixtures, condition)
   - `outcome`: User-selected renovation options
   - `overrides`: Size bucket overrides
   - `site_conditions` (optional): Logistics/permit data

2. **Adapter layer** ([server.ts:159-215](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L159-L215)):
   - Detects if payload is "normalized" (from AI) vs "canonical" (from frontend)
   - Converts normalized analysis into canonical schema
   - Defaults missing fields, clamps confidence values
   - Validates against Zod schema

3. **Pricing engine** ([contract.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/src/contract.ts), [estimator.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/estimator.ts)):
   - Maps `outcome` selections to intents/selections
   - Computes room areas (floor, walls, ceiling, wet zones)
   - Builds task list from catalog + dynamic allowances
   - Applies rate card pricing
   - Calculates totals, ROT deductions, ranges

4. **Response** returns:
   - `line_items[]`: Detailed task breakdown
   - `totals`: Base, project management, contingency, grand total
   - `estimate_range`: Low/mid/high cost projections
   - `rot_summary`: ROT-eligible labor and tax deduction
   - `confidence_tier`, `warnings`, `needs_confirmation_ids`

---

## B) Runtime & Deployment

### Deployment Platform

**Fly.io** - App name: `remorph-price-engine-cccc`

**Configuration**: [fly.toml](file:///Users/christofferchristiansen/remorph-price-engine-clean/fly.toml)
```toml
app = "remorph-price-engine-cccc"
[build]
  dockerfile = "apps/price-engine-service/Dockerfile"
[env]
  PORT = "3000"
```

**Dockerfile**: [apps/price-engine-service/Dockerfile](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/Dockerfile)
- Base: `node:20-bullseye-slim`
- Entry: `npm run price-engine:start`
- Port: `3000`

### Deployment Commands

```bash
git commit
git push
fly deploy --app remorph-price-engine-cccc
```

### Environment Variables

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `PORT` | HTTP server port | No (defaults to 3000) |
| `OPENAI_API_KEY` | For `/api/analyze` image analysis | Only for `/api/analyze` |
| `OPENAI_IMAGE_MODEL` | OpenAI model name | No (defaults to `gpt-4o-mini`) |
| `GOOGLE_API_KEY` | For `/api/ai/offert/*` Gemini-based AI price engine | Only for `/api/ai/offert/*` |
| `NODE_ENV` | Runtime environment | No (set to `production` in start script) |
| `SUPABASE_URL` | Supabase project URL | Yes (for `/after-image`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Private service role key for uploads | Yes (for `/after-image`) |
| `SUPABASE_BUCKET` | Image bucket name | No (default `ai-offert-images`) |
| `SUPABASE_SIGNED_URL_TTL_SECONDS` | Signed URL expiration | No (default `3600`) |
| `RETURN_BASE64` | If "1", include base64 in response (for debug) | No |

### Local Development

**Start dev server**:
```bash
npm run price-engine:dev
# Runs: TSX_DISABLE_DAEMON=1 tsx apps/price-engine-service/src/server.ts
```

**Run tests**:
```bash
npm run test:api-floor-heating
# Runs regression tests for floor heating and site conditions
```

**Generate catalogs**:
```bash
npm run generate:price-copy-catalog
# Generates docs/line_item_catalog.json and docs/option_enums_catalog.json
```

### Entry Point

**File**: [apps/price-engine-service/src/server.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts)

**Startup**:
**Startup**:
- Listens on `[::]:${PORT}` (all interfaces, IPv4/IPv6 dual-stack)
- Runs connectivity self-test on startup (checks `127.0.0.1`, `[::1]`, and Fly private IPv6)
- Initializes storage directories (`/data` or `./data` or temp fallback)
- Logs: `Price engine service ready on port 3000 (host: all interfaces)`

### Health Check

**Route**: `GET /api/health`

**Response**:
```json
{
  "ok": true,
  "service": "price-engine",
  "version": "abc1234",  // git SHA
  "storage": "persistent"  // or "ephemeral"
}
```

---

## C) Public API Contract

### Route Inventory

| Method | Path | Purpose | Auth | Rate Limit |
|--------|------|---------|------|------------|
| `POST` | `/api/estimate` | Generate renovation estimate | None | None |
| `POST` | `/api/upload` | Upload bathroom images | None | None |
| `POST` | `/api/analyze` | AI analysis of uploaded image | None | None |
| `POST` | `/api/ai/offert/analyze` | Gemini-based image analysis (Step 1) | None | None |
| `POST` | `/api/ai/offert/generate` | Generate offertunderlag from analysis (Step 2) | None | None |
| `GET` | `/api/health` | Health check | None | None |

All routes use the same CORS middleware (see section G).

---

### POST /api/estimate

**Purpose**: Generate a detailed renovation estimate from analysis + user selections.

#### Request Schema

**Content-Type**: `application/json` (10 MB limit)

**Canonical Schema** ([canonicalEstimatorContractSchema.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/shared/canonicalEstimatorContractSchema.ts)):

```typescript
{
  analysis: {
    room_type: "bathroom" | "other",
    bathroom_size_estimate: "under_4_sqm" | "between_4_and_7_sqm" | "over_7_sqm",
    bathroom_size_confidence: number,  // 0-1
    detected_fixtures: {
      shower_present: boolean,
      bathtub_present: boolean,
      toilet_present: boolean,
      sink_present: boolean
    },
    layout_features: {
      shower_zone_visible: boolean,
      wet_room_layout: boolean,
      tight_space: boolean,
      irregular_geometry: boolean
    },
    ceiling_features: {
      ceiling_visible: boolean,
      sloped_ceiling_detected: boolean
    },
    condition_signals: {
      overall_condition: "good" | "average" | "poor" | "unknown"
    },
    image_quality: {
      sufficient_for_estimate: boolean,
      issues: string[]
    },
    analysis_confidence: number  // 0-1
  },
  overrides: {
    bathroom_size_final: "under_4_sqm" | "between_4_and_7_sqm" | "over_7_sqm",
    bathroom_size_source: "ai_estimated" | "user_overridden"
  },
  outcome: {
    shower_type: "walk_in_shower_glass" | "shower_cabin" | "no_shower" | "keep",
    bathtub: "yes" | "no" | "keep",
    toilet_type: "wall_hung" | "floor_standing" | "keep",
    vanity_type: "vanity_with_cabinet" | "simple_sink" | "no_sink" | "keep",
    wall_finish: "tiles_all_walls" | "large_format_tiles_all_walls" | "tiles_wet_zone_only" | "painted_walls_only" | "keep",
    floor_finish: "standard_ceramic_tiles" | "large_format_tiles" | "vinyl_wet_room_mat" | "microcement_seamless" | "keep",
    ceiling_type: "painted_ceiling" | "moisture_resistant_panels" | "sloped_painted" | "sloped_with_panels" | "keep",
    layout_change: "yes" | "no",
    shower_niches: "none" | "one" | "two_or_more",
    floor_heating?: "floor_heating_on" | "floor_heating_off" | "keep"
  },
  measurementOverride?: {
    length?: number,
    width?: number,
    area?: number,
    ceilingHeight?: number,
    wetZone?: "shower_only" | "corner_2_walls" | "three_walls" | "full_wet_room"
  },
  roomMeasurements?: {
    floor_area_m2: number | null,
    wall_area_m2: number | null,
    ceiling_area_m2: number | null,
    wet_zone_wall_area_m2: number | null
  },
  site_conditions?: {
    floor_elevator?: "house_or_ground" | "apt_elevator" | "apt_no_elevator_1_2" | "apt_no_elevator_3_plus" | "unknown",
    carry_distance?: "under_20m" | "20_50m" | "50_100m" | "over_100m" | "unknown",
    parking_loading?: "easy_nearby" | "limited" | "none" | "unknown",
    work_time_restrictions?: "none" | "standard_daytime" | "strict" | "unknown",
    access_constraints_notes?: string,  // max 280 chars
    permits_brf?: "none" | "brf_required" | "permit_required" | "unknown",
    wetroom_certificate_required?: "required" | "preferred" | "not_needed" | "unknown",
    build_year_bucket?: "pre_1960" | "1960_1979" | "1980_1999" | "2000_plus" | "unknown",
    last_renovated?: "under_5y" | "5_15y" | "over_15y" | "unknown",
    hazardous_material_risk?: "none_known" | "suspected" | "confirmed" | "unknown",
    occupancy?: "not_living_in" | "living_in_full" | "living_in_partly" | "unknown",
    must_keep_facility_running?: "yes" | "no" | "unknown",
    container_possible?: "yes" | "no" | "unknown",
    protection_level?: "normal" | "extra" | "unknown",
    water_shutoff_accessible?: "yes" | "no" | "unknown",
    electrical_panel_accessible?: "yes" | "no" | "unknown",
    recent_stambyte?: "yes" | "no" | "unknown"
  }
}
```

#### Example Request (Minimal)

```json
{
  "analysis": {
    "room_type": "bathroom",
    "bathroom_size_estimate": "between_4_and_7_sqm",
    "bathroom_size_confidence": 0.72,
    "detected_fixtures": {
      "shower_present": true,
      "bathtub_present": false,
      "toilet_present": true,
      "sink_present": true
    },
    "layout_features": {
      "shower_zone_visible": true,
      "wet_room_layout": false,
      "tight_space": false,
      "irregular_geometry": false
    },
    "ceiling_features": {
      "ceiling_visible": true,
      "sloped_ceiling_detected": false
    },
    "condition_signals": {
      "overall_condition": "average"
    },
    "image_quality": {
      "sufficient_for_estimate": true,
      "issues": []
    },
    "analysis_confidence": 0.81
  },
  "overrides": {
    "bathroom_size_final": "between_4_and_7_sqm",
    "bathroom_size_source": "ai_estimated"
  },
  "outcome": {
    "shower_type": "walk_in_shower_glass",
    "bathtub": "no",
    "toilet_type": "wall_hung",
    "vanity_type": "vanity_with_cabinet",
    "wall_finish": "tiles_all_walls",
    "floor_finish": "standard_ceramic_tiles",
    "ceiling_type": "painted_ceiling",
    "layout_change": "no",
    "shower_niches": "none",
    "floor_heating": "floor_heating_on"
  }
}
```

#### Response Schema

**Success (200)**:
```json
{
  "id": "uuid-or-timestamp",
  "estimate": {
    "line_items": [
      {
        "key": "demolish_remove_floor_tiles",
        "trade_group": "demolition",
        "qty": 5.5,
        "unit": "m2",
        "labor_sek": 3575,
        "material_sek": 0,
        "subtotal_sek": 3575,
        "rot_eligible": true,
        "note": "ceramic_tile_standard"  // optional
      }
    ],
    "totals": {
      "base_subtotal_sek": 143387,
      "project_management_sek": 10037,
      "contingency_sek": 11471,
      "grand_total_sek": 154858
    },
    "trade_group_totals": [
      { "trade_group": "demolition", "subtotal_sek": 15953 },
      { "trade_group": "tiling_or_vinyl", "subtotal_sek": 33732 }
    ],
    "flags": ["requires_demolition", "requires_waterproofing"],
    "info_flags": ["PLAUSIBILITY_BAND_PB_003"],
    "assumptions": [],
    "warnings": ["Total per m² is 44245 SEK/m² which is outside 8,000–30,000 guideline."],
    "needs_confirmation_ids": [],
    "derived_areas": { "non_tiled_wall_area_m2": 0 },
    "plausibility_band": "PB-003",
    "sek_per_m2": 44245.40,
    "estimate_quality": "confirmed",
    "estimate_range": {
      "low_sek": 140000,
      "mid_sek": 155000,
      "high_sek": 170000
    },
    "labor_range": { "min_sek": 55000, "max_sek": 65000 },
    "material_range": { "min_sek": 45000, "max_sek": 52000 },
    "confidence_tier": "high",
    "confidence_reasons": ["has_warnings_outliers"],
    "rot_summary": {
      "rot_rate": 0.3,
      "rot_eligible_labor_sek": 62000,
      "rot_deduction_sek": 18600,
      "total_after_rot_sek": 136258,
      "rot_cap_applied": false,
      "rot_cap_reason": "unknown_user_tax_limit"
    },
    "site_conditions_effect": {  // only present if site_conditions provided
      "added_labor_sek": 5000,
      "added_material_sek": 0,
      "added_total_sek": 5000,
      "reason_codes": ["FLOOR_NO_ELEVATOR_1_2", "PERMIT_REQUIRED"]
    }
  },
  "metadata": {
    "contract": { /* echoes input contract */ },
    "overrides": { /* echoes overrides */ },
    "text": "",
    "fileCount": 0
  },
  "record": null
}
```

**Error (400)**: Invalid payload
```json
{
  "error": "Invalid contract payload",
  "details": [/* Zod validation errors */]
}
```

**Error (500)**: Pricing engine failure
```json
{
  "error": "Estimate failed",
  "detail": "Error message"
}
```

#### Validation Rules

- All enum fields must match exact string values (case-sensitive)
- Confidence values must be 0-1
- `shower_niches` auto-defaults to `"none"` if missing ([server.ts:152-156](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L152-L156))
- `site_conditions.access_constraints_notes` max 280 characters
- Missing `overrides` fields are auto-filled with defaults

---

## C) AI Price Engine & Offert API

> **System Context**: These endpoints run within the `remorph-price-engine` service on Fly.io, handling the new AI-based estimation flow.

### 1. Service Overview

- **Entry Point**: [apps/price-engine-service/src/server.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts) mounts routes at `/api/ai/offert`.
- **Router**: [src/routes/aiOffertRoutes.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/routes/aiOffertRoutes.ts)
- **Primary Dependencies**: 
  - `GoogleGenerativeAI` (Gemini 2.5)
  - `@supabase/supabase-js` (Storage)

### 2. AI Offert Routes & Contracts

#### POST /api/ai/offert/analyze

**Purpose**: Analyze "before" image to generate renovate-able observations and follow-up questions.

**Request (multipart/form-data)**:
- `image`: File (required, JPEG/PNG)
- `description`: String (optional)

**Response (JSON)**:
```json
{
  "inferred_project_type": "bathroom",
  "image_observations": {
    "summary_sv": "Ett badrum med...",
    "uncertainties": ["tätskikt ålder"]
  },
  "scope_guess": { "value": "floor_only" },
  "follow_up_questions": [
    { 
      "id": "q1", 
      "question_sv": "...", 
      "type": "single_choice",
      "options": ["Option A", "Option B"], 
      "prefill_guess": "Option A" 
    }
  ]
}
```

#### POST /api/ai/offert/generate

**Purpose**: Generate text-based "offertunderlag" (quote basis) from Step 1 analysis + User Answers.

**Request (JSON)**:
```json
{
  "step1": { ... }, // Full Step 1 response
  "answers": { "q1": "Option A" } // User answers keyed by Question ID
}
```

**Response (JSON)**:
```json
{
  "scope_summary_sv": "...",
  "confirmed_inputs": { "floor_area_sqm": 5.5, ... },
  "price_range_sek": { "low": 25000, "high": 35000 },
  "cost_breakdown_estimate": { ... }
}
```

#### POST /api/ai/offert/after-image (v1)

**Purpose**: Generate a photorealistic after-renovation visualization using AI.

**Request (multipart/form-data)**:
- `image`: File (required, "before" image)
- `step1`: JSON String (required, analysis data)
- `answers`: JSON String (required, user answers)
- `step2`: JSON String (optional, generate response)
- `description`: String (optional, extra prompt)

**Response (JSON)**:
```json
{
  "after_image_url": "https://xyz.supabase.co/storage/v1/object/sign/ai-offert/after-images/2026-01-31/uuid.png?token=...",
  "after_image_path": "ai-offert/after-images/2026-01-31/uuid.png",
  "mime_type": "image/png",
  "provider": "gemini",
  "model": "gemini-2.5-flash-image",
  "latency_ms": 1234,
  "after_image_base64": "..." // Omitted by default. Present if debug=1
}
```

**Debug Mode**:
- Add `?debug=1` query parameter OR set `RETURN_BASE64=1` env var.
- **Effect**: Populates `after_image_base64`. Used for local debugging only, not recommended for production due to OOM risks.

### 3. Gemini After-Image Provider

- **Implementation**: [src/ai-image-engine/providers/gemini.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/ai-image-engine/providers/gemini.ts)
- **Model**: `gemini-2.5-flash-image` (default)
- **Output**: Generates `Buffer` from base64 parts provided by Gemini SDK.
- **Failure Handling**:
  - Checks for empty parts or text refusals.
  - Throws `Gemini image generation failed` on known errors.

### 4. Supabase Storage Integration

- **Implementation**: [src/lib/supabaseStorage.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/lib/supabaseStorage.ts)
- **Bucket**: `ai-offert-images`
- **Object Path**: `ai-offert/after-images/<YYYY-MM-DD>/<UUID>.png`
- **Signed URL**: Uses `createSignedUrl` with 1 hour TTL (default).

### 5. Credentials & Security

**Required Environment Variables**:
| Variable | Purpose | Critical Note |
|----------|---------|---------------|
| `SUPABASE_URL` | API Endpoint | `https://<project-id>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-Side Auth | **MUST be the 'service_role' secret**. NOT 'anon'. |

**Common Gotchas**:
- **Wrong Key**: Using `anon` public key will cause upload failures (403/Forbidden) due to RLS policies usually requiring authentication for writing.
- **Newline Chars**: Copy-pasting keys often adds `\n`. Ensure strings are trimmed.

### 6. Error Handling & Observability

- **Supabase Upload Failure**:
  - Logs: `[AI-Offert] After-image error: Supabase upload failed: <message>`
  - Response: `500 Internal Server Error`
- **Gemini Failure**:
  - Logs: `[Gemini After-Image] Generation error: ...`
  - Response: `502 Bad Gateway` (if upstream fails) or `500`.

### 7. Memory Safety & OOM Risk

- **Base64 String**: NOT kept in memory for the response JSON by default.
- **Buffer**: Image bytes exist as a Buffer during the upload phase but are garbage collected after the request handles the stream.
- **Risk**: Returning base64 `?debug=1` increases heap usage by ~33% of image size. Avoid in high-concurrency production.

---

## D) Adapter / Canonicalization Layer

### Purpose

The adapter converts **normalized AI analysis payloads** (from `/api/analyze`) into the **canonical schema** expected by the pricing engine.

### Location

**File**: [apps/price-engine-service/src/server.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L159-L215)

**Functions**:
- `isNormalizedAnalysisShape()` - Detects normalized payload (lines 113-117)
- `adaptNormalizedPayload()` - Converts normalized → canonical (lines 159-215)
- `mapSizeToBucket()` - Maps floor area to size bucket (lines 119-126)
- `deriveOverallCondition()` - Infers condition from signals (lines 128-136)
- `buildCanonicalOverrides()` - Ensures overrides exist (lines 138-149)

### Detection Logic

Payload is "normalized" if `analysis` contains:
- `size_estimate` OR
- `surfaces` OR
- `condition_signals`

```typescript
function isNormalizedAnalysisShape(payload: Record<string, unknown>) {
  const analysis = payload.analysis as Record<string, unknown> | undefined;
  if (!analysis) return false;
  return Boolean(analysis.size_estimate || analysis.surfaces || analysis.condition_signals);
}
```

### Transformation Rules

| Normalized Field | Canonical Field | Logic |
|------------------|-----------------|-------|
| `size_estimate.floor_area_m2.mid` | `bathroom_size_estimate` | `< 4` → `under_4_sqm`, `4-7` → `between_4_and_7_sqm`, `> 7` → `over_7_sqm` |
| `analysis_confidence` | `analysis_confidence` | Clamped to [0, 1], defaults to 0.6 |
| `size_estimate.confidence` | `bathroom_size_confidence` | Clamped to [0, 1], defaults to 0.5 |
| `condition_signals.moisture_signs` | `overall_condition` | `true` → `"poor"` |
| `condition_signals.visible_damage` | `overall_condition` | `true` → `"average"` |
| `condition_signals.surface_wear` | `overall_condition` | `"low"` → `"good"`, `"high"` → `"average"` |
| `surfaces.ceiling_type` | `ceiling_features.sloped_ceiling_detected` | Starts with `"sloped"` → `true` |
| `room_type` | `room_type` | `"bathroom"` or `"wc"` → `"bathroom"`, else `"other"` |
| `detected_fixtures.shower_present` | `layout_features.shower_zone_visible` | Direct copy |
| `size_estimate.floor_area_m2.mid < 4` | `layout_features.tight_space` | `true` if mid < 4 |

### Defaulting Behavior

- Missing `bathroom_size_final` → defaults to mapped bucket
- Missing `bathroom_size_source` → defaults to `"ai_estimated"`
- Missing `shower_niches` in `outcome` → defaults to `"none"`
- Missing confidence → 0.6 (analysis), 0.5 (size)
- `image_quality.sufficient_for_estimate` → `true` if confidence ≥ 0.5

### Logging

When adapter is used:
```
[estimate] POST /api/estimate origin=https://lovable.app adapter_used=true
```

### Error Handling

1. Try canonical schema validation
2. If fails, try adapter
3. If adapter succeeds, re-validate canonical schema
4. If both fail, return 400 with combined errors

---

## E) Pricing Engine Logic

### Core Modules

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| [contract.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/src/contract.ts) | Maps frontend contract → estimator inputs | `evaluateContract()`, `buildRoomFromContract()`, `computeSiteConditionsAllowances()` |
| [estimator.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/estimator.ts) | Computes quantities & builds task list | `estimate()`, `buildTasks()`, `computeQuantity()` |
| [outcomeMapper.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/outcomeMapper.ts) | Maps `outcome` → intents/selections | `mapOutcomeToEstimatorInputs()` |
| [scopeCompiler.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/scopeCompiler.ts) | Compiles scope flags from intents | `compileDerivedFlags()` |

### Quantity Computation

**Function**: `computeQuantity()` in [estimator.ts:438-541](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/estimator.ts#L438-L541)

**Key Drivers**:

| Qty Driver | Calculation | Example Tasks |
|------------|-------------|---------------|
| `floor_area_m2` | `applyMinWaste(floor_area_m2, 1.1, 4)` | `demolish_remove_floor_tiles`, `install_floor_tiles_or_vinyl` |
| `wall_area_m2` | `applyMin(wall_area_m2, 5)` | `install_wall_backer_boards`, `repair_patch_walls` |
| `wet_zone_wall_area_m2` | `applyMinWaste(wet_zone_wall_area_m2, 1.1, 2)` | `demolish_remove_wall_tiles`, `install_wall_tiles` |
| `ceiling_area_m2` | `applyMin(ceiling_area_m2, 5)` | `prep_and_paint_ceiling` |
| `fixture_count` | Count of replaced fixtures | `install_toilet`, `install_sink_and_faucet` |
| `fixed_item` | Always 1 | `replace_floor_drain`, `handover_inspection` |

**Waste Factors**:
- Floor: 10% waste, min 4 m²
- Walls: 10% waste, min 2 m²
- Ceiling: No waste, min 5 m²

**Helper Functions**:
```typescript
function applyMinWaste(area: number | null, wasteFactor: number, minArea: number) {
  if (!area || area <= 0) return minArea;
  return Math.max(area * wasteFactor, minArea);
}

function applyMin(area: number | null, minArea: number) {
  if (!area || area <= 0) return minArea;
  return Math.max(area, minArea);
}
```

### Area Derivation

**Size Buckets** ([estimator.ts:248-269](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/estimator.ts#L248-L269)):

```typescript
const sizeBuckets = {
  small: {  // under_4_sqm
    floor_area_m2: 4,
    wall_area_m2: 14,
    ceiling_area_m2: 4,
    wet_zone_wall_area_m2: 10
  },
  medium: {  // between_4_and_7_sqm
    floor_area_m2: 5.5,
    wall_area_m2: 20,
    ceiling_area_m2: 5.5,
    wet_zone_wall_area_m2: 16
  },
  large: {  // over_7_sqm
    floor_area_m2: 7,
    wall_area_m2: 26,
    ceiling_area_m2: 7,
    wet_zone_wall_area_m2: 22
  }
};
```

**Wet Zone Calculation**:
- If `wall_finish` includes "wet_zone_only" → use `wet_zone_wall_area_m2`
- If "all_walls" → use full `wall_area_m2`
- If "painted_walls_only" → skip waterproofing

### Condition Adjustments

**Condition Signals** influence:
- `needs_confirmation_ids` (e.g., `NC-CONDITION-POOR` if `overall_condition === "poor"`)
- Warnings (e.g., "Moisture detected, recommend inspection")
- No direct price multipliers today

### Layout Change Logic

When `outcome.layout_change === "yes"`:
- Adds `demolition_layout_change_allowance` (3500 SEK labor)
- Adds `plumbing_layout_change_reroute_allowance` (9000 SEK labor + 1000 SEK material)
- Adds `substrate_layout_change_allowance` (4000 SEK labor + 500 SEK material)
- Adds `documentation_layout_change_allowance` (2000 SEK labor)
- Adds `layout_change_area_allowance` (1200 SEK/m² × floor area)
- Adds `layout_change_fixture_allowance` (4500 SEK/fixture)
- Adds `layout_change_wet_zone_allowance` (700 SEK/m² × 50% of wet zone area)

### Magic Numbers / Heuristics

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `DEFAULT_CEILING_HEIGHT` | 2.4 m | [contract.ts:17](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/src/contract.ts#L17) | Fallback ceiling height |
| `MIN_RANGE_SEK` | 2000 SEK | [contract.ts:55](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/src/contract.ts#L55) | Minimum estimate range spread |
| `MIN_RANGE_PCT` | 3% | [contract.ts:54](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/src/contract.ts#L54) | Minimum range as % of mid |
| `MAX_RANGE_PCT` | 25% | [contract.ts:55](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/src/contract.ts#L55) | Maximum range as % of mid |
| `project_management_pct` | 7% | [ratecard.placeholder.yaml:68](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/ratecard.placeholder.yaml#L68) | PM overhead |
| `contingency_pct` | 8% | [ratecard.placeholder.yaml:69](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/ratecard.placeholder.yaml#L69) | Contingency buffer |
| `rot_rate` | 30% | Hardcoded | ROT tax deduction rate |

---

## F) Catalogs / Enums / Line Items

### Line Item Definitions

**Source**: [catalog/bathroom_catalog.yaml](file:///Users/christofferchristiansen/remorph-price-engine-clean/catalog/bathroom_catalog.yaml)

**Structure**:
```yaml
tasks:
  - task_key: demolish_remove_floor_tiles
    trade_group: demolition
    rot_eligible: true
    qty_driver: floor_area_m2
    qty_rules_source_ids: ["QD-010"]
    source_ids: ["TK-DEM-001"]
```

**Trade Groups**:
- `demolition`
- `carpentry_substrate`
- `waterproofing`
- `tiling_or_vinyl`
- `plumbing`
- `electrical`
- `ventilation`
- `painting`
- `cleanup_waste`
- `project_management_docs`
- `site_conditions`

### Rate Card

**Source**: [packages/price-engine/estimator/ratecard.placeholder.yaml](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/ratecard.placeholder.yaml)

**Structure**:
```yaml
task_rates:
  demolish_remove_floor_tiles:
    unit: "m2"
    labor_sek_per_unit: 650
    material_sek_per_unit: 0
    min_charge_sek: 2500
```

### Catalog Generation

**Script**: [scripts/generate-price-engine-catalogs.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/scripts/generate-price-engine-catalogs.ts)

**Command**:
```bash
npm run generate:price-copy-catalog
# or
TSX_DISABLE_DAEMON=1 npx tsx scripts/generate-price-engine-catalogs.ts
```

**Output Files**:
- [docs/line_item_catalog.json](file:///Users/christofferchristiansen/remorph-price-engine-clean/docs/line_item_catalog.json) - All tasks with units/drivers
- [docs/option_enums_catalog.json](file:///Users/christofferchristiansen/remorph-price-engine-clean/docs/option_enums_catalog.json) - All outcome enums with labels

**Process**:
1. Loads `bathroom_catalog.yaml` via `loadCatalog()`
2. Loads `ratecard.placeholder.yaml` via `loadRateCard()`
3. Merges catalog tasks + allowance definitions
4. Exports to JSON with units from rate card

### Enum Definitions

**Source**: [src/shared/canonicalEstimatorContract.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/shared/canonicalEstimatorContract.ts)

**Example**:
```typescript
export const showerTypeOptions = [
  { value: "walk_in_shower_glass", label: "Inbyggd dusch med glasvägg" },
  { value: "shower_cabin", label: "Duschkabin" },
  { value: "no_shower", label: "Ingen dusch" },
  { value: "keep", label: "Behåll befintlig" }
];
```

### Sync Guarantees

**Manual Process**:
1. Edit YAML catalogs or TypeScript enums
2. Run `npm run generate:price-copy-catalog`
3. Commit generated JSON files
4. Deploy

**No Automated Validation** - Developer must ensure:
- Task keys in catalog match rate card
- Enum values in contract match outcome mapper
- Generated JSON is committed before deploy

---

## G) CORS & Security

### CORS Implementation

**File**: [apps/price-engine-service/src/server.ts:17-58](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L17-L58)

**Middleware**: `apiCorsMiddleware` applied to all `/api` routes

**Allowed Origins** (regex-based):
```typescript
const LOVABLE_PROJECT_REGEX = /^https:\/\/(?:.+\.)?lovableproject\.com$/i;
const LOVABLE_APP_REGEX = /^https:\/\/(?:.+\.)?lovable\.app$/i;
const USERCONTENT_GOOG_REGEX = /^https:\/\/(?:.+\.)?usercontent\.goog$/i;
const GOOGLEUSERCONTENT_COM_REGEX = /^https:\/\/(?:.+\.)?googleusercontent\.com$/i;
const LOCALHOST_REGEX = /^https?:\/\/localhost(?::\d+)?$/i;
const LOCALHOST_IPV4_REGEX = /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i;
```

**Behavior**:
- **Allowed origins**: Sets `Access-Control-Allow-Origin`, `Vary`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`
- **Disallowed origins**: Logs warning, continues without CORS headers (request not blocked, but browser will reject)
- **OPTIONS preflight**: Returns 204 for allowed origins

**Example Log**:
```
[CORS] rejected origin https://evil.com for POST /api/estimate
```

### Authentication

**None** - All endpoints are public.

### Rate Limiting

**None** - No rate limiting implemented.

### Input Validation

- **JSON body**: 10 MB limit ([server.ts:60](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L60))
- **Multipart uploads**: 10 MB per file ([server.ts:62](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L62))
- **Schema validation**: Zod schemas reject invalid enums/types
- **String length**: `access_constraints_notes` max 280 chars

### Security Risks

⚠️ **No authentication** - Anyone can call `/api/estimate`
⚠️ **No rate limiting** - Vulnerable to abuse
⚠️ **CORS logging only** - Disallowed origins still process requests (browser blocks response)
⚠️ **OpenAI API key** - If leaked, `/api/analyze` can be abused

---

## H) Testing & Verification

### Existing Tests

**File**: [scripts/api-estimate-floor-heating-test.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/scripts/api-estimate-floor-heating-test.ts)

**Purpose**: Regression tests for:
- Floor heating toggle (`outcome.floor_heating`)
- Site conditions allowances
- Estimate range tightening with measurements
- ROT deduction calculations

**Run**:
```bash
npm run test:api-floor-heating
```

**Coverage**:
- ✅ Floor heating line items appear when `floor_heating: "floor_heating_on"`
- ✅ Site conditions add allowance tasks
- ✅ Estimate range narrows when measurements provided
- ✅ ROT summary matches eligible labor
- ❌ No tests for adapter layer
- ❌ No tests for CORS
- ❌ No tests for error cases

### Manual Verification with curl

**Example: Minimal estimate**:
```bash
curl -X POST http://localhost:3000/api/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "analysis": {
      "room_type": "bathroom",
      "bathroom_size_estimate": "between_4_and_7_sqm",
      "bathroom_size_confidence": 0.72,
      "detected_fixtures": {
        "shower_present": true,
        "bathtub_present": false,
        "toilet_present": true,
        "sink_present": true
      },
      "layout_features": {
        "shower_zone_visible": true,
        "wet_room_layout": false,
        "tight_space": false,
        "irregular_geometry": false
      },
      "ceiling_features": {
        "ceiling_visible": true,
        "sloped_ceiling_detected": false
      },
      "condition_signals": {
        "overall_condition": "average"
      },
      "image_quality": {
        "sufficient_for_estimate": true,
        "issues": []
      },
      "analysis_confidence": 0.81
    },
    "overrides": {
      "bathroom_size_final": "between_4_and_7_sqm",
      "bathroom_size_source": "ai_estimated"
    },
    "outcome": {
      "shower_type": "walk_in_shower_glass",
      "bathtub": "no",
      "toilet_type": "wall_hung",
      "vanity_type": "vanity_with_cabinet",
      "wall_finish": "tiles_all_walls",
      "floor_finish": "standard_ceramic_tiles",
      "ceiling_type": "painted_ceiling",
      "layout_change": "no",
      "shower_niches": "none"
    }
  }'
```

**Example: With site conditions**:
```bash
curl -X POST http://localhost:3000/api/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "analysis": { /* same as above */ },
    "overrides": { /* same as above */ },
    "outcome": { /* same as above */ },
    "site_conditions": {
      "floor_elevator": "apt_no_elevator_1_2",
      "carry_distance": "20_50m",
      "parking_loading": "limited",
      "permits_brf": "permit_required",
      "occupancy": "living_in_partly"
    }
  }'
```

### Known Gaps

- **No unit tests** for individual functions
- **No integration tests** for `/api/upload` or `/api/analyze`
- **No CORS tests** (must test manually with browser)
- **No performance tests** (large payloads, concurrent requests)
- **No fixture validation** (catalog/rate card consistency)

---

## I) Sharp Edges / Risks

### Fragile Areas

#### 1. Adapter Detection Logic
**Risk**: If frontend sends a payload with both `size_estimate` AND `bathroom_size_estimate`, adapter may incorrectly trigger.

**Location**: [server.ts:113-117](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L113-L117)

**Mitigation**: Frontend should never mix normalized + canonical fields.

#### 2. Enum Value Changes
**Risk**: Changing enum values in `canonicalEstimatorContract.ts` breaks existing frontend payloads.

**Example**: Renaming `"walk_in_shower_glass"` → `"walk_in_glass"` causes 400 errors.

**Mitigation**: Treat enums as immutable API contract. Add new values, deprecate old ones.

#### 3. Catalog/Rate Card Sync
**Risk**: Adding a task to `bathroom_catalog.yaml` without adding it to `ratecard.placeholder.yaml` causes runtime errors.

**Location**: [estimator.ts:438-541](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/estimator.ts#L438-L541)

**Mitigation**: Always run `npm run generate:price-copy-catalog` and verify output before deploy.

#### 4. Missing `shower_niches` Default
**Risk**: If adapter logic is bypassed, missing `shower_niches` causes validation error.

**Location**: [server.ts:152-156](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L152-L156)

**Mitigation**: Frontend should always send `shower_niches`, but backend defaults to `"none"`.

#### 5. CORS Logging vs Blocking
**Risk**: Disallowed origins still process requests (waste compute), only browser blocks response.

**Location**: [server.ts:43-55](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L43-L55)

**Mitigation**: Add explicit 403 response for disallowed origins.

### Backwards Compatibility Constraints

**Frontend Payload Contract**:
- **Cannot remove** required fields from `canonicalEstimatorContractSchema`
- **Cannot rename** enum values
- **Cannot change** field types (e.g., `string` → `number`)
- **Can add** optional fields
- **Can add** new enum values

**Response Contract**:
- **Cannot remove** fields from `estimate` object
- **Cannot change** field types
- **Can add** new fields
- **Can add** new line item keys

### Performance Risks

#### 1. Image Analysis (`/api/analyze`)
**Risk**: OpenAI API calls can take 5-30 seconds, blocking the request.

**Mitigation**: Frontend should show loading state, implement timeout.

#### 2. Large Payloads
**Risk**: 10 MB JSON limit allows very large `site_conditions.access_constraints_notes` or deeply nested objects.

**Mitigation**: Validate string lengths, reject excessive nesting.

#### 3. Concurrent Requests
**Risk**: No request queuing or rate limiting. 100 concurrent `/api/estimate` calls may overwhelm Node.js event loop.

**Mitigation**: Add rate limiting, consider worker threads for CPU-heavy calculations.

### Data Integrity Risks

#### 1. Storage Ephemeral Mode
**Risk**: If `/data` mount fails, uploads/analysis cache stored in temp dir (lost on restart).

**Location**: [server.ts:577-594](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts#L577-L594)

**Check**: `GET /api/health` returns `"storage": "ephemeral"` if fallback used.

#### 2. No Database
**Risk**: All data is file-based. No transactions, no ACID guarantees.

**Mitigation**: Treat uploads/analysis as cache, not source of truth.

---

## Summary

### What Works Today

✅ **POST /api/estimate** - Generates detailed renovation estimates with:
- Line-item pricing (labor/material/subtotal)
- ROT tax deduction calculations
- Site condition allowances
- Estimate ranges (low/mid/high)
- Confidence tiers and warnings

✅ **POST /api/ai/offert/analyze** - Gemini-based image analysis (NEW):
- Analyzes bathroom images
- Generates 10 follow-up questions
- Prefills answers from image analysis
- Swedish language output

✅ **POST /api/ai/offert/generate** - AI-based quote generation (NEW):
- Generates Swedish "offertunderlag"
- Conservative pricing estimates
- Cost breakdowns and risk factors
- Bathroom-only for now

✅ **Adapter Layer** - Converts AI analysis payloads to canonical schema

✅ **CORS** - Allows Lovable, Google User Content, localhost

✅ **Catalog System** - YAML-based task definitions, JSON generation

✅ **Testing** - Basic regression tests for floor heating and site conditions

### What Doesn't Work / Isn't Implemented

❌ **Authentication** - All endpoints are public

❌ **Rate Limiting** - Vulnerable to abuse

❌ **Error Recovery** - No retry logic for OpenAI API failures

❌ **Comprehensive Tests** - No unit tests, limited integration tests

❌ **CORS Blocking** - Disallowed origins still process requests

❌ **Catalog Validation** - No automated checks for catalog/rate card consistency

### Critical Files Reference

| File | Purpose |
|------|---------|
| [apps/price-engine-service/src/server.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/apps/price-engine-service/src/server.ts) | Express server, routes, adapter, CORS |
| [src/routes/aiOffertRoutes.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/routes/aiOffertRoutes.ts) | AI price engine API routes |
| [src/ai-price-engine/services/gemini.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/ai-price-engine/services/gemini.ts) | Gemini API client for image analysis |
| [src/ai-price-engine/services/offert-generator.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/ai-price-engine/services/offert-generator.ts) | Offertunderlag generation service |
| [src/ai-price-engine/prompts/bathroom/step1.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/ai-price-engine/prompts/bathroom/step1.ts) | Step 1 prompt (image → questions) |
| [src/ai-price-engine/prompts/bathroom/step2.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/ai-price-engine/prompts/bathroom/step2.ts) | Step 2 prompt (answers → offert) |
| [src/ai-price-engine/types.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/ai-price-engine/types.ts) | AI price engine TypeScript types |
| [packages/price-engine/src/contract.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/src/contract.ts) | Frontend contract → estimator inputs |
| [packages/price-engine/estimator/estimator.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/estimator.ts) | Quantity computation, task building |
| [src/shared/canonicalEstimatorContractSchema.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/src/shared/canonicalEstimatorContractSchema.ts) | Zod schemas for validation |
| [catalog/bathroom_catalog.yaml](file:///Users/christofferchristiansen/remorph-price-engine-clean/catalog/bathroom_catalog.yaml) | Task definitions, intents, flags |
| [packages/price-engine/estimator/ratecard.placeholder.yaml](file:///Users/christofferchristiansen/remorph-price-engine-clean/packages/price-engine/estimator/ratecard.placeholder.yaml) | Pricing rates for all tasks |
| [scripts/generate-price-engine-catalogs.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/scripts/generate-price-engine-catalogs.ts) | Catalog JSON generation |
| [scripts/smoke-ai-offert.ts](file:///Users/christofferchristiansen/remorph-price-engine-clean/scripts/smoke-ai-offert.ts) | AI price engine smoke test |

---

**Document Version**: 2026-01-31  
**Backend Version**: Git SHA from `GET /api/health`  
**Deployment**: Fly.io `remorph-price-engine-cccc`
