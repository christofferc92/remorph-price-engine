import type { Catalog, ScopeRule } from "./loadYaml.ts";

export type IntentMap = Record<string, boolean>;

export function compileDerivedFlags(catalog: Catalog, intents: IntentMap): Set<string> {
  const flags = new Set<string>();
  const rules: ScopeRule[] = catalog.scope_rules || [];

  // Pass 1: rules triggered directly by intents
  for (const rule of rules) {
    if (rule.if_any_intents && intersects(intents, rule.if_any_intents)) {
      addFlags(flags, rule.set_flags);
    }
  }

  // Pass 2: fixpoint on flag-triggered rules
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      const anyFlags = rule.if_any_flags && hasAnyFlag(flags, rule.if_any_flags);
      const allFlags = rule.if_all_flags && hasAllFlags(flags, rule.if_all_flags);
      if (anyFlags || allFlags) {
        const beforeSize = flags.size;
        addFlags(flags, rule.set_flags);
        if (flags.size !== beforeSize) changed = true;
      }
    }
  }

  return flags;
}

function intersects(intents: IntentMap, list: string[]): boolean {
  return list.some((id) => intents[id]);
}

function hasAnyFlag(flags: Set<string>, list: string[]): boolean {
  return list.some((flag) => flags.has(flag));
}

function hasAllFlags(flags: Set<string>, list: string[]): boolean {
  return list.every((flag) => flags.has(flag));
}

function addFlags(flags: Set<string>, list?: string[]) {
  if (!list) return;
  for (const flag of list) flags.add(flag);
}
