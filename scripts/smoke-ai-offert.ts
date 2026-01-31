import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api/ai/offert';

async function runSmokeTest() {
    const imagePath = process.argv[2];
    if (!imagePath) {
        console.error('Usage: npm run smoke-ai-offert <path-to-image>');
        process.exit(1);
    }

    if (!fs.existsSync(imagePath)) {
        console.error(`File not found: ${imagePath}`);
        process.exit(1);
    }

    console.log('--- STARTING AI OFFERT SMOKE TEST ---');
    console.log(`Target: ${API_BASE}`);
    console.log(`Image: ${imagePath}`);

    // 1. Analyze Step
    console.log('\n[1/2] Calling /analyze...');
    const formData = new FormData();
    // Read file as blob/buffer
    const buffer = fs.readFileSync(imagePath);
    const blob = new Blob([buffer], { type: 'image/jpeg' }); // Assume JPEG for test
    formData.append('image', blob as any, path.basename(imagePath));
    formData.append('description', 'Test bathroom renovation');

    let step1Data;
    try {
        const res = await fetch(`${API_BASE}/analyze`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Analyze failed: ${res.status} ${res.statusText} - ${text}`);
        }

        step1Data = await res.json();
        console.log('✅ Analysis successful!');
        console.log('Inferred Type:', step1Data.inferred_project_type);
        console.log('Observation Summary:', step1Data.image_observations?.summary_sv?.substring(0, 50) + '...');
    } catch (err: any) {
        console.error('❌ Analyze call failed:', err.message);
        process.exit(1);
    }

    // 2. Generate Step
    console.log('\n[2/2] Calling /generate...');

    // Create mock answers based on questions
    const answers: Record<string, any> = {};
    if (step1Data.follow_up_questions) {
        for (const q of step1Data.follow_up_questions) {
            // Use prefill if available, otherwise "unknown" or simple default
            if (q.prefill_guess) {
                answers[q.id] = q.prefill_guess;
            } else if (q.options && q.options.length > 0) {
                answers[q.id] = q.options[0];
            } else if (q.type === 'number') {
                answers[q.id] = 5; // dummy number
            } else {
                answers[q.id] = 'Test Answer';
            }
        }
    }
    console.log('Generated mock answers:', JSON.stringify(answers, null, 2));

    try {
        const res = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                step1: step1Data,
                answers,
            }),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Generate failed: ${res.status} ${res.statusText} - ${text}`);
        }

        const offertData = await res.json();
        console.log('✅ Offert Generation successful!');
        console.log('Price Range:', offertData.price_range_sek);
    } catch (err: any) {
        console.error('❌ Generate call failed:', err.message);
        process.exit(1);
    }

    console.log('\n--- SMOKE TEST PASSED ---');
}

runSmokeTest();
