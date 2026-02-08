/**
 * Regional pricing adjustments for Swedish markets
 * Based on labor rate variations across regions
 */

export const REGIONAL_MULTIPLIERS: Record<string, number> = {
    // Stockholm region - highest labor costs
    'stockholm': 1.15,
    'solna': 1.15,
    'sundbyberg': 1.15,
    'nacka': 1.15,
    'huddinge': 1.12,

    // Gothenburg region
    'göteborg': 1.08,
    'gothenburg': 1.08,
    'mölndal': 1.08,

    // Malmö region
    'malmö': 1.05,
    'malmo': 1.05,
    'lund': 1.05,

    // Uppsala
    'uppsala': 1.10,

    // Other major cities
    'västerås': 1.02,
    'örebro': 1.00,
    'linköping': 1.00,
    'helsingborg': 1.03,
    'jönköping': 0.98,
    'norrköping': 0.98,
    'umeå': 1.00,

    // Smaller cities / rural areas
    'borlänge': 0.95,
    'falun': 0.95,
    'gävle': 0.97,
    'karlstad': 0.98,
    'växjö': 0.97,
    'halmstad': 1.00,

    // Default (national average)
    'default': 1.00
};

/**
 * Get regional pricing multiplier for a given location
 * @param location City or region name (case-insensitive)
 * @returns Multiplier to apply to labor costs (1.0 = national average)
 */
export function getRegionalMultiplier(location?: string): number {
    if (!location) return REGIONAL_MULTIPLIERS.default;

    const normalized = location.toLowerCase().trim();
    return REGIONAL_MULTIPLIERS[normalized] ?? REGIONAL_MULTIPLIERS.default;
}

/**
 * Get region name for display
 */
export function getRegionName(location?: string): string {
    if (!location) return 'Riksgenomsnitt';

    const normalized = location.toLowerCase().trim();
    const multiplier = REGIONAL_MULTIPLIERS[normalized];

    if (!multiplier) return 'Riksgenomsnitt';

    // Capitalize first letter
    return location.charAt(0).toUpperCase() + location.slice(1);
}

/**
 * Apply regional pricing adjustment to an estimate
 * Only affects labor costs, not materials
 */
export function applyRegionalPricing(
    unitPrice: number,
    itemType: 'labor' | 'material' | 'mixed' | 'other',
    laborShare: number = 1.0,
    location?: string
): number {
    const multiplier = getRegionalMultiplier(location);

    if (itemType === 'labor') {
        return Math.round(unitPrice * multiplier);
    } else if (itemType === 'mixed') {
        const laborPart = unitPrice * laborShare;
        const materialPart = unitPrice * (1 - laborShare);
        return Math.round((laborPart * multiplier) + materialPart);
    } else {
        // Material or other - no regional adjustment
        return unitPrice;
    }
}
