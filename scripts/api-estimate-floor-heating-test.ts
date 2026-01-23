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

async function runTest() {
  const req = createRequest({
    method: "POST",
    url: "/api/estimate",
    body: minimalCanonicalPayload,
    headers: { "content-type": "application/json" },
  });
  const res = createResponse({ eventEmitter: EventEmitter });

  await handleEstimateRequest(req, res);

  if (res.statusCode !== 200) {
    throw new Error(
      `Expected 200 but got ${res.statusCode} ${JSON.stringify(res._getJSONData() ?? {})}`
    );
  }

  console.log("POST /api/estimate accepted canonical payload with floor_heating.");
  console.log("Response id:", res._getJSONData()?.id);
}

runTest().catch((error) => {
  console.error("Regression test failed.", error);
  process.exit(1);
});
