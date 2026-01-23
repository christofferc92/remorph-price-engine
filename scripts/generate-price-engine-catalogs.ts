import fs from "fs";
import path from "path";

import { loadCatalog, loadRateCard } from "../packages/price-engine/estimator/loadYaml.ts";
import {
  bathtubOptions,
  ceilingTypeOptions,
  floorFinishOptions,
  layoutChangeOptions,
  showerNichesOptions,
  showerTypeOptions,
  sizeBucketOptions,
  toiletTypeOptions,
  vanityTypeOptions,
  wallFinishOptions,
} from "../src/shared/canonicalEstimatorContract.ts";
import { allowanceDefinitions } from "./line-item-registry.ts";

const docsDir = path.resolve("docs");
fs.mkdirSync(docsDir, { recursive: true });

const catalog = loadCatalog();
const rateCard = loadRateCard();

const catalogTasks = (catalog.tasks || []).map((task) => {
  const rate = rateCard.task_rates?.[task.task_key];
  return {
    key: task.task_key,
    trade_group: task.trade_group,
    unit: rate?.unit ?? "unit",
    qty_driver: task.qty_driver ?? null,
    qty_rules_source_ids: task.qty_rules_source_ids ?? [],
    source_ids: task.source_ids ?? [],
  };
});

const allowances = allowanceDefinitions.map((entry) => {
  const rate = rateCard.task_rates?.[entry.key];
  return {
    key: entry.key,
    trade_group: entry.trade_group,
    unit: rate?.unit ?? "unit",
    qty_driver: entry.qty_driver,
    source_notes: entry.source_reference,
  };
});

const lineItemCatalog = [...catalogTasks, ...allowances].sort((a, b) => a.key.localeCompare(b.key));
fs.writeFileSync(path.join(docsDir, "line_item_catalog.json"), JSON.stringify(lineItemCatalog, null, 2));

const optionEnumsCatalog = {
  bathroom_size_final: sizeBucketOptions,
  shower_type: showerTypeOptions,
  bathtub: bathtubOptions,
  toilet_type: toiletTypeOptions,
  vanity_type: vanityTypeOptions,
  wall_finish: wallFinishOptions,
  floor_finish: floorFinishOptions,
  ceiling_type: ceilingTypeOptions,
  layout_change: layoutChangeOptions,
  shower_niches: showerNichesOptions,
};
fs.writeFileSync(path.join(docsDir, "option_enums_catalog.json"), JSON.stringify(optionEnumsCatalog, null, 2));

console.log("Generated docs/line_item_catalog.json and docs/option_enums_catalog.json");
