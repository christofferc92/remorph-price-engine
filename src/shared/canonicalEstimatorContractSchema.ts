import { z } from "zod";

const sizeBucketSchema = z.enum(["under_4_sqm", "between_4_and_7_sqm", "over_7_sqm"]);
const roomTypeSchema = z.enum(["bathroom", "other"]);

const conditionSignalSchema = z.enum(["good", "average", "poor", "unknown"]);
const imageQualityIssueSchema = z.enum(["low_light", "blurry", "incomplete_room_coverage", "obstructed_views"]);

const detectedFixturesSchema = z
  .object({
    shower_present: z.boolean(),
    bathtub_present: z.boolean(),
    toilet_present: z.boolean(),
    sink_present: z.boolean(),
  })
  .strict();

const layoutFeaturesSchema = z
  .object({
    shower_zone_visible: z.boolean(),
    wet_room_layout: z.boolean(),
    tight_space: z.boolean(),
    irregular_geometry: z.boolean(),
  })
  .strict();

const ceilingFeaturesSchema = z
  .object({
    ceiling_visible: z.boolean(),
    sloped_ceiling_detected: z.boolean(),
  })
  .strict();

const conditionSignalsSchema = z
  .object({
    overall_condition: conditionSignalSchema,
  })
  .strict();

const imageQualitySchema = z
  .object({
    sufficient_for_estimate: z.boolean(),
    issues: z.array(imageQualityIssueSchema),
  })
  .strict();

export const analysisContractSchema = z
  .object({
    room_type: roomTypeSchema,
    bathroom_size_estimate: sizeBucketSchema,
    bathroom_size_confidence: z.number().min(0).max(1),
    detected_fixtures: detectedFixturesSchema,
    layout_features: layoutFeaturesSchema,
    ceiling_features: ceilingFeaturesSchema,
    condition_signals: conditionSignalsSchema,
    image_quality: imageQualitySchema,
    analysis_confidence: z.number().min(0).max(1),
  })
  .strict();

const wetZoneTypeSchema = z.enum(["shower_only", "corner_2_walls", "three_walls", "full_wet_room"]);

const measurementOverrideSchema = z
  .object({
    length: z.number().min(0).optional(),
    width: z.number().min(0).optional(),
    area: z.number().min(0).optional(),
    ceilingHeight: z.number().min(0).optional(),
    wetZone: wetZoneTypeSchema.optional(),
  })
  .strict();

const roomMeasurementsSchema = z
  .object({
    floor_area_m2: z.number().nullable(),
    wall_area_m2: z.number().nullable(),
    ceiling_area_m2: z.number().nullable(),
    wet_zone_wall_area_m2: z.number().nullable(),
  })
  .strict();

export const userOverrideContractSchema = z
  .object({
    bathroom_size_final: sizeBucketSchema,
    bathroom_size_source: z.enum(["ai_estimated", "user_overridden"]),
  })
  .strict();

const floorHeatingSchema = z.enum(["floor_heating_on", "floor_heating_off", "keep"]);

export const userOutcomeContractSchema = z
  .object({
    shower_type: z.enum(["walk_in_shower_glass", "shower_cabin", "no_shower", "keep"]),
    bathtub: z.enum(["yes", "no", "keep"]),
    toilet_type: z.enum(["wall_hung", "floor_standing", "keep"]),
    vanity_type: z.enum(["vanity_with_cabinet", "simple_sink", "no_sink", "keep"]),
    wall_finish: z.enum([
      "tiles_all_walls",
      "large_format_tiles_all_walls",
      "tiles_wet_zone_only",
      "painted_walls_only",
      "keep",
    ]),
    floor_finish: z.enum([
      "standard_ceramic_tiles",
      "large_format_tiles",
      "vinyl_wet_room_mat",
      "microcement_seamless",
      "keep",
    ]),
    ceiling_type: z.enum([
      "painted_ceiling",
      "moisture_resistant_panels",
      "sloped_painted",
      "sloped_with_panels",
      "keep",
    ]),
    layout_change: z.enum(["yes", "no"]),
    shower_niches: z.enum(["none", "one", "two_or_more"]),
    floor_heating: floorHeatingSchema.optional(),
  })
  .strict();

const siteConditionsSchema = z
  .object({
    floor_elevator: z
      .enum([
        "house_or_ground",
        "apt_elevator",
        "apt_no_elevator_1_2",
        "apt_no_elevator_3_plus",
        "unknown",
      ])
      .optional(),
    carry_distance: z
      .enum(["under_20m", "20_50m", "50_100m", "over_100m", "unknown"])
      .optional(),
    parking_loading: z.enum(["easy_nearby", "limited", "none", "unknown"]).optional(),
    work_time_restrictions: z
      .enum(["none", "standard_daytime", "strict", "unknown"])
      .optional(),
    access_constraints_notes: z.string().max(280).optional(),
    permits_brf: z.enum(["none", "brf_required", "permit_required", "unknown"]).optional(),
    wetroom_certificate_required: z
      .enum(["required", "preferred", "not_needed", "unknown"])
      .optional(),
    build_year_bucket: z
      .enum(["pre_1960", "1960_1979", "1980_1999", "2000_plus", "unknown"])
      .optional(),
    last_renovated: z.enum(["under_5y", "5_15y", "over_15y", "unknown"]).optional(),
    hazardous_material_risk: z
      .enum(["none_known", "suspected", "confirmed", "unknown"])
      .optional(),
    occupancy: z
      .enum(["not_living_in", "living_in_full", "living_in_partly", "unknown"])
      .optional(),
    must_keep_facility_running: z.enum(["yes", "no", "unknown"]).optional(),
    container_possible: z.enum(["yes", "no", "unknown"]).optional(),
    protection_level: z.enum(["normal", "extra", "unknown"]).optional(),
    water_shutoff_accessible: z.enum(["yes", "no", "unknown"]).optional(),
    electrical_panel_accessible: z.enum(["yes", "no", "unknown"]).optional(),
    recent_stambyte: z.enum(["yes", "no", "unknown"]).optional(),
  })
  .strict();

export const canonicalEstimatorContractSchema = z
  .object({
    analysis: analysisContractSchema,
    overrides: userOverrideContractSchema,
    outcome: userOutcomeContractSchema,
    measurementOverride: measurementOverrideSchema.optional(),
    roomMeasurements: roomMeasurementsSchema.optional(),
    site_conditions: siteConditionsSchema.optional(),
  })
  .strict();

export type AnalysisContractSchema = typeof analysisContractSchema;
export type UserOverrideContractSchema = typeof userOverrideContractSchema;
export type UserOutcomeContractSchema = typeof userOutcomeContractSchema;
export type CanonicalEstimatorContractSchema = typeof canonicalEstimatorContractSchema;
