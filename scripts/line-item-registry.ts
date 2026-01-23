export type AllowanceDefinition = {
  key: string;
  trade_group: string;
  qty_driver: string;
  source_reference: string;
};

export const allowanceDefinitions: AllowanceDefinition[] = [
  {
    key: "toilet_wall_hung_allowance",
    trade_group: "plumbing",
    qty_driver:
      "One allowance when replacing a wall-hung toilet, even if `install_toilet` is excluded.",
    source_reference: "packages/price-engine/estimator/estimator.ts (wallHungAllowance)",
  },
  {
    key: "ceiling_panels_allowance",
    trade_group: "carpentry_substrate",
    qty_driver: "One allowance when painting a ceiling with moisture-resistant panels.",
    source_reference: "packages/price-engine/estimator/estimator.ts (pushCeilingPanelsAllowance)",
  },
  {
    key: "ceiling_sloped_allowance",
    trade_group: "painting",
    qty_driver: "One allowance when painting a sloped ceiling (with or without panels).",
    source_reference: "packages/price-engine/estimator/estimator.ts (pushCeilingSlopedAllowance)",
  },
  {
    key: "shower_niche_allowance",
    trade_group: "carpentry_substrate",
    qty_driver: "Allowance per shower niche when replacing the shower (zero, one, or two).",
    source_reference: "packages/price-engine/estimator/estimator.ts (pushShowerNicheAllowance)",
  },
];
