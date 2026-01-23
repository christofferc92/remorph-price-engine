import type { IntentMap } from "./scopeCompiler.ts";
import type { Selection } from "./estimator.ts";
import type { UserOutcomeContract, FloorFinishOption, WallFinishOption } from "../../src/shared/canonicalEstimatorContract.ts";

const INTENT_KEYS: Array<keyof IntentMap> = [
  "change_floor_finish",
  "change_wall_finish",
  "add_underfloor_heating",
  "replace_toilet",
  "replace_sink_vanity",
  "replace_shower",
  "add_bathtub",
  "update_lighting",
  "improve_ventilation",
  "change_layout",
  "paint_ceiling",
] as const;

function createBaseIntentMap(): IntentMap {
  return INTENT_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as IntentMap);
}

function determineFixturesTier(value: UserOutcomeContract): Selection["fixtures_tier"] {
  const premiumSignals = [
    value.floor_finish === "large_format_tiles",
    value.floor_finish === "microcement_seamless",
    value.wall_finish === "large_format_tiles_all_walls",
    value.shower_type === "walk_in_shower_glass",
    value.bathtub === "yes",
    value.vanity_type === "vanity_with_cabinet",
  ];
  if (premiumSignals.some(Boolean)) return "premium";
  return "standard";
}

function mapFloorFinish(option: FloorFinishOption): Selection["floor_finish"] {
  switch (option) {
    case "standard_ceramic_tiles":
      return "ceramic_tile_standard";
    case "large_format_tiles":
      return "ceramic_tile_premium";
    case "microcement_seamless":
      return "microcement";
    case "vinyl_wet_room_mat":
      return "wetroom_vinyl";
    case "keep":
      return "keep";
  }
}

function mapWallFinish(option: WallFinishOption): Selection["wall_finish"] {
  switch (option) {
    case "tiles_all_walls":
    case "tiles_wet_zone_only":
      return "ceramic_tile_standard";
    case "large_format_tiles_all_walls":
      return "ceramic_tile_premium";
    case "painted_walls_only":
      return "painted_walls";
    case "keep":
      return "keep";
  }
}

function buildSelections(outcome: UserOutcomeContract): Selection {
  return {
    floor_finish: mapFloorFinish(outcome.floor_finish),
    wall_finish: mapWallFinish(outcome.wall_finish),
    fixtures_tier: determineFixturesTier(outcome),
    pipe_reroute: outcome.layout_change === "yes",
    needs_brf_docs: outcome.layout_change === "yes",
    shower_niches: outcome.shower_niches ?? "none",
    toilet_type: outcome.toilet_type,
    ceiling_type: outcome.ceiling_type,
  };
}

function buildIntents(outcome: UserOutcomeContract): IntentMap {
  const intents = createBaseIntentMap();
  intents.change_floor_finish = outcome.floor_finish !== "keep";
  intents.change_wall_finish = outcome.wall_finish !== "keep";
  intents.replace_shower = outcome.shower_type !== "keep" && outcome.shower_type !== "no_shower";
  intents.add_bathtub = outcome.bathtub !== "keep" && outcome.bathtub === "yes";
  intents.replace_toilet = outcome.toilet_type !== "keep";
  intents.replace_sink_vanity =
    outcome.vanity_type !== "keep" && outcome.vanity_type !== "no_sink";
  intents.change_layout = outcome.layout_change === "yes";
  intents.paint_ceiling = outcome.ceiling_type !== "keep";
  intents.add_underfloor_heating = outcome.floor_heating === "floor_heating_on";
  return intents;
}

export function mapOutcomeToEstimatorInputs(outcome: UserOutcomeContract) {
  const intents = buildIntents(outcome);
  const selections = buildSelections(outcome);
  const mappingLog = {
    change_layout: intents.change_layout,
    change_floor_finish: intents.change_floor_finish,
    change_wall_finish: intents.change_wall_finish,
    replace_shower: intents.replace_shower,
    add_bathtub: intents.add_bathtub,
    replace_toilet: intents.replace_toilet,
    replace_sink_vanity: intents.replace_sink_vanity,
    paint_ceiling: intents.paint_ceiling,
    pipe_reroute: selections.pipe_reroute,
    needs_brf_docs: selections.needs_brf_docs,
    shower_niches: selections.shower_niches,
    ceiling_type: selections.ceiling_type,
    floor_heating: outcome.floor_heating,
  };
  return { intents, selections, mappingLog };
}
