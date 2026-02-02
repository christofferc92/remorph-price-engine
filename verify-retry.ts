
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const API_URL = 'https://remorph-price-engine-cccc.fly.dev/api/ai/offert/analyze';
const IMAGE_PATH = 'test_cases/bathroom/cases/local_run/input.jpg';
const TOTAL_CALLS = 20;

async function runTest() {
    console.log(`Starting stress test: ${TOTAL_CALLS} calls to ${API_URL}...`);

    let successCount = 0;
    let fail422Count = 0;
    let fail5xxCount = 0;
    let otherFailCount = 0;

    const promises = [];

    for (let i = 0; i < TOTAL_CALLS; i++) {
        const form = new FormData();
        form.append('image', fs.createReadStream(IMAGE_PATH));
        form.append('description', `Stress test call ${i + 1}`);

        const promise = axios.post(API_URL, form, {
            headers: {
                ...form.getHeaders()
            }
        }).then(res => {
            successCount++;
            console.log(`[${i + 1}] Success (200)`);
        }).catch(err => {
            if (err.response) {
                if (err.response.status === 422) {
                    fail422Count++;
                    console.log(`[${i + 1}] Failed (422) - Model Output Error`);
                } else if (err.response.status >= 500) {
                    fail5xxCount++;
                    console.log(`[${i + 1}] Failed (${err.response.status}) - Server Error`);
                } else {
                    otherFailCount++;
                    console.log(`[${i + 1}] Failed (${err.response.status})`);
                }
            } else {
                otherFailCount++;
                console.log(`[${i + 1}] Error: ${err.message}`);
            }
        });

        // Run sequentially to not hit rate limits too hard if any
        await promise;
    }

    console.log('\n--- Test Results ---');
    console.log(`Total Calls: ${TOTAL_CALLS}`);
    console.log(`Success: ${successCount}`);
    console.log(`422 Failures: ${fail422Count}`);
    console.log(`5xx Failures: ${fail5xxCount}`);
    console.log(`Other Failures: ${otherFailCount}`);
    console.log(`Success Rate: ${(successCount / TOTAL_CALLS * 100).toFixed(1)}%`);
}

runTest();
