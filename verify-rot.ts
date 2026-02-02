
const ENDPOINT = 'http://localhost:3000/api/estimate';

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
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (owners === 1) {
        console.log('Top-level keys in estimate:', Object.keys(data.estimate || {}));
        if (data.estimate?.rot_summary) {
            console.log('rot_summary keys:', Object.keys(data.estimate.rot_summary));
        }
    }

    return data.estimate;
}

async function run() {
    console.log('--- Verifying ROT Owners Logic & Structure ---');

    // 1. One Owner
    const est1 = await sendRequest(1);
    const rot1 = est1.rot_summary || {};
    const ded1 = est1.rot_deduction_sek ?? rot1.rot_deduction_sek;
    const max1 = est1.rot_cap_sek ?? rot1.rot_cap_sek;
    console.log(`Owners: 1 => Deduction: ${ded1}, Max: ${max1}`);

    // 2. Two Owners
    const est2 = await sendRequest(2);
    const rot2 = est2.rot_summary || {};
    const ded2 = est2.rot_deduction_sek ?? rot2.rot_deduction_sek;
    const max2 = est2.rot_cap_sek ?? rot2.rot_cap_sek;
    console.log(`Owners: 2 => Deduction: ${ded2}, Max: ${max2}`);

    if (ded2 > ded1) {
        console.log('✅ SUCCESS: Deduction increased with 2 owners.');
    } else {
        console.log('❌ FAILURE: Deduction did not increase.');
    }

    if (est1.rot_deduction_sek !== undefined) {
        console.log('✅ SUCCESS: rot_deduction_sek is present at top level.');
    } else {
        console.log('⚠️ WARNING: rot_deduction_sek MISSING from top level.');
    }
}

run();
