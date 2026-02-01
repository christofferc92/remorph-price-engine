import fs from 'fs/promises';
import path from 'path';
import { EstimateResponseV2 } from '../ai-price-engine/types';

// Simple FS Store for Estimates
const STORAGE_ROOT = path.resolve(process.cwd(), 'data');
const ESTIMATES_DIR = path.join(STORAGE_ROOT, 'estimates');

async function ensureDir() {
    try {
        await fs.mkdir(ESTIMATES_DIR, { recursive: true });
    } catch (e) {
        // Ignore if exists
    }
}

export async function saveEstimate(estimate: EstimateResponseV2): Promise<void> {
    await ensureDir();
    const filePath = path.join(ESTIMATES_DIR, `${estimate.estimate_id}.json`);
    const tmpPath = filePath + '.tmp';

    // Atomic Write: Write to tmp then rename
    await fs.writeFile(tmpPath, JSON.stringify(estimate, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
}

export async function loadEstimate(estimateId: string): Promise<EstimateResponseV2 | null> {
    await ensureDir();
    const filePath = path.join(ESTIMATES_DIR, `${estimateId}.json`);
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as EstimateResponseV2;
    } catch (e) {
        return null;
    }
}
