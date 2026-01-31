import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api/ai/offert';
const DEFAULT_IMAGE_PATH = 'test_cases/bathroom/cases/local_run/input.jpg';
const OUTPUT_DIR = '.tmp';

async function runAfterImageSmokeTest() {
    const imagePath = process.argv[2] || DEFAULT_IMAGE_PATH;

    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Image file not found: ${imagePath}`);
        console.error(`Usage: npm run smoke-ai-after-image [path-to-image]`);
        process.exit(1);
    }

    console.log('--- AI AFTER-IMAGE SMOKE TEST ---');
    console.log(`Target: ${API_BASE}/after-image`);
    console.log(`Image: ${imagePath}`);

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Read image file
    const imageBuffer = fs.readFileSync(imagePath);
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });

    // Create form data
    const formData = new FormData();
    formData.append('before_image', blob, path.basename(imagePath));
    formData.append('description', 'Modern Swedish bathroom renovation with white tiles and glass shower');

    console.log('\n[1/1] Calling /after-image...');

    try {
        const res = await fetch(`${API_BASE}/after-image`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`After-image generation failed: ${res.status} ${res.statusText} - ${text}`);
        }

        const result = await res.json();

        console.log('✅ After-image generation successful!');
        console.log(`MIME Type: ${result.mime_type}`);
        console.log(`Base64 Length: ${result.after_image_base64.length} characters`);

        // Decode base64 and save to file
        const imageData = Buffer.from(result.after_image_base64, 'base64');
        const extension = result.mime_type === 'image/png' ? 'png' : 'jpg';
        const outputPath = path.join(OUTPUT_DIR, `after.${extension}`);

        fs.writeFileSync(outputPath, imageData);

        console.log(`📁 Saved to: ${outputPath}`);
        console.log(`📊 File size: ${imageData.length} bytes (${(imageData.length / 1024).toFixed(2)} KB)`);

        console.log('\n--- SMOKE TEST PASSED ---');
    } catch (err: any) {
        console.error('❌ After-image generation failed:', err.message);
        process.exit(1);
    }
}

runAfterImageSmokeTest();
