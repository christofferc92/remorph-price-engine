import path from "path";
import { loadCatalog, loadRateCard } from "./loadYaml.ts";
import type { Catalog, RateCard } from "./loadYaml.ts";
import { compileDerivedFlags } from "./scopeCompiler.ts";
import type { IntentMap } from "./scopeCompiler.ts";
import type { CeilingTypeOption } from "../../src/shared/canonicalEstimatorContract.ts";

export type AnalysisResult = {
  room_type: "bathroom" | "other";
  confidence_room_type: number;
  floor_area_m2: number | null;
  wall_area_m2: number | null;
  ceiling_area_m2: number | null;
  wet_zone_wall_area_m2: number | null;
  estimated_dimensions_notes_sv: string;
  assumptions_sv?: string[];
  visible_fixtures: {
    toilet: number | null;
    sink: number | null;
    shower: number | null;
    bathtub: number | null;
  };
  suggested_intents: IntentMap;
  needs_confirmation_ids: string[];
  walls_fully_tiled?: boolean;
  building_year?: number | null;
};

export type Selection = {
  floor_finish:
    | "wetroom_vinyl"
    | "ceramic_tile_standard"
    | "ceramic_tile_premium"
    | "microcement"
    | "keep";
  wall_finish:
    | "wetroom_vinyl"
    | "ceramic_tile_standard"
    | "ceramic_tile_premium"
    | "painted_walls"
    | "keep";
  fixtures_tier: "basic" | "standard" | "premium";
  shower_niches: "none" | "one" | "two_or_more";
  pipe_reroute?: boolean;
  needs_brf_docs?: boolean;
  toilet_type?: "wall_hung" | "floor_standing";
  ceiling_type?: CeilingTypeOption;
};

export type EstimateRequest = {
  analysis: AnalysisResult;
  overrides?: Partial<Record<AreaField, number | null>>;
  intents: IntentMap;
  selections: Selection;
  profile?: "refresh" | "full_rebuild" | "major";
};

export type TaskLine = {
  task_key: string;
  trade_group: string;
  qty: number;
  unit: string;
  labor_sek: number;
  material_sek: number;
  subtotal_sek: number;
  note?: string;
};

export type EstimateResponse = {
  tasks: TaskLine[];
  flags: string[];
  totals: {
    base_subtotal_sek: number;
    project_management_sek: number;
    contingency_sek: number;
    grand_total_sek: number;
  };
  trade_group_totals: { trade_group: string; subtotal_sek: number }[];
  plausibility_band: string;
  sek_per_m2: number | null;
  warnings: string[];
  needs_confirmation_ids: string[];
  derived_areas: { non_tiled_wall_area_m2: number | null };
};

type AreaField = "floor_area_m2" | "wall_area_m2" | "ceiling_area_m2" | "wet_zone_wall_area_m2";

type Fixtures = {
  toilet: number;
  sink: number;
  shower: number;
  bathtub: number;
};

export function estimate(payload: EstimateRequest): EstimateResponse {
  const catalog = loadCatalog();
  const rateCard = loadRateCard();

  const analysis = payload.analysis;
  const overrides = payload.overrides || {};
  const room = mergeRoomWithOverrides(analysis, overrides);
  const fixtures = normalizeFixtures(analysis.visible_fixtures);

  const intents = payload.intents;
  const flags = compileDerivedFlags(catalog, intents);
  const surfacesChanged = intents.change_floor_finish || intents.change_wall_finish;

  const selections = payload.selections;
  const needsConfirmations = computeNeedsConfirmations(room, intents, selections, {
    building_year: analysis.building_year,
    walls_fully_tiled: room.walls_fully_tiled,
  });

  const tasks = buildTasks({
    catalog,
    rateCard,
    flags,
    room,
    fixtures,
    selections,
    intents,
    needsConfirmations,
    surfacesChanged,
  });

  const base_subtotal_sek = tasks.reduce((sum, t) => sum + t.subtotal_sek, 0);
  const project_management_pct = flags.has("requires_project_management") ? rateCard.overhead.project_management_pct : 0;
  const project_management_sek = project_management_pct > 0 ? base_subtotal_sek * project_management_pct : 0;
  const contingency_sek = (base_subtotal_sek + project_management_sek) * rateCard.overhead.contingency_pct;
  const grand_total_sek = base_subtotal_sek + project_management_sek + contingency_sek;

  const trade_group_totals = summarizeTradeGroups(tasks);
  const sek_per_m2 = room.floor_area_m2 ? grand_total_sek / room.floor_area_m2 : null;

  const plausibility_band = derivePlausibilityBand(intents, selections, payload.profile);
  const warnings = buildWarnings(sek_per_m2, plausibility_band, grand_total_sek, payload.profile);
  const derived_areas = {
    non_tiled_wall_area_m2: computeNonTiledWallArea(room, selections),
  };

  return {
    tasks,
    flags: Array.from(flags),
    totals: { base_subtotal_sek, project_management_sek, contingency_sek, grand_total_sek },
    trade_group_totals,
    plausibility_band,
    sek_per_m2,
    warnings,
    needs_confirmation_ids: Array.from(needsConfirmations),
    derived_areas,
  };
}

function mergeRoomWithOverrides(
  analysis: AnalysisResult,
  overrides: Partial<Record<AreaField, number | null>>
): AnalysisResult & { walls_fully_tiled?: boolean } {
  const merged: AnalysisResult = {
    ...analysis,
    floor_area_m2: numberOrNull(overrides.floor_area_m2, analysis.floor_area_m2),
    wall_area_m2: numberOrNull(overrides.wall_area_m2, analysis.wall_area_m2),
    ceiling_area_m2: numberOrNull(overrides.ceiling_area_m2, analysis.ceiling_area_m2),
    wet_zone_wall_area_m2: numberOrNull(overrides.wet_zone_wall_area_m2, analysis.wet_zone_wall_area_m2),
    assumptions_sv: analysis.assumptions_sv ? [...analysis.assumptions_sv] : [],
  };

  const wallsFullyTiled =
    analysis.walls_fully_tiled || detectWallsFullyTiled(analysis.estimated_dimensions_notes_sv, analysis.assumptions_sv || []);
  merged.walls_fully_tiled = wallsFullyTiled;

  // If vision said fully tiled walls and wet zone missing, set to wall area
  if (wallsFullyTiled && merged.wall_area_m2 != null && merged.wet_zone_wall_area_m2 == null) {
    merged.wet_zone_wall_area_m2 = merged.wall_area_m2;
    merged.assumptions_sv?.push("Sat våtzon lika med väggarea eftersom modellen sa helkaklade väggar.");
  }

  // Apply size bucket fallback for missing values
  const fallbacked = applyAreaFallback(merged);
  return fallbacked;
}

function numberOrNull(...values: Array<number | null | undefined>): number | null {
  for (const val of values) {
    if (typeof val === "number" && !Number.isNaN(val)) return val;
  }
  return null;
}

function applyAreaFallback(analysis: AnalysisResult): AnalysisResult {
  const clone: AnalysisResult = { ...analysis, assumptions_sv: analysis.assumptions_sv ? [...analysis.assumptions_sv] : [] };

  const bucket = pickSizeBucket(analysis.visible_fixtures);
  const defaults = sizeBuckets[bucket];

  let added = false;
  if (clone.floor_area_m2 == null) {
    clone.floor_area_m2 = defaults.floor_area_m2;
    added = true;
  }
  if (clone.wall_area_m2 == null) {
    clone.wall_area_m2 = defaults.wall_area_m2;
    added = true;
  }
  if (clone.ceiling_area_m2 == null) {
    clone.ceiling_area_m2 = defaults.ceiling_area_m2;
    added = true;
  }
  if (clone.wet_zone_wall_area_m2 == null) {
    clone.wet_zone_wall_area_m2 = defaults.wet_zone_wall_area_m2;
    added = true;
  }

  if (added) {
    clone.assumptions_sv?.push(
      `Antog ungefärliga mått (${bucket}) för beräkning: golv ${defaults.floor_area_m2} m², vägg ${defaults.wall_area_m2} m², våtzon ${defaults.wet_zone_wall_area_m2} m².`
    );
    if (!clone.estimated_dimensions_notes_sv) {
      clone.estimated_dimensions_notes_sv = "Mått uppskattade automatiskt p.g.a. saknade värden.";
    }
  }
  return clone;
}

function pickSizeBucket(visible: AnalysisResult["visible_fixtures"]) {
  const fixtures = visible || {};
  const bathtub = fixtures.bathtub ?? 0;
  const shower = fixtures.shower ?? 0;
  const total = (fixtures.toilet ?? 0) + (fixtures.sink ?? 0) + shower + bathtub;
  if (bathtub > 0 || total >= 4) return "large" as const;
  if (total >= 3) return "medium" as const;
  return "small" as const;
}

const sizeBuckets = {
  small: {
    floor_area_m2: 4,
    wall_area_m2: 14,
    ceiling_area_m2: 4,
    wet_zone_wall_area_m2: 10,
  },
  medium: {
    floor_area_m2: 5.5,
    wall_area_m2: 20,
    ceiling_area_m2: 5.5,
    wet_zone_wall_area_m2: 16,
  },
  large: {
    floor_area_m2: 7,
    wall_area_m2: 26,
    ceiling_area_m2: 7,
    wet_zone_wall_area_m2: 22,
  },
} as const;

function normalizeFixtures(visible: AnalysisResult["visible_fixtures"]): Fixtures {
  return {
    toilet: visible.toilet ?? 1,
    sink: visible.sink ?? 1,
    shower: visible.shower ?? 1,
    bathtub: visible.bathtub ?? 0,
  };
}

function computeNeedsConfirmations(
  room: AnalysisResult,
  intents: IntentMap,
  selections: Selection,
  opts: { building_year?: number | null; walls_fully_tiled?: boolean }
): Set<string> {
  const needs = new Set<string>();
  const wallFinishTiled = isTiledOrVinyl(selections.wall_finish);

  if (!room.floor_area_m2 || room.floor_area_m2 <= 0) needs.add("NC-001");

  const wetMissing = room.wet_zone_wall_area_m2 == null || typeof room.wet_zone_wall_area_m2 === "undefined";
  if (wetMissing) {
    needs.add("NC-002");
  } else if (
    wallFinishTiled &&
    room.wall_area_m2 != null &&
    room.wet_zone_wall_area_m2 != null &&
    room.wet_zone_wall_area_m2 < room.wall_area_m2 - 0.5
  ) {
    needs.add("NC-002");
  }

  if (intents.change_layout) needs.add("NC-003");
  if (opts.building_year != null && opts.building_year < 1980) needs.add("NC-004");
  if (intents.add_underfloor_heating && !intents.change_floor_finish) needs.add("NC-005");

  if (opts.walls_fully_tiled && room.wall_area_m2 && room.wet_zone_wall_area_m2 != null && room.wet_zone_wall_area_m2 < room.wall_area_m2) {
    needs.add("NC-002");
  }

  return needs;
}

function buildTasks({
  catalog,
  rateCard,
  flags,
  room,
  fixtures,
  selections,
  intents,
  needsConfirmations,
}: {
  catalog: Catalog;
  rateCard: RateCard;
  flags: Set<string>;
  room: Record<AreaField, number | null> & { walls_fully_tiled?: boolean };
  fixtures: Fixtures;
    selections: Selection;
    intents: IntentMap;
    needsConfirmations: Set<string>;
    surfacesChanged: boolean;
  }): TaskLine[] {
  // Defensive grab in case type stripping drops destructured binding
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surfacesChanged = (arguments[0] as any).surfacesChanged;
  const lines: TaskLine[] = [];
  const wallHungAllowanceKey = "toilet_wall_hung_allowance";
  const shouldAddWallHungAllowance = intents.replace_toilet && selections.toilet_type === "wall_hung";
  let wallHungAllowanceAdded = false;

  const pushWallHungAllowance = () => {
    if (!shouldAddWallHungAllowance || wallHungAllowanceAdded) return;
    const rate = rateCard.task_rates[wallHungAllowanceKey];
    if (!rate) return;
    const subtotal = Math.max(rate.labor_sek_per_unit + rate.material_sek_per_unit, rate.min_charge_sek ?? 0);
    lines.push({
      task_key: wallHungAllowanceKey,
      trade_group: "plumbing",
      qty: 1,
      unit: rate.unit,
      labor_sek: round(rate.labor_sek_per_unit),
      material_sek: round(rate.material_sek_per_unit),
      subtotal_sek: round(subtotal),
    });
    wallHungAllowanceAdded = true;
  };

  const ceilingPanelsAllowanceKey = "ceiling_panels_allowance";
  const ceilingSlopedAllowanceKey = "ceiling_sloped_allowance";
  const ceilingType = selections.ceiling_type ?? "painted_ceiling";
  const shouldAddCeilingPanelsAllowance =
    intents.paint_ceiling &&
    (ceilingType === "moisture_resistant_panels" || ceilingType === "sloped_with_panels");
  const shouldAddCeilingSlopedAllowance =
    intents.paint_ceiling &&
    (ceilingType === "sloped_painted" || ceilingType === "sloped_with_panels");
  let ceilingPanelsAllowanceAdded = false;
  let ceilingSlopedAllowanceAdded = false;

  const pushCeilingPanelsAllowance = () => {
    if (!shouldAddCeilingPanelsAllowance || ceilingPanelsAllowanceAdded) return;
    const rate = rateCard.task_rates[ceilingPanelsAllowanceKey];
    if (!rate) return;
    const subtotal = Math.max(rate.labor_sek_per_unit + rate.material_sek_per_unit, rate.min_charge_sek ?? 0);
    lines.push({
      task_key: ceilingPanelsAllowanceKey,
      trade_group: "carpentry_substrate",
      qty: 1,
      unit: rate.unit,
      labor_sek: round(rate.labor_sek_per_unit),
      material_sek: round(rate.material_sek_per_unit),
      subtotal_sek: round(subtotal),
    });
    ceilingPanelsAllowanceAdded = true;
  };

  const pushCeilingSlopedAllowance = () => {
    if (!shouldAddCeilingSlopedAllowance || ceilingSlopedAllowanceAdded) return;
    const rate = rateCard.task_rates[ceilingSlopedAllowanceKey];
    if (!rate) return;
    const subtotal = Math.max(rate.labor_sek_per_unit + rate.material_sek_per_unit, rate.min_charge_sek ?? 0);
    lines.push({
      task_key: ceilingSlopedAllowanceKey,
      trade_group: "painting",
      qty: 1,
      unit: rate.unit,
      labor_sek: round(rate.labor_sek_per_unit),
      material_sek: round(rate.material_sek_per_unit),
      subtotal_sek: round(subtotal),
    });
    ceilingSlopedAllowanceAdded = true;
  };

  const showerNicheAllowanceKey = "shower_niche_allowance";
  const showerNicheCounts: Record<Selection["shower_niches"], number> = {
    none: 0,
    one: 1,
    two_or_more: 2,
  };
  const showerNicheCount = showerNicheCounts[selections.shower_niches ?? "none"];
  const shouldAddShowerNicheAllowance = intents.replace_shower && showerNicheCount > 0;
  let showerNicheAllowanceAdded = false;

  const pushShowerNicheAllowance = () => {
    if (!shouldAddShowerNicheAllowance || showerNicheAllowanceAdded) return;
    const rate = rateCard.task_rates[showerNicheAllowanceKey];
    if (!rate) return;
    const subtotal = Math.max(
      showerNicheCount * (rate.labor_sek_per_unit + rate.material_sek_per_unit),
      rate.min_charge_sek ?? 0
    );
    lines.push({
      task_key: showerNicheAllowanceKey,
      trade_group: "carpentry_substrate",
      qty: showerNicheCount,
      unit: rate.unit,
      labor_sek: round(showerNicheCount * rate.labor_sek_per_unit),
      material_sek: round(showerNicheCount * rate.material_sek_per_unit),
      subtotal_sek: round(subtotal),
    });
    showerNicheAllowanceAdded = true;
  };

  const includeByTrade: Record<string, boolean> = {
    demolition: flags.has("requires_demolition"),
    carpentry_substrate: flags.has("requires_substrate_prep"),
    waterproofing: flags.has("requires_waterproofing"),
    tiling_or_vinyl:
      flags.has("requires_tiler") || flags.has("requires_flooring_installer") || selections.floor_finish === "wetroom_vinyl",
    plumbing: flags.has("requires_plumber"),
    electrical: flags.has("requires_electrician") || intents.add_underfloor_heating || intents.update_lighting,
    ventilation: flags.has("requires_ventilation") || intents.improve_ventilation,
    painting: flags.has("requires_painter"),
    cleanup_waste: flags.has("requires_cleanup"),
    project_management_docs: flags.has("requires_project_management") || flags.has("requires_permit_docs"),
  };

  const floorKeepTaskKeys = new Set([
    "demolish_remove_floor_tiles",
    "apply_waterproof_membrane_floor",
    "install_floor_tiles_or_vinyl",
    "install_floor_microcement",
  ]);
  const wallKeepTaskKeys = new Set(["demolish_remove_wall_tiles", "apply_waterproof_membrane_walls", "install_wall_tiles"]);

  // Layout changes demand extra trades even if flags were not set by rules.
  if (intents.change_layout) {
    includeByTrade.demolition = true;
    includeByTrade.plumbing = true;
    includeByTrade.carpentry_substrate = true;
    includeByTrade.project_management_docs = true;
  }

  const areaWithWasteFloor = applyMinWaste(room.floor_area_m2, 1.1, 4);
  const areaWithWasteWalls = applyMinWaste(room.wet_zone_wall_area_m2, 1.1, 2);
  const nonTiledWallArea = computeNonTiledWallArea(room, selections);

  for (const task of catalog.tasks || []) {
    if (!includeByTrade[task.trade_group]) continue;
    if (selections.floor_finish === "keep" && floorKeepTaskKeys.has(task.task_key)) continue;
    if (selections.wall_finish === "keep" && wallKeepTaskKeys.has(task.task_key)) continue;
    if (selections.floor_finish === "wetroom_vinyl" && task.task_key === "apply_waterproof_membrane_floor") continue;
    if (
      (selections.wall_finish === "wetroom_vinyl" || selections.wall_finish === "painted_walls") &&
      task.task_key === "apply_waterproof_membrane_walls"
    )
      continue;
    if (
      (selections.wall_finish === "wetroom_vinyl" || selections.wall_finish === "painted_walls") &&
      task.task_key === "install_wall_tiles"
    )
      continue;
    if (task.task_key === "install_floor_tiles_or_vinyl" && selections.floor_finish === "microcement") continue;
    if (task.task_key === "install_floor_microcement" && selections.floor_finish !== "microcement") continue;
    if (task.task_key === "demolish_chase_for_pipes" && !(intents.change_layout || selections.pipe_reroute)) continue;
    if (task.task_key === "permit_or_board_application" && !(intents.change_layout || selections.needs_brf_docs)) continue;
    if (task.task_key === "issue_wetroom_certificate" && !flags.has("requires_waterproofing")) continue;
    if (task.task_key === "project_coordination_fee" && rateCard.overhead.project_management_pct > 0) continue;

    const qty = computeQuantity(task.task_key, {
      room,
      fixtures,
      areaWithWasteFloor,
      areaWithWasteWalls,
      intents,
      nonTiledWallArea,
      flags,
      selections,
      needsConfirmations,
      surfacesChanged,
    });
    if (qty <= 0) continue;

    const rate = rateCard.task_rates[task.task_key] || {
      unit: "unit",
      labor_sek_per_unit: 0,
      material_sek_per_unit: 0,
    };
    const materialAdjustment = getMaterialAdjustment(task.task_key, selections);
    const materialPerUnit = Math.max(rate.material_sek_per_unit + materialAdjustment, 0);
    const rawSubtotal = qty * (rate.labor_sek_per_unit + materialPerUnit);
    const subtotal = Math.max(rawSubtotal, rate.min_charge_sek ?? 0);

    lines.push({
      task_key: task.task_key,
      trade_group: task.trade_group,
      qty: round(qty),
      unit: rate.unit,
      labor_sek: round(qty * rate.labor_sek_per_unit),
      material_sek: round(qty * materialPerUnit),
      subtotal_sek: round(subtotal),
      note: deriveTaskNote(task.task_key, selections),
    });

    if (task.task_key === "install_toilet") {
      pushWallHungAllowance();
    }
  }

  pushWallHungAllowance();
  pushCeilingPanelsAllowance();
  pushCeilingSlopedAllowance();
  pushShowerNicheAllowance();

  return lines;
}

const floorFinishMaterialDelta: Record<Selection["floor_finish"], number> = {
  wetroom_vinyl: -150,
  ceramic_tile_standard: 0,
  ceramic_tile_premium: 350,
  microcement: 0,
  keep: 0,
};

const wallFinishMaterialDelta: Record<Selection["wall_finish"], number> = {
  wetroom_vinyl: -140,
  ceramic_tile_standard: 0,
  ceramic_tile_premium: 320,
  painted_walls: 0,
  keep: 0,
};

const fixtureTierMaterialAddon: Record<string, Record<Selection["fixtures_tier"], number>> = {
  install_toilet: { basic: 0, standard: 1900, premium: 5200 },
  install_sink_and_faucet: { basic: 0, standard: 2000, premium: 5400 },
  install_shower_fixture: { basic: 0, standard: 2300, premium: 5800 },
  install_shower_screen: { basic: 0, standard: 1500, premium: 3600 },
};

function getMaterialAdjustment(taskKey: string, selections: Selection): number {
  let delta = 0;
  if (taskKey === "install_floor_tiles_or_vinyl") {
    delta += floorFinishMaterialDelta[selections.floor_finish];
  }
  if (taskKey === "install_wall_tiles") {
    delta += wallFinishMaterialDelta[selections.wall_finish];
  }
  const tierAddon = fixtureTierMaterialAddon[taskKey];
  if (tierAddon) {
    delta += tierAddon[selections.fixtures_tier];
  }
  return delta;
}

const layoutFixtureIntentIds = ["replace_toilet", "replace_sink_vanity", "replace_shower", "add_bathtub"];

function computeLayoutFixtureChanges(intents: IntentMap) {
  return layoutFixtureIntentIds.reduce((sum, key) => sum + (intents[key] ? 1 : 0), 0);
}

function computeQuantity(
  taskKey: string,
  context: {
    room: Record<AreaField, number | null>;
    fixtures: Fixtures;
    areaWithWasteFloor: number;
    areaWithWasteWalls: number;
    intents: IntentMap;
    nonTiledWallArea: number | null;
    flags: Set<string>;
    selections: Selection;
    needsConfirmations: Set<string>;
    surfacesChanged: boolean;
  }
): number {
  const { room, fixtures, areaWithWasteFloor, areaWithWasteWalls, intents, nonTiledWallArea, surfacesChanged, selections } =
    context;
  switch (taskKey) {
    case "demolish_remove_floor_tiles":
    case "install_floor_tiles_or_vinyl":
    case "install_floor_microcement":
    case "apply_waterproof_membrane_floor":
      return areaWithWasteFloor;
    case "demolish_remove_wall_tiles":
    case "apply_waterproof_membrane_walls":
    case "install_wall_tiles":
      return areaWithWasteWalls;
    case "grout_and_seal": {
      const floorGroutArea =
        selections.floor_finish === "microcement" || selections.floor_finish === "keep"
          ? 0
          : room.floor_area_m2 || 0;
      const wallGroutArea = selections.wall_finish === "keep" ? 0 : room.wet_zone_wall_area_m2 || 0;
      return applyMinWaste(floorGroutArea + wallGroutArea, 1.05, 2);
    }
    case "install_shower_screen":
      return intents.replace_shower && fixtures.shower ? Math.max(1, fixtures.shower) : 0;
    case "demolish_remove_old_fixtures":
      return computeFixtureRemovalQty(intents, fixtures, surfacesChanged);
    case "install_toilet":
      return intents.replace_toilet && fixtures.toilet ? fixtures.toilet : 0;
    case "install_sink_and_faucet":
      return intents.replace_sink_vanity && fixtures.sink ? fixtures.sink : 0;
    case "install_shower_fixture":
      return intents.replace_shower && fixtures.shower ? fixtures.shower : 0;
    case "replace_floor_drain":
      return 1;
    case "rough_in_new_piping":
      return Math.max(4, fixtures.toilet + fixtures.sink + fixtures.shower + fixtures.bathtub);
    case "install_floor_heating_cable":
      if (!intents.add_underfloor_heating) {
        return 0;
      }
      const floorAreaQty = areaWithWasteFloor || 1;
      return floorAreaQty;
    case "install_light_fixtures":
      return intents.update_lighting ? 4 : 0;
    case "install_electrical_outlets":
      return intents.update_lighting ? 2 : 0;
    case "upgrade_electrical_safety":
    case "final_electrical_inspection":
      return intents.update_lighting || intents.add_underfloor_heating ? 1 : 0;
    case "install_exhaust_fan":
    case "duct_adjustment_sealing":
      return intents.improve_ventilation ? 1 : 0;
    case "prep_and_paint_ceiling":
      return intents.paint_ceiling ? applyMin(room.ceiling_area_m2, 5) : 0;
    case "paint_trim_and_door":
      return 1;
    case "finish_wall_paint":
      if (selections.wall_finish === "painted_walls") {
        return room.wall_area_m2 && room.wall_area_m2 > 0.5 ? room.wall_area_m2 : 0;
      }
      return nonTiledWallArea && nonTiledWallArea > 0.5 ? nonTiledWallArea : 0;
    case "protect_other_areas":
    case "remove_construction_debris":
    case "construction_waste_disposal":
    case "final_cleanup":
      return 1;
    case "project_coordination_fee":
    case "permit_or_board_application":
    case "issue_wetroom_certificate":
    case "handover_inspection":
      return 1;
    case "demolish_chase_for_pipes":
    case "construct_support_structures":
      return 1;
    case "demolition_layout_change_allowance":
    case "plumbing_layout_change_reroute_allowance":
    case "substrate_layout_change_allowance":
    case "documentation_layout_change_allowance":
      return intents.change_layout ? 1 : 0;
    case "layout_change_area_allowance":
      return intents.change_layout ? Math.max(1, Math.round(room.floor_area_m2 || 0)) : 0;
    case "layout_change_wet_zone_allowance":
      return intents.change_layout ? Math.max(1, Math.round((room.wet_zone_wall_area_m2 || 0) * 0.5)) : 0;
    case "layout_change_fixture_allowance":
      return intents.change_layout ? Math.max(1, computeLayoutFixtureChanges(intents)) : 0;
    case "install_wall_backer_boards":
    case "repair_patch_walls":
      return applyMin(room.wall_area_m2, 5);
    case "level_floor_screed":
      return applyMinWaste(room.floor_area_m2, 1.0, 4);
    default:
      return 0;
  }
}

function deriveTaskNote(taskKey: string, selections: Selection): string | undefined {
  if (taskKey === "install_floor_tiles_or_vinyl") {
    return selections.floor_finish === "wetroom_vinyl" ? "Vinyl variant" : selections.floor_finish;
  }
  if (taskKey === "install_wall_tiles") {
    return selections.wall_finish;
  }
  return undefined;
}

function applyMinWaste(value: number | null, wasteMultiplier: number, min: number): number {
  if (!value || value <= 0) return 0;
  return Math.max(value * wasteMultiplier, min);
}

function applyMin(value: number | null, min: number): number {
  if (!value || value <= 0) return 0;
  return Math.max(value, min);
}

function computeNonTiledWallArea(room: Record<AreaField, number | null>, selections: Selection): number | null {
  if (!isTiledOrVinyl(selections.wall_finish)) return null;
  if (room.wall_area_m2 == null || room.wet_zone_wall_area_m2 == null) return null;
  return Math.max(0, room.wall_area_m2 - room.wet_zone_wall_area_m2);
}

function summarizeTradeGroups(tasks: TaskLine[]) {
  const map = new Map<string, number>();
  for (const t of tasks) {
    map.set(t.trade_group, (map.get(t.trade_group) || 0) + t.subtotal_sek);
  }
  return Array.from(map.entries()).map(([trade_group, subtotal_sek]) => ({
    trade_group,
    subtotal_sek: round(subtotal_sek),
  }));
}

type PlausibilityProfile = "refresh" | "full_rebuild" | "major" | undefined;

function derivePlausibilityBand(intents: IntentMap, selections: Selection, profile?: PlausibilityProfile): string {
  if (profile === "refresh") return "PB-REFRESH";
  const surfaceChange = intents.change_floor_finish || intents.change_wall_finish;
  const fixturesOnly = intents.replace_toilet || intents.replace_shower || intents.replace_sink_vanity || intents.add_bathtub;
  if (!surfaceChange && fixturesOnly) return "PB-001";
  if (intents.change_layout || selections.fixtures_tier === "premium") return "PB-003";
  if (surfaceChange) return "PB-002";
  return "PB-001";
}

function buildWarnings(sekPerM2: number | null, band: string, total: number, profile?: PlausibilityProfile): string[] {
  const warnings: string[] = [];
  const lowBand = profile === "refresh" ? 2000 : 8000;
  const highBand = profile === "refresh" ? 12000 : 30000;
  if (sekPerM2 && (sekPerM2 < lowBand || sekPerM2 > highBand)) {
    warnings.push(`Total per m² is ${sekPerM2.toFixed(0)} SEK/m² which is outside ${lowBand.toLocaleString()}–${highBand.toLocaleString()} guideline.`);
  }
  warnings.push(`Plausibility band: ${band}`);
  warnings.push(`Total with contingency: ${Math.round(total)} SEK`);
  return warnings;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getDefaultIntentsFromCatalog(): IntentMap {
  const catalog = loadCatalog();
  const defaults: IntentMap = {};
  for (const intent of catalog.intents || []) {
    defaults[intent.id] = intent.defaulting === "on";
  }
  return defaults;
}

export function getProjectRoot(): string {
  return path.resolve(__dirname, "../..");
}

function isTiledOrVinyl(finish: Selection["wall_finish"] | undefined) {
  return finish === "wetroom_vinyl" || finish === "ceramic_tile_standard" || finish === "ceramic_tile_premium";
}

function detectWallsFullyTiled(notes: string, assumptions: string[]): boolean {
  const haystack = `${notes || ""} ${assumptions?.join(" ") || ""}`.toLowerCase();
  return (
    haystack.includes("helkaklad") ||
    haystack.includes("hela väg") ||
    haystack.includes("fullt kaklad") ||
    haystack.includes("fullt kaklade") ||
    haystack.includes("fully tiled") ||
    haystack.includes("entire wall") ||
    haystack.includes("full height tile")
  );
}

function computeFixtureRemovalQty(intents: IntentMap, fixtures: Fixtures, surfacesChanged: boolean): number {
  const replacements =
    (intents.replace_toilet ? 1 : 0) +
    (intents.replace_sink_vanity ? 1 : 0) +
    (intents.replace_shower ? 1 : 0) +
    (intents.add_bathtub ? 1 : 0);

  const existing =
    (fixtures.toilet || 0) + (fixtures.sink || 0) + (fixtures.shower || 0) + (fixtures.bathtub || 0);

  if (surfacesChanged) {
    return Math.max(existing, replacements);
  }
  return replacements;
}

export {
  mergeRoomWithOverrides,
  computeNeedsConfirmations,
  computeNonTiledWallArea,
  computeFixtureRemovalQty,
};
