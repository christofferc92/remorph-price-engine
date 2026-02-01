
import { calculateEstimate } from '../src/lib/pricing';
import { SectionV2, LineItemV2, RepriceRequestV2 } from '../src/ai-price-engine/types';
import fs from 'fs';
import path from 'path';

const FIXTURE_PATH = path.resolve(process.cwd(), 'data/fixtures/estimate_v2_example.json');
const API_URL = 'http://localhost:3000/api/ai/offert';

// Ensure fixture dir
fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error(`❌ ASSERT FAILED: ${msg}`);
        process.exit(1);
    } else {
        console.log(`✅ ${msg}`);
    }
}

async function runIntegrationTests() {
    console.log('\n--- Running HTTP Integration Tests ---');

    // 1. Test 404: Missing Estimate
    console.log('Testing 404: Missing Estimate...');
    const res404 = await fetch(`${API_URL}/reprice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimate_id: 'non-existent-id' })
    });
    console.log(`404 Test Status: ${res404.status}`);
    const data404 = await res404.json() as any;
    assert(res404.status === 404, 'Status should be 404');
    assert(data404.error === 'Estimate not found', 'Error message should match');
    assert(!!data404.request_id, 'Response should include request_id');

    // 2. Test 400: Validation Error (Negative Qty)
    console.log('Testing 400: Validation Error (Negative Qty)...');
    const res400 = await fetch(`${API_URL}/reprice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            estimate_id: 'any-id',
            edits: [{ line_item_id: 'item_1', qty: -10 }]
        })
    });
    const data400 = await res400.json() as any;
    assert(res400.status === 400, 'Status should be 400');
    assert(data400.error.includes('Invalid qty'), 'Error message should mention invalid qty');
    assert(!!data400.request_id, 'Response should include request_id');

    // 3. Test 403: CORS Forbidden (Simulation via disallowed Origin)
    console.log('Testing 403: CORS Forbidden...');
    const res403 = await fetch(`${API_URL}/reprice`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://evil-hacker.com'
        },
        body: JSON.stringify({ estimate_id: 'any-id' })
    });
    const data403 = await res403.json() as any;
    assert(res403.status === 403, 'Status should be 403');
    assert(data403.error === 'CORS Forbidden', 'Error should be CORS Forbidden');
}

// Logic Tests (Same as before)
const sections: SectionV2[] = [
    {
        id: 'sec_1',
        title_sv: 'Rivning',
        items: [
            {
                id: 'item_1',
                name_sv: 'Rivning plastmatta',
                qty: 10,
                unit: 'm2',
                unit_price_sek_incl_vat: 1000,
                type: 'labor',
                is_rot_eligible: true,
                total_likely_sek_incl_vat: 0,
                total_low_sek_incl_vat: 0,
                total_high_sek_incl_vat: 0
            }
        ]
    }
];

async function main() {
    console.log('--- Generating Baseline Logic Check ---');
    const baseline = calculateEstimate(
        sections,
        { apply_rot: true, owners_count: 2, rot_used_sek: 0 },
        'est_fixture_v2'
    );
    assert(baseline.summary.total_rot_deduction === 2400, 'Baseline ROT logic check');

    // Save fixture for integrations tests if needed
    fs.writeFileSync(FIXTURE_PATH, JSON.stringify(baseline, null, 2));

    try {
        await runIntegrationTests();
        console.log('\n✅ ALL SYSTEM CHECKS PASSED');
    } catch (err: any) {
        console.error('Integration tests failed. Is the server running?');
        console.error(err.message);
        process.exit(1);
    }
}

main();
