
const ENDPOINT = 'https://remorph-price-engine-cccc.fly.dev/api/estimate';

const basePayload = {
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

async function sendRequest(owners: number) {
    const payload = { ...basePayload, rot_context: { owners_count: owners } };
    console.log(`Sending request with owners_count=${owners} to ${ENDPOINT}...`);
    const start = Date.now();
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const duration = Date.now() - start;
        console.log(`Status: ${res.status}, Time: ${duration}ms`);
        const data = await res.json();

        console.log('Top-level keys in estimate:', Object.keys(data.estimate || {}));
        console.log('rot_deduction_sek:', data.estimate?.rot_deduction_sek);
        console.log('rot_cap_sek:', data.estimate?.rot_cap_sek);
        console.log('total_after_rot_sek:', data.estimate?.total_after_rot_sek);
        console.log('price_range_sek:', data.estimate?.price_range_sek);

        return data.estimate;
    } catch (e) {
        console.error('Request failed:', e);
    }
}

async function run() {
    await sendRequest(2);
}

run();
