

const ENDPOINT = 'http://localhost:3000/api/estimate';

const payloadSmall = {
    analysis: {
        room_type: 'bathroom',
        bathroom_size_estimate: 'under_4_sqm',
        bathroom_size_confidence: 0.9,
        detected_fixtures: { shower_present: true, bathtub_present: false, toilet_present: true, sink_present: true },
        layout_features: { shower_zone_visible: true, wet_room_layout: true, tight_space: true, irregular_geometry: false },
        ceiling_features: { ceiling_visible: true, sloped_ceiling_detected: false },
        condition_signals: { overall_condition: 'average' },
        image_quality: { sufficient_for_estimate: true, issues: [] },
        analysis_confidence: 0.9,
    },
    overrides: { bathroom_size_final: 'under_4_sqm', bathroom_size_source: 'user_overridden' },
    outcome: { shower_type: 'walk_in_shower_glass', bathtub: 'no', toilet_type: 'floor_standing', vanity_type: 'simple_sink', wall_finish: 'tiles_all_walls', floor_finish: 'standard_ceramic_tiles', ceiling_type: 'painted_ceiling', layout_change: 'no', shower_niches: 'none' },
};

const payloadLarge = {
    analysis: {
        room_type: 'bathroom',
        bathroom_size_estimate: 'over_7_sqm',
        bathroom_size_confidence: 0.9,
        detected_fixtures: { shower_present: true, bathtub_present: true, toilet_present: true, sink_present: true },
        layout_features: { shower_zone_visible: true, wet_room_layout: true, tight_space: false, irregular_geometry: false },
        ceiling_features: { ceiling_visible: true, sloped_ceiling_detected: false },
        condition_signals: { overall_condition: 'average' },
        image_quality: { sufficient_for_estimate: true, issues: [] },
        analysis_confidence: 0.9,
    },
    overrides: { bathroom_size_final: 'over_7_sqm', bathroom_size_source: 'user_overridden' },
    outcome: { shower_type: 'walk_in_shower_glass', bathtub: 'yes', toilet_type: 'wall_hung', vanity_type: 'vanity_with_cabinet', wall_finish: 'large_format_tiles_all_walls', floor_finish: 'large_format_tiles', ceiling_type: 'moisture_resistant_panels', layout_change: 'yes', shower_niches: 'one' },
};

async function sendRequest(name: string, payload: any) {
    const start = performance.now();
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const duration = performance.now() - start;
        const data = await res.json();

        console.log(`\n--- ${name} ---`);
        console.log(`Status: ${res.status}`);
        console.log(`Time: ${duration.toFixed(2)}ms`);

        if (data.estimate?.totals) {
            console.log(`Grand Total: ${data.estimate.totals.grand_total_sek}`);
            console.log(`ROT Summary:`, JSON.stringify(data.estimate.rot_summary, null, 2));
        } else {
            console.log('Error/No Estimate:', JSON.stringify(data).slice(0, 200));
        }
    } catch (e) {
        console.error(`Failed ${name}:`, e);
    }
}

async function run() {
    console.log('Starting Performance & ROT Tests...');

    // 1. Small Payload
    await sendRequest('Small Payload (Cold?)', payloadSmall);

    // 2. Large Payload
    await sendRequest('Large Payload', payloadLarge);

    // 3. Repeat Small (Warm?)
    await sendRequest('Small Payload (Repeat)', payloadSmall);
}

run();
