# Price-engine API capabilities (today)

This document enumerates every exposed endpoint, the `/api/estimate` contract (canonical + normalized adapters), the live estimator line items, option enums, and CORS logic for `apps/price-engine-service`. File references use the repository paths mentioned in the requirements.

---

## Deployment reminder
- `git commit`
- `git push`
- `fly deploy --app remorph-price-engine-cccc`


## Endpoint inventory
| Method | Path | Purpose | Request content-type | Auth? | CORS notes |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/estimate` | Accepts a canonical estimator contract (or the normalized RoomAnalysisV2 shape) and returns the client-facing quote data plus metadata. | `application/json` (limit 10 MB, `express.json` middleware). | None. | `apiCorsMiddleware` runs on `/api`, so allowed origins must match the regex list for Lovable hosts, Google usercontent, or localhost; `OPTIONS` returns 204 when the origin is allowed and disallowed origins are only logged (`apps/price-engine-service/src/server.ts:17-56`). |
| `POST` | `/api/upload` | Accepts `multipart/form-data` uploads under the `files` field, filters to JPEG/PNG/WEBP, and writes files + metadata for later analysis. | `multipart/form-data` (`multer` with `MAX_FILE_BYTES = 10 MB`, `ALLOWED_MIME_TYPES`). | None. | Same middleware/allow list as above (`src/server.ts:58-85`). |
| `POST` | `/api/analyze` | Given an `image_id` produced by `/api/upload`, returns the cached or AI-generated normalized analysis bundle. The body may include `force` (truthy to skip cache) and `optional_text` (600‑char limit). | `application/json` (`express.json`). | None. | Same CORS behavior (`src/server.ts:58-85`). |
| `GET` | `/api/health` | Health check returning `ok`, service name, git version, and storage mode. | `application/json` | None. | Same CORS middleware (even though only `GET` is used, it still runs, so origins must match the same allow list; see `src/server.ts:17-56`). |

Additional notes:
- `/api/upload` stores files under `uploads/files/`, stores metadata JSON under `uploads/meta/`, and computes an `image_id` via `sha256` (`apps/price-engine-service/src/server.ts:62-305`).
- `/api/analyze` reads metadata, checks `analysis` cache (`analysis/*.json` with `ANALYSIS_CACHE_VERSION = 2`), and otherwise calls `OpenAI.responses` (requires `OPENAI_API_KEY`) via `analyzeWithAi`; it returns `{ normalized, record, ai_raw }` with 502 for AI schema errors and 503 when the API key is missing (`src/server.ts:308-373`).
- CORS middleware only sets `Access-Control-Allow-Origin` for allowed hosts, logs rejections, and does not block the request (the response will later fail if the caller inspects the missing header). Rejections do not send an explicit 403; the request simply keeps flowing without the CORS headers (`src/server.ts:43-55`).

---

## `POST /api/estimate`
### Request contract (canonical)
- The body must satisfy `canonicalEstimatorContractSchema` from `src/shared/canonicalEstimatorContractSchema.ts:1-136`. That means it must contain an `analysis` object (room_type, bathroom size bucket + confidence, detected fixtures, layout/ceiling/condition/image-quality data, and an overall analysis confidence).
- `overrides` is required and carries `{ bathroom_size_final, bathroom_size_source }` (defaults to `ai_estimated`). `measurementOverride` and `roomMeasurements` are optional and supply user-provided linear metrics if available.
- `outcome` encodes all user-selectable intents/fixtures (shower, bathtub, toilet, vanity, wall/floor/ceiling finishes, layout change, and shower niches). `shower_niches` is auto-filled with `"none"` if the caller omits it (`apps/price-engine-service/src/server.ts:152-156`).
- `site_conditions` (optional logistics/permits block). Every field inside is optional, it must match the listed enums, and `access_constraints_notes` is capped at 280 characters. Allowed keys/values:
  - `floor_elevator`: `house_or_ground`, `apt_elevator`, `apt_no_elevator_1_2`, `apt_no_elevator_3_plus`, `unknown`.
  - `carry_distance`: `under_20m`, `20_50m`, `50_100m`, `over_100m`, `unknown`.
  - `parking_loading`: `easy_nearby`, `limited`, `none`, `unknown`.
  - `work_time_restrictions`: `none`, `standard_daytime`, `strict`, `unknown`.
  - `access_constraints_notes`: plain text (max 280 characters).
  - `permits_brf`: `none`, `brf_required`, `permit_required`, `unknown`.
  - `wetroom_certificate_required`: `required`, `preferred`, `not_needed`, `unknown`.
  - `build_year_bucket`: `pre_1960`, `1960_1979`, `1980_1999`, `2000_plus`, `unknown`.
  - `last_renovated`: `under_5y`, `5_15y`, `over_15y`, `unknown`.
  - `hazardous_material_risk`: `none_known`, `suspected`, `confirmed`, `unknown`.
  - `occupancy`: `not_living_in`, `living_in_full`, `living_in_partly`, `unknown`.
  - `must_keep_facility_running`: `yes`, `no`, `unknown`.
  - `container_possible`: `yes`, `no`, `unknown`.
  - `protection_level`: `normal`, `extra`, `unknown`.
  - `water_shutoff_accessible`: `yes`, `no`, `unknown`.
  - `electrical_panel_accessible`: `yes`, `no`, `unknown`.
  - `recent_stambyte`: `yes`, `no`, `unknown`.

When canonical parsing fails, the server tries to adapt the payload as normalized analysis data. See the next subsection for that path.

### Normalized RoomAnalysisV2 variant
- The adapter catches payloads whose `analysis` field contains `size_estimate`, `surfaces`, or `condition_signals` (`src/server.ts:113-117`) and converts them into the canonical shape.
- The expected normalized shape is defined in `apps/price-engine-service/src/server.ts:409-526`: `analysis` must specify `room_type`, `room_type_confidence`, `analysis_confidence`, a `size_estimate` (with low/mid/high floor areas, a bucket `"xs" | "s" | "m" | "l" | "xl"`, confidence, `basis`, and Swedish `notes_sv`), `detected_fixtures` (including `washing_machine_present`), `surfaces`, `condition_signals`, plus `observations` and `warnings` arrays.
- Normalized analysis allowances are surfaced in `/api/analyze` (returns the same shape as `NormalizedResponse` in `src/server.ts:528-567`).

### Adapter behavior summary
- `mapSizeToBucket` turns the normalized mid-area into the canonical bucket (`under_4_sqm`, `between_4_and_7_sqm`, `over_7_sqm`). Missing mid values default to `between_4_and_7_sqm` (`src/server.ts:119-126`).
- `analysis_confidence` is clamped to `[0,1]` with a 0.6 fallback (`src/server.ts:170-208`); `bathroom_size_confidence` is clamped with a 0.5 fallback (`src/server.ts:177-179`).
- Detected fixtures, layout flags, and ceiling slope/visibility flags are derived from normalized data (e.g., `wet_room_layout` is true when `room_type` is bathroom or `wc`, `tight_space` fires when the normalized mid area is below 4 m², `sloped_ceiling_detected` checks `surfaces.ceiling_type` or `outcome.ceiling_type` for strings starting with `"sloped"`).
- `condition_signals.overall_condition` interprets moisture or visible damage before falling back to wear-based heuristics (`src/server.ts:128-207`).
- `image_quality.sufficient_for_estimate` is true when the clamped confidence >= 0.5; `issues` stays empty.
- Overrides gain a canonical bucket/source even if the caller did not supply them: `buildCanonicalOverrides` keeps any user-supplied values but ensures `bathroom_size_final` and `bathroom_size_source` exist (`src/server.ts:138-149`).
- The adapter always adds `shower_niches` when `outcome` is present and leaves `analysis` as the canonical structure before re-validating the payload (`src/server.ts:159-215`). When the adapter succeeds the log records `adapter_used=true` (`src/server.ts:223-250`).

### Request examples
**Canonical example (minimal valid payload)**
```json
{
  "analysis": {
    "room_type": "bathroom",
    "bathroom_size_estimate": "between_4_and_7_sqm",
    "bathroom_size_confidence": 0.72,
    "detected_fixtures": {"shower_present": true, "bathtub_present": false, "toilet_present": true, "sink_present": true},
    "layout_features": {"shower_zone_visible": true, "wet_room_layout": false, "tight_space": false, "irregular_geometry": false},
    "ceiling_features": {"ceiling_visible": true, "sloped_ceiling_detected": false},
    "condition_signals": {"overall_condition": "average"},
    "image_quality": {"sufficient_for_estimate": true, "issues": []},
    "analysis_confidence": 0.81
  },
  "overrides": {"bathroom_size_final": "between_4_and_7_sqm", "bathroom_size_source": "ai_estimated"},
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

**Normalized RoomAnalysisV2 example (adapter path)**
```json
{
  "analysis": {
    "room_type": "bathroom",
    "room_type_confidence": 0.86,
    "analysis_confidence": 0.68,
    "size_estimate": {
      "floor_area_m2": {"low": 4.0, "mid": 5.0, "high": 6.0},
      "size_bucket": "m",
      "confidence": 0.62,
      "basis": ["shower_zone", "doorframe"],
      "notes_sv": "Kameran visar duschzon och vägg för rimlig uppskattning."
    },
    "detected_fixtures": {"shower_present": true, "bathtub_present": false, "toilet_present": true, "sink_present": true, "washing_machine_present": false},
    "surfaces": {"floor_finish": "tile", "wall_finish": "painted", "ceiling_type": "flat"},
    "condition_signals": {"visible_damage": false, "moisture_signs": false, "surface_wear": "medium"},
    "observations": [],
    "warnings": ["Möjlig fuktskada i nedre kanten"]
  },
  "outcome": {
    "shower_type": "shower_cabin",
    "bathtub": "no",
    "toilet_type": "floor_standing",
    "vanity_type": "simple_sink",
    "wall_finish": "tiles_wet_zone_only",
    "floor_finish": "large_format_tiles",
    "ceiling_type": "moisture_resistant_panels",
    "layout_change": "yes",
    "shower_niches": "one"
  }
}
```

### Response contract
Every success returns `{ id, estimate, metadata, record }` (see `apps/price-engine-service/src/server.ts:252-266`).
- `id` is a UUID or timestamp-based fallback from `createResultId()` (`server.ts:218-221`).
- `estimate` is the result of `buildFrontendEstimate` (`packages/price-engine/src/contract.ts:535-574`) and includes:
- `line_items[]`: each entry mirrors rate-card tasks with `key`, `trade_group`, `qty`, `unit`, `labor_sek`, `material_sek`, `subtotal_sek`, `rot_eligible`, and optional `note` for floor/wall finish details (`contract.ts:575-606`).
- `/site_conditions` driven allowances: `site_conditions_access_labor_hours` (ROT-eligible), `site_conditions_waste_logistics_hours` (ROT-eligible), and `site_conditions_admin_hours` (non-ROT) now appear under `trade_group: site_conditions` when `site_conditions` is supplied. Their hourly labor rate comes from `packages/price-engine/estimator/ratecard.placeholder.yaml` and the tasks are defined in `catalog/bathroom_catalog.yaml`, so the line items pass through the normal estimator pipeline.
- `totals`: base subtotal + project management (from `rateCard.overhead.project_management_pct`) + contingency (8% by default).
  - `trade_group_totals`, `flags`, `info_flags` (outlier metadata), `assumptions`, `warnings`, `needs_confirmation_ids`, `derived_areas` (`non_tiled_wall_area_m2`), `plausibility_band`, and `sek_per_m2` (all coming from the estimator pipeline, see `packages/price-engine/src/contract.ts:411-574`).
  - `estimate_quality` / `estimate_range` / `labor_range` / `material_range` mirror the ranges computed in `runEstimateFromNormalized`, so the UI has low/mid/high totals plus labor/material swings without recomputing (`contract.ts:426-516`).
  - `confidence_tier` / `confidence_reasons` distill estimate quality, AI/image confidence, blocking needs, and warnings into a single server-side “truth” (`contract.ts:520-614`).
- `rot_summary` reports ROT-eligible labor sums and the deduction (with an optional cap trace) while leaving the estimator totals untouched (`contract.ts:575-614`).
- There is no explicit confidence range or probability envelope—the response relies on `sek_per_m2`, `plausibility_band`, and `warnings` instead (“not returned today”).
### Site conditions allowances
When the client sends `site_conditions`, the estimator converts the inputs into three hourly allowance tasks (`site_conditions_access_labor_hours`, `site_conditions_waste_logistics_hours`, `site_conditions_admin_hours`). The tasks live in `catalog/bathroom_catalog.yaml` under `trade_group: site_conditions` and re-use the hourly labor rates defined in `packages/price-engine/estimator/ratecard.placeholder.yaml`, so their labor/material/subtotal flow through the usual task/rate-card pipeline. Hours are rounded to 0.5-hour steps and the response includes `estimate.site_conditions_effect` summarizing the added labor/material/total SEK plus the `reason_codes` shown below.

- **Access allowances (access labor hours)**
  - `floor_elevator`: `apt_elevator` (+0.5h, `FLOOR_ELEVATOR`), `apt_no_elevator_1_2` (+1.5h, `FLOOR_NO_ELEVATOR_1_2`), `apt_no_elevator_3_plus` (+3h, `FLOOR_NO_ELEVATOR_3_PLUS`)
  - `parking_loading`: `limited` (+0.5h, `PARKING_LIMITED`), `none` (+1.5h, `PARKING_NONE`)
  - `work_time_restrictions`: `strict` (+1.5h, `WORKTIME_STRICT`)
  - `water_shutoff_accessible`: `no` (+0.5h, `WATER_SHUTOFF_NO`)
  - `electrical_panel_accessible`: `no` (+0.5h, `ELECTRICAL_PANEL_NO`)
  - `access_constraints_notes`: adds the `ACCESS_NOTES` code even though no hours are attached.

 - **Waste/logistics allowances (waste logistics hours)**
   - `carry_distance`: `20_50m` (+1h, `CARRY_20_50M`), `50_100m` (+2h, `CARRY_50_100M`), `over_100m` (+3.5h, `CARRY_OVER_100M`)
   - `occupancy`: `living_in_partly` (+1h, `OCCUPANCY_PARTLY`), `living_in_full` (+2.5h, `OCCUPANCY_FULL`)
   - `container_possible`: `no` (+2h, `NO_CONTAINER`)
   - `must_keep_facility_running`: `yes` (+3h, `KEEP_RUNNING_YES`)
   - `protection_level`: `extra` (+1.5h, `PROTECTION_EXTRA`)

   Waste hours accumulate each matching bullet, so multiple answers stack (e.g., `container_possible=no` plus `must_keep_facility_running=yes` adds 5h total).

- **Admin/documentation allowances (admin hours)**
  - `permits_brf`: `brf_required` (+2h, `BRF_REQUIRED`), `permit_required` (+4h, `PERMIT_REQUIRED`)
  - `hazardous_material_risk`: `suspected` (+3h, `HAZARD_SUSPECTED`), `confirmed` (+8h, `HAZARD_CONFIRMED`)
  - `build_year_bucket`: `pre_1960` (+2h, `BUILD_PRE_1960`), `1960_1979` (+1h, `BUILD_1960_1979`)

Only the fields above change hours today; other enums (e.g., `build_year_bucket` values after 1999, `wetroom_certificate_required`, `recent_stambyte`) do not add extra hours. Reason codes flow through `site_conditions_effect.reason_codes` so the UI can explain which answers drove the allowance.
  - `site_conditions_effect` (present only when allowances are added) summarizes the labor/material/total SEK pulled from the three site condition tasks and echoes the `reason_codes` that explain why the allowances fired (`contract.ts:676-740`). Expected codes follow the table below, and `ACCESS_NOTES` is added whenever `access_constraints_notes` is provided even though it does not add hours.
- `metadata` includes the normalized contract that was processed plus `overrides`, `text`, and `fileCount` placeholders (always `text = ""`, `fileCount = 0`).
- `record` is currently always `null`.

**Representative example response** (values are consistent with the canonical schema but simplified for readability):
  ```json
  {
  "id": "estimate-2024-09-01-abc123",
  "estimate": {
    "line_items": [
      {
        "key": "demolish_remove_floor_tiles",
        "trade_group": "demolition",
        "qty": 4,
        "unit": "m2",
        "labor_sek": 2600,
        "material_sek": 0,
        "subtotal_sek": 2600,
        "rot_eligible": true
      },
      {
        "key": "install_floor_tiles_or_vinyl",
        "trade_group": "tiling_or_vinyl",
        "qty": 4,
        "unit": "m2",
        "labor_sek": 2800,
        "material_sek": 1120,
        "subtotal_sek": 3920,
        "note": "ceramic_tile_standard",
        "rot_eligible": true
      },
      {
        "key": "install_toilet",
        "trade_group": "plumbing",
        "qty": 1,
        "unit": "pcs",
        "labor_sek": 1500,
        "material_sek": 6400,
        "subtotal_sek": 7900,
        "rot_eligible": true
      }
    ],
    "totals": {
      "base_subtotal_sek": 143387.87,
      "project_management_sek": 0,
      "contingency_sek": 11471.03,
      "grand_total_sek": 154858.90
    },
    "trade_group_totals": [
      {"trade_group": "demolition", "subtotal_sek": 15953.57},
      {"trade_group": "tiling_or_vinyl", "subtotal_sek": 33732.48}
    ],
    "flags": ["requires_demolition", "requires_waterproofing", "requires_plumber", "requires_painter"],
    "info_flags": ["PLAUSIBILITY_BAND_PB_003"],
    "assumptions": [],
    "warnings": [
      "Total per m² is 44245 SEK/m² which is outside 8,000–30,000 guideline.",
      "Plausibility band: PB-003",
      "Total with contingency: 154859 SEK"
    ],
    "needs_confirmation_ids": [],
    "derived_areas": {"non_tiled_wall_area_m2": 0},
    "plausibility_band": "PB-003",
    "sek_per_m2": 44245.40,
    "estimate_quality": "confirmed",
    "estimate_range": {
      "low_sek": 140000,
      "mid_sek": 155000,
      "high_sek": 170000
    },
    "labor_range": {
      "min_sek": 55000,
      "max_sek": 65000
    },
    "material_range": {
      "min_sek": 45000,
      "max_sek": 52000
    },
    "confidence_tier": "high",
    "confidence_reasons": ["has_warnings_outliers"],
    "rot_summary": {
      "rot_rate": 0.3,
      "rot_eligible_labor_sek": 62000,
      "rot_deduction_sek": 18600,
      "total_after_rot_sek": 131400,
      "rot_cap_applied": false,
      "rot_cap_reason": "unknown_user_tax_limit"
    }
  },
  "metadata": {
    "contract": "<canonical contract payload omitted>",
    "overrides": {"bathroom_size_final": "between_4_and_7_sqm", "bathroom_size_source": "ai_estimated"},
    "text": "",
    "fileCount": 0
  },
  "record": null
}
```

The `estimate` payload now guarantees:
- `estimate_range` (low/mid/high totals) plus the labor/material swings computed in `runEstimateFromNormalized`.
- `confidence_tier`/`confidence_reasons` where the base tier follows `estimate_quality` and downgrades once per signal (low analysis confidence, insufficient image quality, blocking NC codes, or warnings/outliers).
- `rot_summary` including `rot_eligible_labor_sek`, `rot_deduction_sek` (Math.round), and `total_after_rot_sek = max(0, grand_total_sek - rot_deduction_sek)`, so the UI can highlight ROT savings without touching the estimator math.
- `line_items[].rot_eligible` flags each catalog entry so that the ROT deduction only counts eligible labor; missing flags default to `false`.

The real response includes many more `line_items` (see the sample run output in the repository), but the structure above reflects the keys and totals that always appear.

---

## Line item catalog
The estimator builds `line_items` from `catalog/bathroom_catalog.yaml` (`tasks` entries) plus the dynamic allowances in `packages/price-engine/estimator/estimator.ts:320-520`. Units come from `packages/price-engine/estimator/ratecard.placeholder.yaml:1-94`. The machine-readable version of this catalog is `docs/line_item_catalog.json`, and it can be rebuilt with `TSX_DISABLE_DAEMON=1 npx tsx scripts/generate-price-engine-catalogs.ts`.

| Key | Trade Group | Unit | Quantity derivation (code reference) |
| --- | --- | --- | --- |
| `demolish_remove_floor_tiles` | demolition | m² | Uses `areaWithWasteFloor` (`applyMinWaste(floor_area_m2, 1.1, 4)`, `estimator.ts:449-589`). |
| `demolish_remove_wall_tiles` | demolition | m² | Uses `areaWithWasteWalls` (`applyMinWaste(wet_zone_wall_area_m2, 1.1, 2)`, `estimator.ts:449-593`). |
| `demolish_remove_old_fixtures` | demolition | pcs | `computeFixtureRemovalQty` counts replacements or existing fixtures when surfaces change (`estimator.ts:605-612`, `770-784`). |
| `demolish_chase_for_pipes` | demolition | pcs | Always 1 when layout change or `pipe_reroute` is true (`estimator.ts:468-472`, `651-653`). |
| `layout_change_area_allowance` | demolition | m² | `Math.max(1, round(floor_area_m2))` when `change_layout` intent is true (`estimator.ts:660`). |
| `layout_change_wet_zone_allowance` | carpentry_substrate | m² | `Math.max(1, round((wet_zone_wall_area_m2 || 0) * 0.5))` under layout change (`estimator.ts:661`). |

| `install_wall_backer_boards` | carpentry_substrate | m² | `applyMin(wall_area_m2, 5)` whenever tiling is in scope (`estimator.ts:665-667`). |
| `repair_patch_walls` | carpentry_substrate | m² | Same `applyMin(wall_area_m2, 5)` and scoped by substrate flag (`estimator.ts:665-670`). |
| `level_floor_screed` | carpentry_substrate | m² | `applyMinWaste(floor_area_m2, 1.0, 4)` (`estimator.ts:668-669`). |
| `construct_support_structures` | carpentry_substrate | pcs | Always 1 when substrate prep is required (`estimator.ts:652-654`). |
| `substrate_layout_change_allowance` | carpentry_substrate | item | Added when `change_layout` intent is true (`estimator.ts:654-664`). |
| `shower_niche_allowance` | carpentry_substrate | item | 1 or 2 niches when replacing the shower; count based on `selections.shower_niches` (`estimator.ts:389-417`). |

| `apply_waterproof_membrane_floor` | waterproofing | m² | Floor area + waste as above (`estimator.ts:585-589`). |
| `apply_waterproof_membrane_walls` | waterproofing | m² | Wet-zone area + waste (`estimator.ts:590-593`); skipped for vinyl/painted wall finishes. |
| `waterproofing_detailing_corners` | waterproofing | pcs | No special case in `computeQuantity`, so qty stays 0 today (falls through to the default case, `estimator.ts:670-673`). |

| `install_floor_tiles_or_vinyl` | tiling_or_vinyl | m² | `areaWithWasteFloor` minus vinyl short-circuits; skips when `floor_finish === "keep"` or `"microcement"` (`estimator.ts:433-471`, `585-589`). |
| `install_floor_microcement` | tiling_or_vinyl | m² | Same area-with-waste but only when `floor_finish === "microcement"` (`estimator.ts:468-469`). |
| `install_wall_tiles` | tiling_or_vinyl | m² | Uses `areaWithWasteWalls`, skipped for vinyl/painted finishes (`estimator.ts:457-466`, `590-593`). |
| `grout_and_seal` | tiling_or_vinyl | m² | Adds combined floor/wet-wall area at 5% waste (`estimator.ts:594-600`). |
| `install_shower_screen` | tiling_or_vinyl | pcs | `Math.max(1, fixtures.shower)` when `replace_shower` intent is true (`estimator.ts:602-603`). |

| `rough_in_new_piping` | plumbing | pts | `Math.max(4, toilet + sink + shower + bathtub)` (`estimator.ts:614-615`). |
| `replace_floor_drain` | plumbing | pcs | Always 1 when plumbing scope is active (`estimator.ts:612-613`). |
| `install_toilet` | plumbing | pcs | Fixtures count when `replace_toilet` is true (`estimator.ts:606-607`). |
| `install_sink_and_faucet` | plumbing | pcs | Fixtures count when `replace_sink_vanity` is true (`estimator.ts:608-609`). |
| `install_shower_fixture` | plumbing | pcs | Fixtures count when `replace_shower` is true (`estimator.ts:610-611`). |
| `pressure_test_plumbing` | plumbing | pcs | Always 1 if lighting or underfloor heating intents are set (`estimator.ts:626-629`). |
| `demolition_layout_change_allowance` | demolition | item | 1 when `change_layout` intent is true (`estimator.ts:654-665`). |
| `plumbing_layout_change_reroute_allowance` | plumbing | item | 1 for layout changes (`estimator.ts:654-665`). |
| `layout_change_fixture_allowance` | plumbing | item | `Math.max(1, number of replaced fixtures)` when `change_layout` is true (`estimator.ts:663-664`). |
| `toilet_wall_hung_allowance` | plumbing | item | Triggered when `replace_toilet` and `toilet_type === "wall_hung"`, adds a fixed allowance (`estimator.ts:322-341`). |

| `install_floor_heating_cable` | electrical | m² | `areaWithWasteFloor` when `intents.add_underfloor_heating` is true and `areaWithWasteFloor` is defined (`estimator.ts:616-621`). **Note:** `add_underfloor_heating` now toggles when `outcome.floor_heating === "floor_heating_on"`, so sending that value allows this task (and the linked electrical safety tasks) to run (`packages/price-engine/estimator/outcomeMapper.ts:81-114`, `estimator.ts:616-628`). |
| `install_light_fixtures` | electrical | pts | Always 4 when `update_lighting` intent is true (`estimator.ts:622-623`). |
| `install_electrical_outlets` | electrical | pts | Always 2 when `update_lighting` intent is true (`estimator.ts:624-625`). |
| `upgrade_electrical_safety` | electrical | pcs | 1 when lighting or underfloor heating intents exist (`estimator.ts:626-628`). |
| `final_electrical_inspection` | electrical | pcs | Same condition as above (`estimator.ts:626-628`). |

| `install_exhaust_fan` | ventilation | pcs | 1 when `improve_ventilation` intent is true (`estimator.ts:629-631`). |
| `duct_adjustment_sealing` | ventilation | pcs | Same as above (`estimator.ts:629-631`). |

| `prep_and_paint_ceiling` | painting | m² | `applyMin(ceiling_area_m2, 5)` when `paint_ceiling` intent is true (`estimator.ts:632-634`). |
| `paint_trim_and_door` | painting | pcs | Always 1 (`estimator.ts:634-636`). |
| `finish_wall_paint` | painting | m² | Uses wall area (if `wall_finish === "painted_walls"`) or `nonTiledWallArea` (computed at `estimator.ts:695-699`) and skips if wall finish is kept. |
| `ceiling_sloped_allowance` | painting | item | Added when painting a sloped ceiling (`estimator.ts:372-387`). |

| `protect_other_areas` | cleanup_waste | pcs | Always 1 whenever cleanup is required (`estimator.ts:641-645`). |
| `remove_construction_debris` | cleanup_waste | pcs | Always 1 (`estimator.ts:641-645`). |
| `construction_waste_disposal` | cleanup_waste | pcs | Always 1 (`estimator.ts:641-645`). |
| `final_cleanup` | cleanup_waste | pcs | Always 1 (`estimator.ts:641-645`). |

| `project_coordination_fee` | project_management_docs | project | Added only when `rateCard.overhead.project_management_pct === 0`; currently skipped because the percentage is 7% (`estimator.ts:471-474`). |
| `permit_or_board_application` | project_management_docs | project | 1 when layout change or BRF documentation is needed (`estimator.ts:470-471`). |
| `issue_wetroom_certificate` | project_management_docs | project | 1 when waterproofing is in scope (`estimator.ts:471-473`). |
| `handover_inspection` | project_management_docs | project | Always 1 (`estimator.ts:646-650`). |
| `documentation_layout_change_allowance` | project_management_docs | item | 1 when layout change is requested (`estimator.ts:654-665`). |

| `ceiling_panels_allowance` | carpentry_substrate | item | Added when painting includes panels (`estimator.ts:343-370`). |

> The machine-readable catalog is `docs/line_item_catalog.json` (generated by `scripts/generate-price-engine-catalogs.ts`).

---

## Option enums that affect pricing
The estimator only accepts the enum values defined in `src/shared/canonicalEstimatorContract.ts`. Labels live beside the values for UI reuse, but the API transmits the `value` keys only (no localized strings). The JSON catalog `docs/option_enums_catalog.json` mirrors these groups and can be generated with the same script mentioned above.

| Category | Allowed values (snake_case) | Source label (if any) | Notes |
| --- | --- | --- | --- |
| `bathroom_size_final` | `under_4_sqm`, `between_4_and_7_sqm`, `over_7_sqm` | Labels stored at `src/shared/canonicalEstimatorContract.ts:129-133` | Used in `overrides` to force a bucket regardless of analysis. |
| `shower_type` | `walk_in_shower_glass`, `shower_cabin`, `no_shower`, `keep` | `showerTypeOptions` labels (`src/shared/canonicalEstimatorContract.ts:145-150`). |
| `bathtub` | `yes`, `no`, `keep` | Labels in `bathtubOptions` (`src/shared/canonicalEstimatorContract.ts:152-156`). |
| `toilet_type` | `wall_hung`, `floor_standing`, `keep` | `toiletTypeOptions` (`src/shared/canonicalEstimatorContract.ts:158-162`). |
| `vanity_type` | `vanity_with_cabinet`, `simple_sink`, `no_sink`, `keep` | `vanityTypeOptions` (`src/shared/canonicalEstimatorContract.ts:164-169`). |
| `wall_finish` | `tiles_all_walls`, `large_format_tiles_all_walls`, `tiles_wet_zone_only`, `painted_walls_only`, `keep` | `wallFinishOptions` (`src/shared/canonicalEstimatorContract.ts:171-177`). |
| `floor_finish` | `standard_ceramic_tiles`, `large_format_tiles`, `vinyl_wet_room_mat`, `microcement_seamless`, `keep` | `floorFinishOptions` (`src/shared/canonicalEstimatorContract.ts:179-185`). |
| `ceiling_type` | `painted_ceiling`, `moisture_resistant_panels`, `sloped_painted`, `sloped_with_panels`, `keep` | `ceilingTypeOptions` (`src/shared/canonicalEstimatorContract.ts:187-193`). |
| `layout_change` | `yes`, `no` | `layoutChangeOptions` (`src/shared/canonicalEstimatorContract.ts:195-198`). |
| `shower_niches` | `none`, `one`, `two_or_more` | `showerNichesOptions` (`src/shared/canonicalEstimatorContract.ts:200-204`). |

The API never returns the labels—it only echoes the raw values above. The labels are kept in TypeScript for client convenience (mixed English/Swedish). If new enums are added, extend both the schema (`canonicalEstimatorContractSchema.ts`) and the exported option arrays.

---

## CORS / Origins
All `/api` routes share the same middleware defined at `apps/price-engine-service/src/server.ts:17-58`. Origins must match one of:
- `localhost`/`127.0.0.1` (any port).
- Any `lovableproject.com` subdomain or `lovable.app` domain.
- Google User Content hosts (`usercontent.goog` or `googleusercontent.com`).

Allowed origins receive `Access-Control-Allow-Origin`, `Vary`, `Access-Control-Allow-Methods: POST, OPTIONS`, and `Access-Control-Allow-Headers: content-type`. Disallowed origins are logged (see the `console.warn` call) but the middleware still calls `next()` without setting CORS headers (`src/server.ts:43-55`).

---

## Summary
### What the API can do today
- Expose `/api/estimate`, `/api/upload`, `/api/analyze`, and `/api/health` with JSON/multipart bodies and conservative CORS allowing Lovable hosts, Google usercontent, and localhost. (`apps/price-engine-service/src/server.ts`)
- Accept canonical estimator contracts or normalized RoomAnalysisV2 payloads; normalize, clamp confidences, and derive overrides/notes before running the estimator. (`src/server.ts:113-215`)
- Build pricing line items from `catalog/bathroom_catalog.yaml` plus the dynamic allowances, feeding them through the rate card and `computeQuantity`. (`packages/price-engine/estimator/estimator.ts` & `catalog/bathroom_catalog.yaml`)
- Let clients toggle underfloor heating through the new `outcome.floor_heating` enum (`floor_heating_on`, `floor_heating_off`, `keep`); sending `floor_heating_on` makes `intents.add_underfloor_heating` true so the electrical cable/outlet/safety tasks run (`packages/price-engine/estimator/outcomeMapper.ts:81-114`, `estimator.ts:616-628`).
- Surface the full `estimate` object with line items, totals, trade-group sums, flags, warnings, derived areas, and metadata so clients can render the quote. (`packages/price-engine/src/contract.ts:411-574`)
- Store documentation-ready catalogs under `docs/line_item_catalog.json` and `docs/option_enums_catalog.json` (generated via `scripts/generate-price-engine-catalogs.ts`).

### What the API cannot do today (not implemented or not exposed)
- The adapter only understands normalized requests containing `analysis.size_estimate`, `analysis.surfaces`, or `analysis.condition_signals`; if other normalized signals arrive the server rejects the payload (`apps/price-engine-service/src/server.ts:113-215`).
- `project_coordination_fee` is skipped in the current rate card because `project_management_pct` is non-zero; to emit that line item the overhead percentage must drop to 0. (`estimator.ts:471-474`).
- `waterproofing_detailing_corners` never fires because no `computeQuantity` case exists for `qty_driver` `penetrations_and_corners`; it always defaults to 0 today. (`estimator.ts:670-673`).

---
