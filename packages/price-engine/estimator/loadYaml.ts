import fs from "fs";
import path from "path";
import YAML from "yaml";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export type Catalog = {
  intents: { id: string; defaulting?: string }[];
  scope_rules: ScopeRule[];
  tasks: CatalogTask[];
};

export type ScopeRule = {
  id: string;
  if_any_intents?: string[];
  if_any_flags?: string[];
  if_all_flags?: string[];
  set_flags: string[];
};

export type CatalogTask = {
  task_key: string;
  trade_group: string;
};

export type RateCard = {
  task_rates: Record<
    string,
    {
      unit: string;
      labor_sek_per_unit: number;
      material_sek_per_unit: number;
      min_charge_sek?: number;
    }
  >;
  overhead: {
    project_management_pct: number;
    contingency_pct: number;
  };
};

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function readYamlFile<T>(relativePath: string): T {
  const filePath = path.resolve(REPO_ROOT, relativePath);
  const file = fs.readFileSync(filePath, "utf-8");
  return YAML.parse(file) as T;
}

export function loadCatalog(): Catalog {
  return readYamlFile<Catalog>("catalog/bathroom_catalog.yaml");
}

export function loadResearchRequirements(): unknown {
  return readYamlFile<unknown>("catalog/bathroom_research_requirements.yaml");
}

export function loadRateCard(): RateCard {
  return readYamlFile<RateCard>("packages/price-engine/estimator/ratecard.placeholder.yaml");
}
