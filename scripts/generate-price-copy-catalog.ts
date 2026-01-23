import fs from "fs";
import path from "path";

import { loadCatalog } from "../packages/price-engine/estimator/loadYaml.ts";
import { allowanceDefinitions } from "./line-item-registry.ts";

const catalog = loadCatalog();
const catalogTasks = catalog.tasks ?? [];

const lineItemKeys = new Set(catalogTasks.map((task) => task.task_key));
const tradeGroups = new Set(catalogTasks.map((task) => task.trade_group));

for (const allowance of allowanceDefinitions) {
  lineItemKeys.add(allowance.key);
  tradeGroups.add(allowance.trade_group);
}

const estimatorPath = path.resolve("packages/price-engine/estimator/estimator.ts");
const estimatorSource = fs.readFileSync(estimatorPath, "utf-8");
const includeByTradeMatch = estimatorSource.match(/const\s+includeByTrade:[\s\S]+?{([\s\S]*?)};/);

if (!includeByTradeMatch) {
  throw new Error("Unable to locate includeByTrade definition in estimator.ts");
}

const includeByTradeBody = includeByTradeMatch[1];
const tradeGroupKeyRegex = /([a-z0-9_]+)\s*:/gi;
let match: RegExpExecArray | null;
while ((match = tradeGroupKeyRegex.exec(includeByTradeBody))) {
  tradeGroups.add(match[1]);
}

const catalogOutput = {
  generated_at: new Date().toISOString(),
  trade_groups: Array.from(tradeGroups).sort((a, b) => a.localeCompare(b)),
  line_item_keys: Array.from(lineItemKeys).sort((a, b) => a.localeCompare(b)),
};

const outputPath = path.resolve("scripts", "price_copy_catalog.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(catalogOutput, null, 2));

console.log(
  `Generated price copy catalog with ${catalogOutput.trade_groups.length} trade groups and ${catalogOutput.line_item_keys.length} line items.`
);
