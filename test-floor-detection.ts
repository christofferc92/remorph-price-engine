/**
 * Test floor-only detection patterns
 */

// Simulate the detection logic
function testFloorOnlyDetection(userDescription: string): boolean {
    const lower = userDescription.toLowerCase();

    // Detect floor-only intent with multiple patterns
    const floorOnlyPatterns = [
        /\b(bara|endast|only|just)\s+(golv|floor|byta\s+golv)/,  // "bara golv", "only floor"
        /\b(byt|byta|change|replace)\s+(golv|flooring|floor)\s+(till|to)/,  // "byt golv till", "change flooring to"
        /\b(nytt|ny|new)\s+(golv|floor|flooring)/,  // "nytt golv"
        /\b(golv|floor|flooring)\s+(till|to)\s+\w+/,  // "golv till microcement"
    ];

    const hasFloorKeyword = lower.match(/\b(golv|floor|flooring|microcement|klinker|vinyl|parkett)\b/);
    const hasNonFloorKeyword = lower.match(/\b(vägg|wall|kakel|tile|toalett|toilet|dusch|shower|badkar|bath|handfat|sink|kran|faucet|armatur|fixture)\b/);

    const isFloorOnly = floorOnlyPatterns.some(pattern => lower.match(pattern)) ||
        (hasFloorKeyword && !hasNonFloorKeyword);

    return isFloorOnly;
}

// Test cases
const testCases = [
    "change flooring to microcement",
    "byt golv till microcement",
    "bara golv",
    "only floor",
    "nytt golv",
    "golv till klinker",
    "totalrenovering",
    "byt kakel och golv",
    "new flooring",
    "replace floor to vinyl"
];

console.log('Testing floor-only detection patterns:\n');
testCases.forEach(desc => {
    const result = testFloorOnlyDetection(desc);
    console.log(`"${desc}" => ${result ? '✅ FLOOR-ONLY' : '❌ NOT floor-only'}`);
});
