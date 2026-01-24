import { mapOutcomeToEstimatorInputs } from "../estimator/outcomeMapper.ts";
import type { IntentMap } from "../estimator/scopeCompiler.ts";
import type {
  AnalysisResult,
  EstimateResponse,
  Selection,
  SiteConditionsAllowanceSummary,
} from "../estimator/estimator.ts";
import { estimate } from "../estimator/estimator.ts";
import { bucketToArea, WET_ZONE_FRACTIONS } from "../../../src/shared/canonicalEstimatorContract.ts";
import type {
  CanonicalEstimatorContract,
  SiteConditions,
  SizeBucket,
} from "../../../src/shared/canonicalEstimatorContract.ts";

const DEFAULT_CEILING_HEIGHT = 2.4;

export type SweepProfile = "refresh" | "full_rebuild" | "major";

type MeasurementKey = "floor_area_m2" | "wall_area_m2" | "ceiling_area_m2" | "wet_zone_wall_area_m2";

export type RangeSignals = {
  measurement_confirmed: boolean;
  room_measurement_ratio: number;
  site_conditions_ratio: number;
  needs_confirmation_ids: string[];
};

type RangeResult = {
  low: number;
  mid: number;
  high: number;
  applied_pct: number;
  reason_codes: string[];
};

const TRADE_GROUP_UNCERTAINTY_PCT: Record<string, number> = {
  demolition: 0.09,
  carpentry_substrate: 0.08,
  waterproofing: 0.07,
  tiling_or_vinyl: 0.06,
  plumbing: 0.08,
  electrical: 0.07,
  ventilation: 0.06,
  painting: 0.05,
  cleanup_waste: 0.05,
  project_management_docs: 0.04,
  site_conditions: 0.03,
};

const DEFAULT_UNCERTAINTY_PCT = 0.08;
const MIN_RANGE_PCT = 0.03;
const MAX_RANGE_PCT = 0.25;
const MIN_RANGE_SEK = 2000;

export function bucketFromFloorArea(area: number | null | undefined): SizeBucket {
  if (typeof area === "number" && !Number.isNaN(area)) {
    if (area < 4) return "under_4_sqm";
    if (area <= 7) return "between_4_and_7_sqm";
    return "over_7_sqm";
  }
  return "between_4_and_7_sqm";
}

const SIZE_BUCKET_MAP: Record<"small" | "medium" | "large", SizeBucket> = {
  small: "under_4_sqm",
  medium: "between_4_and_7_sqm",
  large: "over_7_sqm",
};

const SIZE_BUCKET_CHOICE_MAP = {
  under_4m2: "under_4_sqm",
  "4_7m2": "between_4_and_7_sqm",
  over_7m2: "over_7_sqm",
} as const;
type SizeBucketChoice = keyof typeof SIZE_BUCKET_CHOICE_MAP;

function sizeBucketFromChoice(choice: unknown): SizeBucket | null {
  if (typeof choice !== "string") return null;
  return SIZE_BUCKET_CHOICE_MAP[choice as SizeBucketChoice] ?? null;
}

function resolveSizeBucket(
  area: number | null | undefined,
  choice: unknown,
  probBucket: SizeBucket | null
): SizeBucket {
  if (typeof area === "number" && Number.isFinite(area) && area > 0) {
    return bucketFromFloorArea(area);
  }
  const choiceBucket = sizeBucketFromChoice(choice);
  if (choiceBucket) return choiceBucket;
  if (probBucket) return probBucket;
  return "between_4_and_7_sqm";
}

export function computeDetectedFixtures(raw: any) {
  return {
    shower_present: typeof raw?.shower === "number" && raw.shower > 0,
    bathtub_present: typeof raw?.bathtub === "number" && raw.bathtub > 0,
    toilet_present: typeof raw?.toilet === "number" && raw.toilet > 0,
    sink_present: typeof raw?.sink === "number" && raw.sink > 0,
  };
}

function computeSiteConditionsAllowances(siteConditions?: SiteConditions): SiteConditionsAllowanceSummary | null {
  if (!siteConditions) return null;
  let access = 0;
  let waste = 0;
  let admin = 0;
  const reasons = new Set<string>();

  const add = (target: "access" | "waste" | "admin", amount: number, code: string) => {
    if (amount > 0) {
      if (target === "access") access += amount;
      if (target === "waste") waste += amount;
      if (target === "admin") admin += amount;
      reasons.add(code);
    }
  };

  switch (siteConditions.floor_elevator) {
    case "apt_elevator":
      add("access", 0.5, "FLOOR_ELEVATOR");
      break;
    case "apt_no_elevator_1_2":
      add("access", 1.5, "FLOOR_NO_ELEVATOR_1_2");
      break;
    case "apt_no_elevator_3_plus":
      add("access", 3.0, "FLOOR_NO_ELEVATOR_3_PLUS");
      break;
  }
  switch (siteConditions.carry_distance) {
    case "20_50m":
      add("waste", 1.0, "CARRY_20_50M");
      break;
    case "50_100m":
      add("waste", 2.0, "CARRY_50_100M");
      break;
    case "over_100m":
      add("waste", 3.5, "CARRY_OVER_100M");
      break;
  }
  switch (siteConditions.parking_loading) {
    case "limited":
      add("access", 0.5, "PARKING_LIMITED");
      break;
    case "none":
      add("access", 1.5, "PARKING_NONE");
      break;
  }
  if (siteConditions.work_time_restrictions === "strict") {
    add("access", 1.5, "WORKTIME_STRICT");
  }
  if (siteConditions.access_constraints_notes?.trim()) {
    reasons.add("ACCESS_NOTES");
  }
  switch (siteConditions.permits_brf) {
    case "brf_required":
      add("admin", 2.0, "BRF_REQUIRED");
      break;
    case "permit_required":
      add("admin", 4.0, "PERMIT_REQUIRED");
      break;
  }
  switch (siteConditions.hazardous_material_risk) {
    case "suspected":
      add("admin", 3.0, "HAZARD_SUSPECTED");
      break;
    case "confirmed":
      add("admin", 8.0, "HAZARD_CONFIRMED");
      break;
  }
  switch (siteConditions.build_year_bucket) {
    case "pre_1960":
      add("admin", 2.0, "BUILD_PRE_1960");
      break;
    case "1960_1979":
      add("admin", 1.0, "BUILD_1960_1979");
      break;
  }
  switch (siteConditions.occupancy) {
    case "living_in_partly":
      add("waste", 1.0, "OCCUPANCY_PARTLY");
      break;
    case "living_in_full":
      add("waste", 2.5, "OCCUPANCY_FULL");
      break;
  }
  switch (siteConditions.container_possible) {
    case "no":
      add("waste", 2.0, "NO_CONTAINER");
      break;
  }
  if (siteConditions.must_keep_facility_running === "yes") {
    add("waste", 3.0, "KEEP_RUNNING_YES");
  }
  if (siteConditions.protection_level === "extra") {
    add("waste", 1.5, "PROTECTION_EXTRA");
  }
  if (siteConditions.water_shutoff_accessible === "no") {
    add("access", 0.5, "WATER_SHUTOFF_NO");
  }
  if (siteConditions.electrical_panel_accessible === "no") {
    add("access", 0.5, "ELECTRICAL_PANEL_NO");
  }

  access = roundToStep(access, 0.5);
  waste = roundToStep(waste, 0.5);
  admin = roundToStep(admin, 0.5);

  if (access === 0 && waste === 0 && admin === 0) {
    return null;
  }
  return {
    access_hours: access,
    waste_hours: waste,
    admin_hours: admin,
    reason_codes: Array.from(reasons),
  };
}

function roundToStep(value: number, step: number) {
  if (!value || value <= 0) return 0;
  return Math.round(value / step) * step;
}

const SITE_CONDITION_KEYS: Array<keyof SiteConditions> = [
  "floor_elevator",
  "carry_distance",
  "parking_loading",
  "work_time_restrictions",
  "access_constraints_notes",
  "permits_brf",
  "wetroom_certificate_required",
  "build_year_bucket",
  "last_renovated",
  "hazardous_material_risk",
  "occupancy",
  "must_keep_facility_running",
  "container_possible",
  "protection_level",
  "water_shutoff_accessible",
  "electrical_panel_accessible",
  "recent_stambyte",
];

export function computeAnalysisContract(
  ai_raw: any,
  accepted: boolean,
  warnings: string[],
  detectedFixtures: {
    shower_present: boolean;
    bathtub_present: boolean;
    toilet_present: boolean;
    sink_present: boolean;
  }
): { contract: CanonicalEstimatorContract["analysis"]; placeholders: string[] } {
  const sizeProbInfo = analyzeSizeBucketProbs(ai_raw.size_bucket_probs);
  const sizeBucket = resolveSizeBucket(ai_raw.floor_area_m2, ai_raw.size_bucket_choice, sizeProbInfo.bucket);
  const sizeBucketConfidence = clamp01(
    typeof ai_raw.size_bucket_confidence === "number" ? ai_raw.size_bucket_confidence : sizeProbInfo.maxProb
  );
  const analysisConfidence = clamp01(ai_raw.confidence_scale);
  const overallCondition: CanonicalEstimatorContract["analysis"]["condition_signals"]["overall_condition"] =
    accepted === true && warnings.length === 0
      ? "good"
      : warnings.length > 0
      ? "average"
      : "unknown";
  const placeholders = new Set<string>();
  const addPlaceholder = (value: string) => placeholders.add(value);
  if (ai_raw.walls_fully_tiled == null) addPlaceholder("layout_features.wet_room_layout");
  addPlaceholder("layout_features.tight_space");
  addPlaceholder("layout_features.irregular_geometry");
  if (ai_raw.ceiling_visible == null) addPlaceholder("ceiling_features.ceiling_visible");
  if (ai_raw.sloped_ceiling_detected == null) addPlaceholder("ceiling_features.sloped_ceiling_detected");
  if (typeof accepted !== "boolean") addPlaceholder("image_quality.sufficient_for_estimate");

  const contract: CanonicalEstimatorContract["analysis"] = {
    room_type: (ai_raw.room_type as "bathroom" | "other") ?? "bathroom",
    bathroom_size_estimate: sizeBucket,
    bathroom_size_confidence: sizeBucketConfidence,
    detected_fixtures: detectedFixtures,
    layout_features: {
      shower_zone_visible: detectedFixtures.shower_present,
      wet_room_layout: false,
      tight_space: sizeBucket === "under_4_sqm",
      irregular_geometry: false,
    },
    ceiling_features: {
      ceiling_visible: typeof ai_raw.ceiling_visible === "boolean" ? ai_raw.ceiling_visible : false,
      sloped_ceiling_detected:
        typeof ai_raw.sloped_ceiling_detected === "boolean" ? ai_raw.sloped_ceiling_detected : false,
    },
    condition_signals: {
      overall_condition: overallCondition,
    },
    image_quality: {
      sufficient_for_estimate: typeof accepted === "boolean" ? accepted : true,
      issues: [],
    },
    analysis_confidence: analysisConfidence,
  };

  return { contract, placeholders: Array.from(placeholders) };
}

function analyzeSizeBucketProbs(probs: any) {
  if (!probs || typeof probs !== "object") return { bucket: null, maxProb: 0 };
  const entries: Array<["small" | "medium" | "large", number]> = [
    ["small", typeof probs.small === "number" ? probs.small : -1],
    ["medium", typeof probs.medium === "number" ? probs.medium : -1],
    ["large", typeof probs.large === "number" ? probs.large : -1],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const [label, value] = entries[0];
  const bucket = value >= 0 ? SIZE_BUCKET_MAP[label] : null;
  const maxProb = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  return { bucket, maxProb };
}

function deriveRoomDimensions(floorArea: number, wallArea: number, ceilingHeight: number) {
  if (floorArea <= 0 || wallArea <= 0 || ceilingHeight <= 0) {
    const guess = Math.sqrt(Math.max(floorArea, 0.1));
    return { length: guess, width: guess };
  }
  const perimeter = wallArea / ceilingHeight;
  const sumOfSides = perimeter / 2;
  if (sumOfSides <= 0) {
    const guess = Math.sqrt(floorArea);
    return { length: guess, width: guess };
  }
  const discriminant = sumOfSides * sumOfSides - 4 * floorArea;
  if (discriminant < 0) {
    const guess = Math.sqrt(floorArea);
    return { length: guess, width: guess };
  }
  const sqrtDelta = Math.sqrt(discriminant);
  const length = (sumOfSides + sqrtDelta) / 2;
  const width = (sumOfSides - sqrtDelta) / 2;
  if (length <= 0 || width <= 0) {
    const guess = Math.sqrt(floorArea);
    return { length: guess, width: guess };
  }
  return { length, width };
}

function buildRoomFromContract(contract: CanonicalEstimatorContract, imageId?: string) {
  const overrides = contract.measurementOverride;
  const aiRoom = contract.roomMeasurements;
  const baseFloorArea = aiRoom?.floor_area_m2 ?? bucketToArea(contract.overrides.bathroom_size_final);
  const baseWallArea = aiRoom?.wall_area_m2 ?? baseFloorArea * 4;
  const aiWetZone = aiRoom?.wet_zone_wall_area_m2 ?? Math.min(baseWallArea, baseWallArea * 0.85);
  const height = overrides?.ceilingHeight ?? DEFAULT_CEILING_HEIGHT;
  const overrideLength = overrides?.length;
  const overrideWidth = overrides?.width;
  const areaFromLengthWidth =
    overrideLength != null && overrideWidth != null ? overrideLength * overrideWidth : null;
  let floorArea = overrides?.area ?? areaFromLengthWidth ?? baseFloorArea;
  if (floorArea <= 0) floorArea = baseFloorArea;
  const derived = deriveRoomDimensions(floorArea, baseWallArea, height);
  const length = overrideLength ?? derived.length;
  const width = overrideWidth ?? derived.width;
  const wallArea = Math.max(2 * (length + width) * height, 0);
  const ceilingArea = Math.max(floorArea, 0);
  const wetZoneFraction =
    overrides?.wetZone != null ? WET_ZONE_FRACTIONS[overrides.wetZone] ?? 0.25 : undefined;
  let wetZoneArea =
    wetZoneFraction != null ? wallArea * wetZoneFraction : aiWetZone;
  if (wetZoneArea > wallArea) {
    wetZoneArea = wallArea;
  }
  if (wetZoneArea < 0) {
    wetZoneArea = 0;
  }
  const fixtures = contract.analysis.detected_fixtures;
  return {
    image_id: imageId,
    room_type: contract.analysis.room_type,
    confidence_room_type: contract.analysis.analysis_confidence,
    floor_area_m2: floorArea,
    wall_area_m2: wallArea,
    ceiling_area_m2: ceilingArea,
    wet_zone_wall_area_m2: wetZoneArea,
    estimated_dimensions_notes_sv: "",
    visible_fixtures: {
      toilet: fixtures.toilet_present ? 1 : 0,
      sink: fixtures.sink_present ? 1 : 0,
      shower: fixtures.shower_present ? 1 : 0,
      bathtub: fixtures.bathtub_present ? 1 : 0,
    },
    assumptions_sv: [],
    building_year: null,
  };
}

function buildRangesFromBucket(bucket: SizeBucket) {
  const area = bucketToArea(bucket);
  const buildRange = (value: number) => ({
    low: value * 0.9,
    mid: value,
    high: value * 1.1,
  });
  const floor = buildRange(area);
  const wall = buildRange(area * 4);
  const ceiling = buildRange(area);
  const wet = buildRange(Math.min(area * 4, area * 3.5));
  return {
    floor_area_m2: floor,
    wall_area_m2: wall,
    ceiling_area_m2: ceiling,
    wet_zone_wall_area_m2: wet,
  };
}

export function buildNormalizedFromContract(
  contract: CanonicalEstimatorContract,
  imageId?: string,
  mapperResult?: ReturnType<typeof mapOutcomeToEstimatorInputs>
) {
  const room = buildRoomFromContract(contract, imageId);
  let targetWetZone = room.wet_zone_wall_area_m2;
  if (["tiles_all_walls", "large_format_tiles_all_walls"].includes(contract.outcome.wall_finish)) {
    targetWetZone = room.wall_area_m2;
  }
  targetWetZone = Math.min(targetWetZone, room.wall_area_m2);
  room.wet_zone_wall_area_m2 = targetWetZone;
  const { intents, selections } = mapperResult || mapOutcomeToEstimatorInputs(contract.outcome);
  const needs = computeNeeds(room, intents, selections, []);
  const derived_areas = {
    non_tiled_wall_area_m2: computeNonTiled(room, selections),
  };
  const measurementSources: Partial<Record<MeasurementKey, "ai" | "user">> = {};
  const overrideMeasurements = contract.measurementOverride;
  if (
    overrideMeasurements?.area != null ||
    (overrideMeasurements?.length != null && overrideMeasurements?.width != null)
  ) {
    measurementSources.floor_area_m2 = "user";
  } else if (contract.roomMeasurements?.floor_area_m2 != null) {
    measurementSources.floor_area_m2 = "ai";
  }
  if (overrideMeasurements?.length != null && overrideMeasurements?.width != null) {
    measurementSources.wall_area_m2 = "user";
  } else if (contract.roomMeasurements?.wall_area_m2 != null) {
    measurementSources.wall_area_m2 = "ai";
  }
  if (overrideMeasurements?.length != null && overrideMeasurements?.width != null) {
    measurementSources.ceiling_area_m2 = "user";
  } else if (contract.roomMeasurements?.ceiling_area_m2 != null) {
    measurementSources.ceiling_area_m2 = "ai";
  }
  if (overrideMeasurements?.ceilingHeight != null) {
    measurementSources.ceiling_area_m2 = "user";
  }
  if (overrideMeasurements?.wetZone) {
    measurementSources.wet_zone_wall_area_m2 = "user";
  } else if (contract.roomMeasurements?.wet_zone_wall_area_m2 != null) {
    measurementSources.wet_zone_wall_area_m2 = "ai";
  }
  const inputs = computeInputs(
    {
      floor_area_m2: room.floor_area_m2,
      wall_area_m2: room.wall_area_m2,
      ceiling_area_m2: room.ceiling_area_m2,
      wet_zone_wall_area_m2: room.wet_zone_wall_area_m2,
    },
    contract.analysis.analysis_confidence,
    measurementSources
  );
  const analysisWithVisible = {
    ...contract.analysis,
    visible_fixtures: room.visible_fixtures,
  };
  const ranges = buildRangesFromBucket(contract.overrides.bathroom_size_final);
  const estimate_quality = computeEstimateQuality(inputs, needs);
  return {
    image_id: imageId,
    accepted: true,
    warnings: [],
    needs_confirmation_ids: needs,
    analysis: analysisWithVisible,
    overrides: contract.overrides,
    room,
    intents,
    selections,
    derived_areas,
    inputs,
    inferred_ranges: ranges,
    estimate_quality,
    timestamp: new Date().toISOString(),
  };
}

export function determineProfileFromOutcome(outcome: CanonicalEstimatorContract["outcome"]): SweepProfile {
  if (outcome.layout_change === "yes") return "major";
  const hasShowerChange = outcome.shower_type !== "no_shower" && outcome.shower_type !== "keep";
  if (hasShowerChange || outcome.bathtub === "yes") return "full_rebuild";
  return "refresh";
}

export function computeNeeds(room: any, intents: IntentMap, selections: Selection, modelNeeds: string[] = []): string[] {
  const needs = new Set<string>(modelNeeds || []);
  const wallFinishTiled = isTiledOrVinyl(selections.wall_finish);
  if (!room.floor_area_m2 || room.floor_area_m2 <= 0) needs.add("NC-001");
  const wetMissing = room.wet_zone_wall_area_m2 == null;
  if (wetMissing) needs.add("NC-002");
  else if (wallFinishTiled && room.wall_area_m2 != null && room.wet_zone_wall_area_m2 < room.wall_area_m2 - 0.5) needs.add("NC-002");
  if (intents.change_layout) needs.add("NC-003");
  if (room.building_year != null && room.building_year < 1980) needs.add("NC-004");
  if (intents.add_underfloor_heating && !intents.change_floor_finish) needs.add("NC-005");
  return Array.from(needs).sort();
}

export function computeNonTiled(room: any, selections: Selection) {
  if (!isTiledOrVinyl(selections.wall_finish)) return null;
  if (room.wall_area_m2 == null || room.wet_zone_wall_area_m2 == null) return null;
  return Math.max(0, room.wall_area_m2 - room.wet_zone_wall_area_m2);
}

function isTiledOrVinyl(finish: Selection["wall_finish"]) {
  return finish === "wetroom_vinyl" || finish === "ceramic_tile_standard" || finish === "ceramic_tile_premium";
}

export function computeInputs(
  values: Record<MeasurementKey, number | null | undefined>,
  confidenceScale: number | null | undefined,
  sources?: Partial<Record<MeasurementKey, "ai" | "user">>
) {
  const confidence = clamp01(confidenceScale, 0.5);
  const makeField = (key: MeasurementKey) => {
    const value = values[key];
    const overrideSource = sources?.[key];
    return {
      value: value != null ? value : null,
      source: overrideSource ?? (value != null ? "ai" : "default"),
      confidence,
    };
  };
  return {
    floor_area_m2: makeField("floor_area_m2"),
    wall_area_m2: makeField("wall_area_m2"),
    ceiling_area_m2: makeField("ceiling_area_m2"),
    wet_zone_wall_area_m2: makeField("wet_zone_wall_area_m2"),
  };
}

function clamp01(value: number | null | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, 0), 1);
}

function deriveRangeSignals(contract: CanonicalEstimatorContract): RangeSignals {
  const overrides = contract.measurementOverride;
  const measurementConfirmed =
    typeof overrides?.area === "number" ||
    typeof overrides?.length === "number" ||
    typeof overrides?.width === "number" ||
    typeof overrides?.ceilingHeight === "number" ||
    typeof overrides?.wetZone === "string";
  const rooms = contract.roomMeasurements;
  const measurements = [
    rooms?.floor_area_m2,
    rooms?.wall_area_m2,
    rooms?.ceiling_area_m2,
    rooms?.wet_zone_wall_area_m2,
  ];
  const completed = measurements.filter((value) => typeof value === "number" && !Number.isNaN(value)).length;
  const roomMeasurementRatio = measurements.length > 0 ? completed / measurements.length : 0;
  const siteConditions = contract.site_conditions;
  const answeredSiteConditions = SITE_CONDITION_KEYS.filter((key) => siteConditions && siteConditions[key] != null).length;
  const siteConditionsRatio = SITE_CONDITION_KEYS.length > 0 ? answeredSiteConditions / SITE_CONDITION_KEYS.length : 0;
  return {
    measurement_confirmed: measurementConfirmed,
    room_measurement_ratio: roomMeasurementRatio,
    site_conditions_ratio: siteConditionsRatio,
    needs_confirmation_ids: [],
  };
}

function computeRangeFromLineItems(
  lineItems: EstimateResponse["tasks"],
  signals: RangeSignals,
  midTotal: number
): RangeResult {
  const totalSubtotals = lineItems.reduce((sum, item) => sum + Number(item.subtotal_sek ?? 0), 0);
  const weighted = lineItems.reduce((sum, item) => {
    const subtotal = Number(item.subtotal_sek ?? 0);
    const pct = TRADE_GROUP_UNCERTAINTY_PCT[item.trade_group] ?? DEFAULT_UNCERTAINTY_PCT;
    return sum + subtotal * pct;
  }, 0);
  const basePct = totalSubtotals > 0 ? weighted / totalSubtotals : DEFAULT_UNCERTAINTY_PCT;
  let adjustedPct = Math.min(Math.max(basePct, MIN_RANGE_PCT), MAX_RANGE_PCT);
  const reasons: string[] = [];
  if (signals.measurement_confirmed) {
    adjustedPct = Math.max(adjustedPct - 0.015, MIN_RANGE_PCT);
    reasons.push("measurement_confirmed");
  }
  if (signals.room_measurement_ratio >= 0.75) {
    adjustedPct = Math.max(adjustedPct - 0.015, MIN_RANGE_PCT);
    reasons.push("room_measurements_complete");
  } else if (signals.room_measurement_ratio >= 0.5) {
    adjustedPct = Math.max(adjustedPct - 0.0075, MIN_RANGE_PCT);
    reasons.push("room_measurements_partial");
  }
  if (signals.site_conditions_ratio >= 0.75) {
    adjustedPct = Math.max(adjustedPct - 0.01, MIN_RANGE_PCT);
    reasons.push("site_conditions_complete");
  } else if (signals.site_conditions_ratio >= 0.5) {
    adjustedPct = Math.max(adjustedPct - 0.005, MIN_RANGE_PCT);
    reasons.push("site_conditions_partial");
  }
  if (signals.needs_confirmation_ids.length > 0) {
    adjustedPct = Math.min(adjustedPct + 0.02, MAX_RANGE_PCT);
    reasons.push("needs_confirmation");
  }

  const mid = Math.round(midTotal);
  const minDelta = Math.max(MIN_RANGE_SEK, Math.round(mid * MIN_RANGE_PCT));
  const delta = Math.max(Math.round(mid * adjustedPct), minDelta);
  const low = Math.max(mid - delta, 0);
  const high = mid + delta;
  return {
    low,
    mid,
    high,
    applied_pct: adjustedPct,
    reason_codes: reasons,
  };
}

export function computeEstimateQuality(inputs: any, needs: string[]): "confirmed" | "semi_confirmed" | "rough" {
  const hasFloor = inputs.floor_area_m2?.value != null;
  const hasWet = inputs.wet_zone_wall_area_m2?.value != null;
  const blocking = getBlockingIds(needs);
  if (hasFloor && hasWet && blocking.length === 0) return "confirmed";
  if (hasFloor) return "semi_confirmed";
  return "rough";
}

export function getBlockingIds(needs: string[]): string[] {
  return needs.filter((id) => ["NC-001", "NC-002", "NC-003", "NC-004"].includes(id));
}

function pickScenario(value: number | null | undefined, range: any, key: "low" | "mid" | "high") {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (range && typeof range[key] === "number") return range[key];
  return null;
}

function pickTotals(est: any) {
  return est
    ? {
        totals: est.totals,
      }
    : { totals: { base_subtotal_sek: 0, project_management_sek: 0, contingency_sek: 0, grand_total_sek: 0 } };
}

function safeNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function summarizeLaborMaterialFromEstimate(est?: EstimateResponse) {
  const tasks = est?.tasks ?? [];
  let labor = 0;
  let material = 0;
  for (const task of tasks) {
    labor += Number.isFinite(task.labor_sek) ? task.labor_sek : 0;
    material += Number.isFinite(task.material_sek) ? task.material_sek : 0;
  }
  return { labor, material };
}

function enforceMonotonicEstimates(low: number | null | undefined, mid: number | null | undefined, high: number | null | undefined) {
  const vals = [low, mid, high].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return { low: low ?? null, mid: mid ?? null, high: high ?? null };
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const midCandidate = typeof mid === "number" && Number.isFinite(mid) ? mid : (minVal + maxVal) / 2;
  const midClamped = Math.min(Math.max(midCandidate, minVal), maxVal);
  return { low: minVal, mid: midClamped, high: maxVal };
}

export function runEstimateFromNormalized(
  normalized: any,
  profile?: SweepProfile,
  siteConditionsAllowances?: SiteConditionsAllowanceSummary | null,
  rangeSignals?: RangeSignals
) {
  const ranges = normalized.inferred_ranges || {};
  const inputs = normalized.inputs || {};
  const signals: RangeSignals = {
    measurement_confirmed: false,
    room_measurement_ratio: 0,
    site_conditions_ratio: 0,
    needs_confirmation_ids: [],
    ...(rangeSignals ?? {}),
  };

  const floor = pickScenario(inputs?.floor_area_m2?.value, ranges.floor_area_m2, "mid");
  const wall = pickScenario(inputs?.wall_area_m2?.value, ranges.wall_area_m2, "mid");
  const ceiling = pickScenario(inputs?.ceiling_area_m2?.value, ranges.ceiling_area_m2 || ranges.floor_area_m2, "mid");
  const wet = pickScenario(inputs?.wet_zone_wall_area_m2?.value, ranges.wet_zone_wall_area_m2, "mid");

  const analysis: AnalysisResult = {
    room_type: normalized.room.room_type,
    confidence_room_type: normalized.room.confidence_room_type,
    floor_area_m2: floor,
    wall_area_m2: wall,
    ceiling_area_m2: ceiling,
    wet_zone_wall_area_m2: wet,
    estimated_dimensions_notes_sv: normalized.room.estimated_dimensions_notes_sv || "",
    visible_fixtures: normalized.room.visible_fixtures || {},
    suggested_intents: normalized.intents,
    needs_confirmation_ids: normalized.needs_confirmation_ids || [],
    assumptions_sv: normalized.room.assumptions_sv || [],
    building_year: normalized.room.building_year,
  } as AnalysisResult;

  const estimateResult = estimate({
    analysis,
    overrides: {},
    intents: normalized.intents,
    selections: normalized.selections,
    profile,
    site_conditions_allowances: siteConditionsAllowances ?? null,
  });

  signals.needs_confirmation_ids = estimateResult.needs_confirmation_ids || [];

  const range = computeRangeFromLineItems(estimateResult.tasks, signals, estimateResult.totals?.grand_total_sek ?? 0);
  const monotonicTotals = enforceMonotonicEstimates(range.low, range.mid, range.high);

  const laborMaterial = summarizeLaborMaterialFromEstimate(estimateResult);
  const laborRange = {
    min_sek: Math.round(Math.max(laborMaterial.labor * (1 - range.applied_pct), 0)),
    max_sek: Math.round(laborMaterial.labor * (1 + range.applied_pct)),
  };
  const materialRange = {
    min_sek: Math.round(Math.max(laborMaterial.material * (1 - range.applied_pct), 0)),
    max_sek: Math.round(laborMaterial.material * (1 + range.applied_pct)),
  };

  const totalsWithBreakdown = {
    ...estimateResult.totals,
    min_total_sek: safeNumber(monotonicTotals.low),
    max_total_sek: safeNumber(monotonicTotals.high),
    labor_min_sek: laborRange.min_sek,
    labor_max_sek: laborRange.max_sek,
    material_min_sek: materialRange.min_sek,
    material_max_sek: materialRange.max_sek,
  };

  const totalsSelection = pickTotals(estimateResult);

  return {
    estimate_range: {
      low: totalsSelection,
      mid: totalsSelection,
      high: totalsSelection,
    },
    estimate_low_sek: monotonicTotals.low,
    estimate_mid_sek: monotonicTotals.mid,
    estimate_high_sek: monotonicTotals.high,
    estimate_quality: normalized.estimate_quality || "rough",
    needs_confirmation_ids: estimateResult.needs_confirmation_ids,
    warnings: estimateResult.warnings || [],
    tasks: estimateResult.tasks || [],
    flags: estimateResult.flags || [],
    trade_group_totals: estimateResult.trade_group_totals || [],
    plausibility_band: estimateResult.plausibility_band || "",
    sek_per_m2: estimateResult.sek_per_m2 ?? null,
    derived_areas: estimateResult.derived_areas || normalized.derived_areas,
    totals: totalsWithBreakdown,
    site_conditions_allowances: estimateResult.site_conditions_allowances ?? null,
  } as any;
}

export function computeOutlierFlags(profile: SweepProfile, estimateResult: any) {
  const outlier: string[] = [];
  const info: string[] = [];
  const quality = estimateResult.estimate_quality || "rough";
  const mid = estimateResult.estimate_mid_sek ?? estimateResult.totals?.grand_total_sek;
  const perM2 = estimateResult.sek_per_m2 ?? null;
  const ensureInfoFlag = (code: string) => {
    if (!info.includes(code)) {
      info.push(code);
    }
  };

  const bands =
    quality === "rough"
      ? {
          refresh: [15000, 80000],
          full_rebuild: [70000, 200000],
          major: [130000, 320000],
        }
      : {
          refresh: [20000, 60000],
          full_rebuild: [80000, 180000],
          major: [150000, 300000],
        };

  if (profile === "refresh" && mid != null) {
    const [lo, hi] = bands.refresh;
    if (!(mid >= lo && mid <= hi)) outlier.push("REFRESH_OUT_OF_BAND");
  }
  if (profile === "full_rebuild" && mid != null) {
    const [lo, hi] = bands.full_rebuild;
    if (!(mid >= lo && mid <= hi)) outlier.push("FULL_OUT_OF_BAND");
    const perM2Thresh = quality === "rough" ? 35000 : 30000;
    if (perM2 && perM2 > perM2Thresh) {
      if (quality === "rough") info.push("FULL_PER_M2_TOO_HIGH");
      else outlier.push("FULL_PER_M2_TOO_HIGH");
    }
  }
  if (profile === "major" && mid != null) {
    const [lo, hi] = bands.major;
    if (!(mid >= lo && mid <= hi)) outlier.push("MAJOR_OUT_OF_BAND");
    const perM2Thresh = quality === "rough" ? 50000 : 45000;
    if (perM2 && perM2 > perM2Thresh) {
      if (quality === "rough") info.push("MAJOR_PER_M2_TOO_HIGH");
      else outlier.push("MAJOR_PER_M2_TOO_HIGH");
    }
  }
  const band = estimateResult.plausibility_band;
  if (band === "PB-002") {
    ensureInfoFlag("PLAUSIBILITY_BAND_PB_002");
  } else if (band === "PB-003") {
    ensureInfoFlag("PLAUSIBILITY_BAND_PB_003");
  }
  return { outlier_flags: outlier, info_flags: info };
}

type ConfidenceTier = "low" | "medium" | "high";

const CONFIDENCE_TIERS: ConfidenceTier[] = ["low", "medium", "high"];
const QUALITY_TIER_MAP: Record<string, ConfidenceTier> = {
  confirmed: "high",
  semi_confirmed: "medium",
  rough: "low",
};
const BLOCKING_NEEDS = new Set(["NC-001", "NC-002", "NC-003", "NC-004"]);

const ROT_RATE = clampNumber(parseEnvNumber(process.env.ROT_RATE, 0.3), 0, 1);
const ROT_MAX_DEDUCTION = parseEnvNumber(process.env.ROT_MAX_SEK, Infinity);

function parseEnvNumber(value: string | undefined, fallback: number) {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function clampNumber(value: number, min: number, max: number) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function deriveConfidenceTier(input: {
  estimate_quality?: string;
  analysis_confidence?: number | null;
  image_quality?: { sufficient_for_estimate: boolean } | null;
  needs_confirmation_ids?: string[] | null;
  warnings?: string[] | null;
  info_flags?: string[] | null;
  outlier_flags?: string[] | null;
}) {
  const baseQuality = input.estimate_quality ? input.estimate_quality : "rough";
  const baseTier = QUALITY_TIER_MAP[baseQuality] ?? "low";
  let tierIndex = CONFIDENCE_TIERS.indexOf(baseTier);
  if (tierIndex === -1) tierIndex = 0;

  const reasons = new Set<string>();
  const analysisLow = typeof input.analysis_confidence === "number" && input.analysis_confidence < 0.6;
  const imageInsufficient = Boolean(input.image_quality && input.image_quality.sufficient_for_estimate === false);
  if (analysisLow) {
    reasons.add("low_analysis_confidence");
  }
  if (imageInsufficient) {
    reasons.add("insufficient_image_quality");
  }
  if ((analysisLow || imageInsufficient) && tierIndex > 0) {
    tierIndex -= 1;
  }

  const needs = input.needs_confirmation_ids || [];
  const hasBlockingNeeds = needs.some((id) => BLOCKING_NEEDS.has(id));
  if (hasBlockingNeeds && tierIndex > 0) {
    tierIndex -= 1;
    reasons.add("needs_confirmation_blocking");
  } else if (hasBlockingNeeds) {
    reasons.add("needs_confirmation_blocking");
  }

  const hasWarnings =
    (input.warnings && input.warnings.length > 0) ||
    (input.outlier_flags && input.outlier_flags.length > 0) ||
    (input.info_flags && input.info_flags.length > 0);
  if (hasWarnings) {
    reasons.add("has_warnings_outliers");
  }

  return {
    confidence_tier: CONFIDENCE_TIERS[tierIndex],
    confidence_reasons: Array.from(reasons),
  };
}

function computeRotSummary(
  lineItems: Array<{ labor_sek: number; rot_eligible?: boolean }>,
  totals: { grand_total_sek?: number } | undefined
) {
  const rotEligibleLabor = lineItems.reduce(
    (sum, item) => sum + (item.rot_eligible ? Math.round(Number(item.labor_sek ?? 0)) : 0),
    0
  );
  const rawDeduction = Math.round(rotEligibleLabor * ROT_RATE);
  const cappedDeduction =
    Number.isFinite(ROT_MAX_DEDUCTION) && ROT_MAX_DEDUCTION >= 0 ? Math.min(rawDeduction, ROT_MAX_DEDUCTION) : rawDeduction;
  const capApplied = Number.isFinite(ROT_MAX_DEDUCTION) && rawDeduction > ROT_MAX_DEDUCTION;
  const grandTotal = Math.round(totals?.grand_total_sek ?? 0);
  const deduction = capApplied ? cappedDeduction : rawDeduction;
  const totalAfterRot = Math.max(grandTotal - deduction, 0);
  return {
    rot_rate: ROT_RATE,
    rot_eligible_labor_sek: rotEligibleLabor,
    rot_deduction_sek: deduction,
    total_after_rot_sek: totalAfterRot,
    rot_cap_applied: capApplied,
    rot_cap_reason: capApplied ? "rot_max_limit" : "unknown_user_tax_limit",
    rot_cap_sek: Number.isFinite(ROT_MAX_DEDUCTION) ? ROT_MAX_DEDUCTION : undefined,
  };
}

const SITE_CONDITION_TASK_KEYS = new Set([
  "site_conditions_access_labor_hours",
  "site_conditions_waste_logistics_hours",
  "site_conditions_admin_hours",
]);

function summarizeSiteConditionsEffect(
  lineItems: Array<{ key: string; labor_sek: number; material_sek: number; subtotal_sek: number }>,
  reasonCodes: string[]
) {
  const allowances = lineItems.filter((item) => SITE_CONDITION_TASK_KEYS.has(item.key));
  if (!allowances.length) {
    return undefined;
  }
  const addedLabor = Math.round(allowances.reduce((sum, item) => sum + Number(item.labor_sek ?? 0), 0));
  const addedMaterial = Math.round(allowances.reduce((sum, item) => sum + Number(item.material_sek ?? 0), 0));
  const addedTotal = Math.round(allowances.reduce((sum, item) => sum + Number(item.subtotal_sek ?? 0), 0));
  const uniqueReasons = Array.from(new Set(reasonCodes.filter(Boolean)));
  return {
    added_labor_sek: addedLabor,
    added_material_sek: addedMaterial,
    added_total_sek: addedTotal,
    reason_codes: uniqueReasons,
  };
}

export function buildFrontendEstimate(
  estimateResult: any,
  normalized: any,
  flags: { outlier_flags: string[]; info_flags: string[] }
) {
  const totals = estimateResult.totals || {
    base_subtotal_sek: 0,
    project_management_sek: 0,
    contingency_sek: 0,
    grand_total_sek: 0,
  };
  const line_items = (estimateResult.tasks || []).map((task: any, index: number) => ({
    key: String(task.task_key ?? task.key ?? `line-${index}`),
    trade_group: String(task.trade_group ?? ""),
    qty: Number(task.qty ?? 0),
    unit: String(task.unit ?? ""),
    labor_sek: Number(task.labor_sek ?? 0),
    material_sek: Number(task.material_sek ?? 0),
    subtotal_sek: Number(task.subtotal_sek ?? 0),
    note: task.note ? String(task.note) : undefined,
    rot_eligible: Boolean(task.rot_eligible),
  }));
  const derivedAreas =
    estimateResult.derived_areas || normalized?.derived_areas || { non_tiled_wall_area_m2: null };
  const needs = estimateResult.needs_confirmation_ids || normalized?.needs_confirmation_ids || [];
  const toIntegerValue = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
  const estimateRange = {
    low_sek: toIntegerValue(estimateResult.estimate_low_sek),
    mid_sek: toIntegerValue(estimateResult.estimate_mid_sek),
    high_sek: toIntegerValue(estimateResult.estimate_high_sek),
  };
  const laborRange = {
    min_sek: toIntegerValue(estimateResult.totals?.labor_min_sek),
    max_sek: toIntegerValue(estimateResult.totals?.labor_max_sek),
  };
  const materialRange = {
    min_sek: toIntegerValue(estimateResult.totals?.material_min_sek),
    max_sek: toIntegerValue(estimateResult.totals?.material_max_sek),
  };
  const { confidence_tier, confidence_reasons } = deriveConfidenceTier({
    estimate_quality: estimateResult.estimate_quality,
    analysis_confidence: normalized?.analysis?.analysis_confidence,
    image_quality: normalized?.analysis?.image_quality,
    needs_confirmation_ids: estimateResult.needs_confirmation_ids || needs,
    warnings: estimateResult.warnings,
    info_flags: flags?.info_flags,
    outlier_flags: flags?.outlier_flags,
  });
  const rot_summary = computeRotSummary(line_items, estimateResult.totals);
  const site_conditions_effect = summarizeSiteConditionsEffect(
    line_items,
    estimateResult.site_conditions_allowances?.reason_codes || []
  );
  return {
    line_items,
    totals,
    trade_group_totals: estimateResult.trade_group_totals || [],
    flags: estimateResult.flags || [],
    info_flags: flags?.info_flags || [],
    assumptions: normalized?.room?.assumptions_sv || [],
    warnings: estimateResult.warnings || [],
    needs_confirmation_ids: needs,
    derived_areas: {
      non_tiled_wall_area_m2: derivedAreas?.non_tiled_wall_area_m2 ?? null,
    },
    plausibility_band: estimateResult.plausibility_band || "",
    sek_per_m2: typeof estimateResult.sek_per_m2 === "number" ? estimateResult.sek_per_m2 : null,
    estimate_quality: estimateResult.estimate_quality ?? normalized?.estimate_quality ?? "rough",
    estimate_range: estimateRange,
    labor_range: laborRange,
    material_range: materialRange,
    confidence_tier,
    confidence_reasons,
    rot_summary,
    site_conditions_effect,
  };
}

export function evaluateContract(
  contract: CanonicalEstimatorContract,
  options?: { imageId?: string; profile?: SweepProfile }
) {
  const mapperResult = mapOutcomeToEstimatorInputs(contract.outcome);
  const normalized = buildNormalizedFromContract(contract, options?.imageId, mapperResult);
  const profile = options?.profile ?? determineProfileFromOutcome(contract.outcome);
  const siteConditionsAllowances = computeSiteConditionsAllowances(contract.site_conditions);
  const rangeSignals = deriveRangeSignals(contract);
  const estimateResult = runEstimateFromNormalized(
    normalized,
    profile,
    siteConditionsAllowances,
    rangeSignals
  );
  const flags = computeOutlierFlags(profile, estimateResult);
  const clientEstimate = buildFrontendEstimate(estimateResult, normalized, flags);
  return {
    normalized,
    estimateResult,
    clientEstimate,
    flags,
    profile,
    mappingLog: mapperResult.mappingLog,
  };
}
