import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api/ai/offert';
const DEFAULT_IMAGE_PATH = 'test_cases/bathroom/cases/local_run/input.jpg';
const OUTPUT_DIR = '.tmp';

async function runAfterImageSmokeTest() {
    const imagePath = process.argv[2] || DEFAULT_IMAGE_PATH;
    const scenario = process.argv[3] || 'floor_only'; // 'floor_only' or 'full'

    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Image file not found: ${imagePath}`);
        console.error(`Usage: npm run smoke-ai-after-image [path-to-image] [scenario]`);
        console.error(`Scenarios: floor_only (default), full`);
        process.exit(1);
    }

    console.log('--- AI AFTER-IMAGE SMOKE TEST (v1 Contract) ---');
    console.log(`Target: ${API_BASE}/after-image`);
    console.log(`Image: ${imagePath}`);
    console.log(`Scenario: ${scenario}`);

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Step 1: Call /analyze to get step1 data
    console.log('\n[1/2] Calling /analyze to get step1 data...');

    const imageBuffer = fs.readFileSync(imagePath);
    const analyzeFormData = new FormData();
    analyzeFormData.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), path.basename(imagePath));
    analyzeFormData.append('description', 'Swedish bathroom renovation');

    let step1Data: any;

    try {
        const analyzeRes = await fetch(`${API_BASE}/analyze`, {
            method: 'POST',
            body: analyzeFormData,
        });

        if (!analyzeRes.ok) {
            const text = await analyzeRes.text();
            throw new Error(`Analyze failed: ${analyzeRes.status} ${analyzeRes.statusText} - ${text}`);
        }

        step1Data = await analyzeRes.json();
        console.log(`✅ Got step1 data with ${step1Data.follow_up_questions.length} questions`);
    } catch (err: any) {
        console.error('❌ Analyze failed:', err.message);
        process.exit(1);
    }

    // Step 2: Build answers based on scenario
    const answers: Record<string, string | number> = {};

    if (scenario === 'floor_only') {
        console.log('\n[Scenario: Floor Only]');
        // Answer questions to indicate floor-only renovation
        for (const q of step1Data.follow_up_questions) {
            const mapsTo = q.maps_to?.toLowerCase() || '';
            const questionText = q.question_sv.toLowerCase();

            if (mapsTo.includes('scope') || questionText.includes('omfattning')) {
                answers[q.id] = 'Endast golvbyte';
            } else if (mapsTo.includes('floor') || questionText.includes('golv')) {
                answers[q.id] = 'Klinker';
            } else if (mapsTo.includes('heating') || questionText.includes('golvvärme')) {
                answers[q.id] = 'Ja';
            } else {
                answers[q.id] = 'Vet ej'; // Preserve everything else
            }
        }
    } else if (scenario === 'full') {
        console.log('\n[Scenario: Full Renovation]');
        // Answer questions to indicate full renovation
        for (const q of step1Data.follow_up_questions) {
            const mapsTo = q.maps_to?.toLowerCase() || '';
            const questionText = q.question_sv.toLowerCase();

            if (mapsTo.includes('scope') || questionText.includes('omfattning')) {
                answers[q.id] = 'Totalrenovering';
            } else if (mapsTo.includes('floor') || questionText.includes('golv')) {
                answers[q.id] = 'Klinker';
            } else if (mapsTo.includes('wall') || questionText.includes('vägg')) {
                answers[q.id] = 'Hela vägghöjden';
            } else if (mapsTo.includes('tile_price') || (questionText.includes('kakel') && questionText.includes('kvalitet'))) {
                answers[q.id] = 'Standard';
            } else if (mapsTo.includes('tile_size') || (questionText.includes('kakel') && questionText.includes('storlek'))) {
                answers[q.id] = 'Medium';
            } else if (mapsTo.includes('heating') || questionText.includes('golvvärme')) {
                answers[q.id] = 'Ja';
            } else {
                answers[q.id] = 'Vet ej';
            }
        }
    }

    console.log(`Generated ${Object.keys(answers).length} answers`);

    // Step 3: Call /after-image with step1 + answers
    console.log('\n[2/2] Calling /after-image with step1 + answers...');

    const afterImageFormData = new FormData();
    afterImageFormData.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), path.basename(imagePath));
    afterImageFormData.append('step1', JSON.stringify(step1Data));
    afterImageFormData.append('answers', JSON.stringify(answers));
    afterImageFormData.append('description', scenario === 'floor_only' ? 'Modern floor tiles' : 'Modern Swedish bathroom');

    try {
        const res = await fetch(`${API_BASE}/after-image`, {
            method: 'POST',
            body: afterImageFormData,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`After-image generation failed: ${res.status} ${res.statusText} - ${text}`);
        }

        const result = await res.json();

        // Assertions
        if (!result.after_image_url) {
            throw new Error('Response missing after_image_url field');
        }

        if (!result.mime_type) {
            throw new Error('Response missing mime_type field');
        }

        if (result.after_image_base64) {
            console.log('ℹ️ Base64 present (debug mode or env var set)');
        } else {
            console.log('✅ Base64 omitted (standard mode)');
        }

        console.log('✅ After-image generation successful!');
        console.log(`URL: ${result.after_image_url.substring(0, 50)}...`);
        console.log(`Path: ${result.after_image_path}`);
        console.log(`Provider: ${result.provider || 'unknown'}`);
        console.log(`Model: ${result.model || 'unknown'}`);
        console.log(`Latency: ${result.latency_ms || 'unknown'} ms`);

        // Download image from URL and save to file
        console.log(`\n⬇️ Downloading image from Supabase...`);
        const imgRes = await fetch(result.after_image_url);
        if (!imgRes.ok) {
            throw new Error(`Failed to download image: ${imgRes.status} ${imgRes.statusText}`);
        }

        const arrayBuffer = await imgRes.arrayBuffer();
        const imageData = Buffer.from(arrayBuffer);
        const extension = result.mime_type === 'image/png' ? 'png' : 'jpg';
        const outputPath = path.join(OUTPUT_DIR, `after_${scenario}.${extension}`);

        fs.writeFileSync(outputPath, imageData);

        console.log(`📁 Saved to: ${outputPath}`);
        console.log(`📊 File size: ${imageData.length} bytes (${(imageData.length / 1024).toFixed(2)} KB)`);

        console.log('\n✅ All assertions passed');
        console.log('--- SMOKE TEST PASSED ---');
    } catch (err: any) {
        console.error('❌ After-image generation failed:', err.message);
        process.exit(1);
    }
}

runAfterImageSmokeTest();
