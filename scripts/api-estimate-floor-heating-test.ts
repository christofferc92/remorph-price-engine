import { EventEmitter } from "events";
import { createRequest, createResponse } from "node-mocks-http";

import { handleEstimateRequest } from "../apps/price-engine-service/src/server.ts";

const minimalCanonicalPayload = {
  analysis: {
    room_type: "bathroom",
    bathroom_size_estimate: "between_4_and_7_sqm",
    bathroom_size_confidence: 0.72,
    detected_fixtures: {
      shower_present: true,
      bathtub_present: false,
      toilet_present: true,
      sink_present: true,
    },
    layout_features: {
      shower_zone_visible: true,
      wet_room_layout: false,
      tight_space: false,
      irregular_geometry: false,
    },
    ceiling_features: {
      ceiling_visible: true,
      sloped_ceiling_detected: false,
    },
    condition_signals: {
      overall_condition: "average",
    },
    image_quality: {
      sufficient_for_estimate: true,
      issues: [],
    },
    analysis_confidence: 0.81,
  },
  overrides: {
    bathroom_size_final: "between_4_and_7_sqm",
    bathroom_size_source: "ai_estimated",
  },
  outcome: {
    shower_type: "walk_in_shower_glass",
    bathtub: "no",
    toilet_type: "wall_hung",
    vanity_type: "vanity_with_cabinet",
    wall_finish: "tiles_all_walls",
    floor_finish: "standard_ceramic_tiles",
    ceiling_type: "painted_ceiling",
    layout_change: "no",
    shower_niches: "none",
    floor_heating: "floor_heating_on",
  },
};

const siteConditionsBlock = {
  floor_elevator: "apt_no_elevator_1_2",
  carry_distance: "20_50m",
  parking_loading: "limited",
  work_time_restrictions: "strict",
  permits_brf: "permit_required",
  access_constraints_notes: "Deliveries only after 08:30.",
  occupancy: "living_in_partly",
  container_possible: "no",
};

const ALLOWANCE_TASK_KEYS = new Set([
  "site_conditions_access_labor_hours",
  "site_conditions_waste_logistics_hours",
  "site_conditions_admin_hours",
]);

async function runScenario(
  description: string,
  payload: Record<string, unknown>,
  expectation: (estimate: any, res: ReturnType<typeof createResponse>, payload: Record<string, unknown>) => void
) {
  const req = createRequest({
    method: "POST",
    url: "/api/estimate",
    body: JSON.parse(JSON.stringify(payload)),
    headers: { "content-type": "application/json" },
  });
  const res = createResponse({ eventEmitter: EventEmitter });

  await handleEstimateRequest(req, res);

  if (res.statusCode !== 200) {
    throw new Error(
      `Expected 200 but got ${res.statusCode} ${JSON.stringify(res._getJSONData() ?? {})}`
    );
  }

  const estimate = res._getJSONData()?.estimate;
  if (!estimate) {
    throw new Error("Response missing estimate payload");
  }

  assertEstimateBasics(estimate);
  expectation(estimate, res, payload);
  console.log(`Scenario passed: ${description}`);
}

function assertEstimateBasics(estimate: any) {
  const assertInteger = (value: unknown, label: string) => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`Expected integer for ${label}, got ${value}`);
    }
  };

  if (!estimate.estimate_quality) {
    throw new Error("Missing estimate_quality");
  }
  if (!estimate.estimate_range) {
    throw new Error("Missing estimate_range");
  }
  assertInteger(estimate.estimate_range.low_sek, "estimate_range.low_sek");
  assertInteger(estimate.estimate_range.mid_sek, "estimate_range.mid_sek");
  assertInteger(estimate.estimate_range.high_sek, "estimate_range.high_sek");
  assertInteger(estimate.labor_range?.min_sek, "labor_range.min_sek");
  assertInteger(estimate.labor_range?.max_sek, "labor_range.max_sek");
  assertInteger(estimate.material_range?.min_sek, "material_range.min_sek");
  assertInteger(estimate.material_range?.max_sek, "material_range.max_sek");
  if (!estimate.confidence_tier) {
    throw new Error("Missing confidence_tier");
  }
  if (!Array.isArray(estimate.confidence_reasons)) {
    throw new Error("Missing confidence_reasons");
  }
  if (!Array.isArray(estimate.line_items)) {
    throw new Error("line_items missing");
  }
  if (!estimate.rot_summary) {
    throw new Error("rot_summary missing");
  }
  if (!estimate.line_items.some((item: any) => typeof item.rot_eligible === "boolean")) {
    throw new Error("line_items missing rot_eligible flag");
  }

  const eligibleLabor = estimate.line_items
    .filter((item: any) => item.rot_eligible)
    .reduce((sum: number, item: any) => sum + Math.round(item.labor_sek ?? 0), 0);
  if (eligibleLabor !== estimate.rot_summary.rot_eligible_labor_sek) {
    throw new Error("rot_summary.rot_eligible_labor_sek seems off");
  }
  if (!Number.isInteger(estimate.rot_summary.rot_deduction_sek)) {
    throw new Error("rot_summary.rot_deduction_sek must be integer");
  }
  if (!Number.isInteger(estimate.rot_summary.total_after_rot_sek)) {
    throw new Error("rot_summary.total_after_rot_sek must be integer");
  }
  const expectedAfterRot =
    Math.max(Math.round(estimate.totals?.grand_total_sek ?? 0) - estimate.rot_summary.rot_deduction_sek, 0);
  if (expectedAfterRot !== estimate.rot_summary.total_after_rot_sek) {
    throw new Error("rot_summary.total_after_rot_sek mismatch");
  }
}

function assertNoAllowances(estimate: any) {
  const allowanceItems = (estimate.line_items || []).filter((item: any) => ALLOWANCE_TASK_KEYS.has(item.key));
  if (allowanceItems.length) {
    throw new Error("Unexpected site condition allowance line items when none were provided");
  }
  if (estimate.site_conditions_effect) {
    throw new Error("site_conditions_effect should be absent when no site_conditions were provided");
  }
}

function assertAllowancesPresent(estimate: any) {
  const allowanceItems = (estimate.line_items || []).filter((item: any) =>
    ALLOWANCE_TASK_KEYS.has(item.key)
  );
  if (allowanceItems.length === 0) {
    throw new Error("Expected site condition allowance line items but found none");
  }
  const effect = estimate.site_conditions_effect;
  if (!effect) {
    throw new Error("site_conditions_effect missing despite site_conditions input");
  }
  const totalSubtotal = allowanceItems.reduce((sum: number, item: any) => sum + Number(item.subtotal_sek ?? 0), 0);
  if (effect.added_total_sek !== Math.round(totalSubtotal)) {
    throw new Error("site_conditions_effect.total does not match allowance line items");
  }
  const reasonSet = new Set(effect.reason_codes || []);
  if (!reasonSet.has("FLOOR_NO_ELEVATOR_1_2") || !reasonSet.has("PERMIT_REQUIRED")) {
    throw new Error("site_conditions_effect missing expected reason codes");
  }
}

function assertMetadataEcho(res: ReturnType<typeof createResponse>, expectedSiteConditions: Record<string, unknown>) {
  const echoed = res._getJSONData()?.metadata?.contract?.site_conditions;
  if (!echoed) {
    throw new Error("Response missing metadata.contract.site_conditions");
  }
  for (const [key, value] of Object.entries(expectedSiteConditions)) {
    if (echoed[key as keyof typeof echoed] !== value) {
      throw new Error(`Site conditions metadata mismatch for ${key}`);
    }
  }
}

async function runTest() {
  let baselineWidth: number | null = null;
  await runScenario("no site_conditions payload", minimalCanonicalPayload, (estimate) => {
    assertNoAllowances(estimate);
    const width = estimate.estimate_range.high_sek - estimate.estimate_range.low_sek;
    if (width < 4000) throw new Error("Range width should respect minimum spread");
    const low = estimate.estimate_range?.low_sek;
    const mid = estimate.estimate_range?.mid_sek;
    const high = estimate.estimate_range?.high_sek;
    if (low == null || mid == null || high == null) {
      throw new Error("Estimate range numbers missing");
    }
    if (!(low < mid && mid < high)) {
      throw new Error("Estimate range values must stay ordered");
    }
    baselineWidth = width;
  });
  const measurementPayload = {
    ...minimalCanonicalPayload,
    measurementOverride: { length: 2.2, width: 3.1, area: 6.82, ceilingHeight: 2.4 },
    roomMeasurements: {
      floor_area_m2: 6.8,
      wall_area_m2: 20,
      ceiling_area_m2: 7,
      wet_zone_wall_area_m2: 16,
    },
    site_conditions: siteConditionsBlock,
  };
  await runScenario("with site_conditions + measurements", measurementPayload, (estimate, res, payload) => {
    assertAllowancesPresent(estimate);
    assertMetadataEcho(res, payload.site_conditions as Record<string, unknown>);
    const low = estimate.estimate_range?.low_sek;
    const mid = estimate.estimate_range?.mid_sek;
    const high = estimate.estimate_range?.high_sek;
    if (low == null || mid == null || high == null) {
      throw new Error("Estimate range numbers missing");
    }
    const width = high - low;
    if (width < 4000) throw new Error("Tightened range should still obey minimum");
    if (baselineWidth !== null && width >= baselineWidth) {
      throw new Error("Range should tighten when confirmations are provided");
    }
    if (!(low < mid && mid < high)) {
      throw new Error("Estimate range values must stay ordered");
    }
  });
  console.log("Site conditions allowance regression test passed.");
}

runTest().catch((error) => {
  console.error("Regression test failed.", error);
  process.exit(1);
});
