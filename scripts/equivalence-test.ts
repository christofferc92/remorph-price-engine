import { readFileSync, readdirSync } from "fs";
import path from "path";

import {
  buildFrontendEstimate,
  buildNormalizedFromContract,
  computeOutlierFlags,
  determineProfileFromOutcome,
  runEstimateFromNormalized,
  evaluateContract,
} from "../packages/price-engine/src/index.ts";

const fixturesDir = path.resolve(__dirname, "fixtures", "price-engine");
const filenames = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));
if (!filenames.length) {
  throw new Error("No fixtures found for price-engine equivalence test");
}

function normalizeLineItems(items: Array<Record<string, any>>) {
  return items
    .map((item) => ({
      key: String(item.key || item.task_key || item.id),
      subtotal_sek: Number(item.subtotal_sek ?? 0),
      labor_sek: Number(item.labor_sek ?? 0),
      material_sek: Number(item.material_sek ?? 0),
      trade_group: String(item.trade_group ?? ""),
      qty: Number(item.qty ?? 0),
      unit: String(item.unit ?? ""),
      note: item.note ? String(item.note) : undefined,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function compareArrays(a: unknown[], b: unknown[]) {
  if (a.length !== b.length) return false;
  const normalize = (arr: unknown[]) => [...arr].sort((left, right) => {
    const leftText = JSON.stringify(left);
    const rightText = JSON.stringify(right);
    return leftText.localeCompare(rightText);
  });
  const sortedA = normalize(a);
  const sortedB = normalize(b);
  return sortedA.every((value, index) => {
    const other = sortedB[index];
    return JSON.stringify(value) === JSON.stringify(other);
  });
}

function compareTradeGroups(left: Array<Record<string, any>>, right: Array<Record<string, any>>) {
  const normalize = (items: Array<Record<string, any>>) =>
    items
      .map((item) => ({ trade_group: String(item.trade_group), subtotal_sek: Number(item.subtotal_sek ?? 0) }))
      .sort((a, b) => a.trade_group.localeCompare(b.trade_group));
  return compareArrays(normalize(left), normalize(right));
}

function compareTotals(left: Record<string, number>, right: Record<string, number>) {
  const keys = ["base_subtotal_sek", "project_management_sek", "contingency_sek", "grand_total_sek"];
  return keys.every((key) => Number(left[key] ?? 0) === Number(right[key] ?? 0));
}

for (const filename of filenames) {
  const fixturePath = path.join(fixturesDir, filename);
  const contract = JSON.parse(readFileSync(fixturePath, "utf-8"));
  const imageId = path.basename(filename, ".json");

  const profile = determineProfileFromOutcome(contract.outcome);
  const normalized = buildNormalizedFromContract(contract, imageId);
  const referenceEstimate = runEstimateFromNormalized(normalized, profile, null);
  const referenceFlags = computeOutlierFlags(profile, referenceEstimate);
  const originalResponse = buildFrontendEstimate(referenceEstimate, normalized, referenceFlags);

  const extracted = evaluateContract(contract, { imageId });
  const extractedResponse = extracted.clientEstimate;

  const diffs: string[] = [];

  if (!compareTotals(originalResponse.totals, extractedResponse.totals)) {
    diffs.push("totals differ");
  }
  if (!compareTradeGroups(originalResponse.trade_group_totals, extractedResponse.trade_group_totals)) {
    diffs.push("trade_group_totals differ");
  }
  const normalizedLineItems = normalizeLineItems(originalResponse.line_items || []);
  const extractedLineItems = normalizeLineItems(extractedResponse.line_items || []);
  if (!compareArrays(normalizedLineItems, extractedLineItems)) {
    diffs.push("line_items differ");
  }

  if (!compareArrays(originalResponse.warnings || [], extractedResponse.warnings || [])) {
    diffs.push("warnings differ");
  }
  if (!compareArrays(originalResponse.assumptions || [], extractedResponse.assumptions || [])) {
    diffs.push("assumptions differ");
  }
  if (!compareArrays(originalResponse.needs_confirmation_ids || [], extractedResponse.needs_confirmation_ids || [])) {
    diffs.push("needs_confirmation_ids differ");
  }
  if (originalResponse.plausibility_band !== extractedResponse.plausibility_band) {
    diffs.push("plausibility_band differ");
  }

  if (diffs.length) {
    throw new Error(
      `Fixture ${filename} produced mismatched responses: ${diffs.join(", ")}`
    );
  }
}

console.log("Equivalence test passed for", filenames.length, "fixtures");
