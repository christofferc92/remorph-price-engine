export type SizeBucket = "under_4_sqm" | "between_4_and_7_sqm" | "over_7_sqm";

export type RoomType = "bathroom" | "other";

export type DetectedFixtures = {
  shower_present: boolean;
  bathtub_present: boolean;
  toilet_present: boolean;
  sink_present: boolean;
};

export type LayoutFeatures = {
  shower_zone_visible: boolean;
  wet_room_layout: boolean;
  tight_space: boolean;
  irregular_geometry: boolean;
};

export type CeilingFeatures = {
  ceiling_visible: boolean;
  sloped_ceiling_detected: boolean;
};

export type ConditionSignal = "good" | "average" | "poor" | "unknown";

export type ConditionSignals = {
  overall_condition: ConditionSignal;
};

export type ImageQualityIssue =
  | "low_light"
  | "blurry"
  | "incomplete_room_coverage"
  | "obstructed_views";

export type ImageQuality = {
  sufficient_for_estimate: boolean;
  issues: ImageQualityIssue[];
};

export type AnalysisContract = {
  room_type: RoomType;
  bathroom_size_estimate: SizeBucket;
  bathroom_size_confidence: number;
  detected_fixtures: DetectedFixtures;
  layout_features: LayoutFeatures;
  ceiling_features: CeilingFeatures;
  condition_signals: ConditionSignals;
  image_quality: ImageQuality;
  analysis_confidence: number;
};

export type BathroomSizeSource = "ai_estimated" | "user_overridden";

export type UserOverrideContract = {
  bathroom_size_final: SizeBucket;
  bathroom_size_source: BathroomSizeSource;
};

export type WetZoneType = "shower_only" | "corner_2_walls" | "three_walls" | "full_wet_room";

export type MeasurementOverride = {
  length?: number;
  width?: number;
  area?: number;
  ceilingHeight?: number;
  wetZone?: WetZoneType;
};

export type RoomMeasurements = {
  floor_area_m2: number | null;
  wall_area_m2: number | null;
  ceiling_area_m2: number | null;
  wet_zone_wall_area_m2: number | null;
};

export type SiteConditions = {
  floor_elevator?: "house_or_ground" | "apt_elevator" | "apt_no_elevator_1_2" | "apt_no_elevator_3_plus" | "unknown";
  carry_distance?: "under_20m" | "20_50m" | "50_100m" | "over_100m" | "unknown";
  parking_loading?: "easy_nearby" | "limited" | "none" | "unknown";
  work_time_restrictions?: "none" | "standard_daytime" | "strict" | "unknown";
  access_constraints_notes?: string;
  permits_brf?: "none" | "brf_required" | "permit_required" | "unknown";
  wetroom_certificate_required?: "required" | "preferred" | "not_needed" | "unknown";
  build_year_bucket?: "pre_1960" | "1960_1979" | "1980_1999" | "2000_plus" | "unknown";
  last_renovated?: "under_5y" | "5_15y" | "over_15y" | "unknown";
  hazardous_material_risk?: "none_known" | "suspected" | "confirmed" | "unknown";
  occupancy?: "not_living_in" | "living_in_full" | "living_in_partly" | "unknown";
  must_keep_facility_running?: "yes" | "no" | "unknown";
  container_possible?: "yes" | "no" | "unknown";
  protection_level?: "normal" | "extra" | "unknown";
  water_shutoff_accessible?: "yes" | "no" | "unknown";
  electrical_panel_accessible?: "yes" | "no" | "unknown";
  recent_stambyte?: "yes" | "no" | "unknown";
};

export const WET_ZONE_FRACTIONS: Record<WetZoneType, number> = {
  shower_only: 0.25,
  corner_2_walls: 0.5,
  three_walls: 0.75,
  full_wet_room: 1,
};

export type ShowerType = "walk_in_shower_glass" | "shower_cabin" | "no_shower" | "keep";
export type BathtubOption = "yes" | "no" | "keep";
export type ToiletType = "wall_hung" | "floor_standing" | "keep";
export type VanityType = "vanity_with_cabinet" | "simple_sink" | "no_sink" | "keep";
export type WallFinishOption =
  | "tiles_all_walls"
  | "large_format_tiles_all_walls"
  | "tiles_wet_zone_only"
  | "painted_walls_only"
  | "keep";
export type FloorFinishOption =
  | "standard_ceramic_tiles"
  | "large_format_tiles"
  | "vinyl_wet_room_mat"
  | "microcement_seamless"
  | "keep";
export type CeilingTypeOption =
  | "painted_ceiling"
  | "moisture_resistant_panels"
  | "sloped_painted"
  | "sloped_with_panels"
  | "keep";
export type FloorHeatingOption = "floor_heating_on" | "floor_heating_off" | "keep";
export type LayoutChangeOption = "yes" | "no";
export type ShowerNichesOption = "none" | "one" | "two_or_more";

export type UserOutcomeContract = {
  shower_type: ShowerType;
  bathtub: BathtubOption;
  toilet_type: ToiletType;
  vanity_type: VanityType;
  wall_finish: WallFinishOption;
  floor_finish: FloorFinishOption;
  ceiling_type: CeilingTypeOption;
  layout_change: LayoutChangeOption;
  shower_niches: ShowerNichesOption;
  floor_heating?: FloorHeatingOption;
};

export type CanonicalEstimatorContract = {
  analysis: AnalysisContract;
  overrides: UserOverrideContract;
  outcome: UserOutcomeContract;
  measurementOverride?: MeasurementOverride;
  roomMeasurements?: RoomMeasurements;
  site_conditions?: SiteConditions;
};

export const sizeBucketOptions: { value: SizeBucket; label: string }[] = [
  { value: "under_4_sqm", label: "Under 4 m²" },
  { value: "between_4_and_7_sqm", label: "4–7 m²" },
  { value: "over_7_sqm", label: "Över 7 m²" },
];

export const BUCKET_AREA_MAP: Record<SizeBucket, number> = {
  under_4_sqm: 3.5,
  between_4_and_7_sqm: 5.5,
  over_7_sqm: 8.5,
};

export function bucketToArea(bucket: SizeBucket) {
  return BUCKET_AREA_MAP[bucket];
}

export const showerTypeOptions: { value: ShowerType; label: string }[] = [
  { value: "walk_in_shower_glass", label: "Walk-in shower (glass)" },
  { value: "shower_cabin", label: "Shower cabin" },
  { value: "no_shower", label: "No shower" },
  { value: "keep", label: "Behåll som det är" },
];

export const bathtubOptions: { value: BathtubOption; label: string }[] = [
  { value: "yes", label: "With bathtub" },
  { value: "no", label: "No bathtub" },
  { value: "keep", label: "Behåll som det är" },
];

export const toiletTypeOptions: { value: ToiletType; label: string }[] = [
  { value: "wall_hung", label: "Wall-hung toilet" },
  { value: "floor_standing", label: "Floor-standing toilet" },
  { value: "keep", label: "Behåll som det är" },
];

export const vanityTypeOptions: { value: VanityType; label: string }[] = [
  { value: "vanity_with_cabinet", label: "Vanity with cabinet" },
  { value: "simple_sink", label: "Simple sink" },
  { value: "no_sink", label: "No sink" },
  { value: "keep", label: "Behåll som det är" },
];

export const wallFinishOptions: { value: WallFinishOption; label: string }[] = [
  { value: "tiles_all_walls", label: "Tiles on all walls" },
  { value: "large_format_tiles_all_walls", label: "Large-format tiles" },
  { value: "tiles_wet_zone_only", label: "Tiles in wet zone" },
  { value: "painted_walls_only", label: "Painted walls" },
  { value: "keep", label: "Behåll som det är" },
];

export const floorFinishOptions: { value: FloorFinishOption; label: string }[] = [
  { value: "standard_ceramic_tiles", label: "Standard ceramic tiles" },
  { value: "large_format_tiles", label: "Large-format tiles" },
  { value: "vinyl_wet_room_mat", label: "Vinyl wet room mat" },
  { value: "microcement_seamless", label: "Microcement" },
  { value: "keep", label: "Behåll som det är" },
];

export const ceilingTypeOptions: { value: CeilingTypeOption; label: string }[] = [
  { value: "painted_ceiling", label: "Painted ceiling" },
  { value: "moisture_resistant_panels", label: "Moisture-resistant panels" },
  { value: "sloped_painted", label: "Sloped painted" },
  { value: "sloped_with_panels", label: "Sloped with panels" },
  { value: "keep", label: "Behåll som det är" },
];

export const layoutChangeOptions: { value: LayoutChangeOption; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const showerNichesOptions: { value: ShowerNichesOption; label: string }[] = [
  { value: "none", label: "No niches" },
  { value: "one", label: "One niche" },
  { value: "two_or_more", label: "Two or more" },
];
