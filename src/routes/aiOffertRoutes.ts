import { Router } from 'express';
import multer from 'multer';
import { analyzeBathroomImage } from '../ai-price-engine/services/gemini';
import { generateOffertunderlag } from '../ai-price-engine/services/offert-generator';
import { AnalysisResponse, OffertResponse } from '../ai-price-engine/types';

const router = Router();

// Configure Multer for memory storage, 10MB limit, images only
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG and PNG images are allowed'));
        }
    },
});

/**
 * POST /api/ai/offert/analyze
 * Accepts multipart/form-data with 'image' file and optional 'description' text.
 * Returns AnalysisResponse.
 */
router.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Image file is required (jpeg/png)' });
        }

        const imageBuffer = req.file.buffer;
        const description = req.body.description || '';

        // Call AI Price Engine Step 1
        const analysis = await analyzeBathroomImage(imageBuffer, description);

        res.json(analysis);
    } catch (error: any) {
        console.error('[AI-Offert] Analyze error:', error);

        // Handle specific AI errors if possible, otherwise 500
        // Using 502 for upstream AI failures/bad JSON
        if (error.message?.includes('Failed to parse AI response') || error.message?.includes('GoogleGenerativeAI')) {
            return res.status(502).json({ error: 'AI Service Error', details: error.message });
        }

        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

/**
 * POST /api/ai/offert/generate
 * Accepts JSON with { step1: AnalysisResponse, answers: Record<string, any> }.
 * Returns OffertResponse.
 */
router.post('/generate', async (req, res) => {
    try {
        const { step1, answers } = req.body;

        // Basic validation
        if (!step1 || !answers) {
            return res.status(400).json({ error: 'Missing required fields: step1, answers' });
        }

        // Call AI Price Engine Step 2
        const offert = await generateOffertunderlag(step1 as AnalysisResponse, answers);

        res.json(offert);
    } catch (error: any) {
        console.error('[AI-Offert] Generate error:', error);

        if (error.message?.includes('Failed to parse AI response')) {
            return res.status(502).json({ error: 'AI Service Error', details: error.message });
        }

        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

export const aiOffertRouter = router;
