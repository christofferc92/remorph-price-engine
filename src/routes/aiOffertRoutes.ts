import { Router } from 'express';
import multer from 'multer';
import { analyzeBathroomImage } from '../ai-price-engine/services/gemini';
import { generateOffertunderlag } from '../ai-price-engine/services/offert-generator';
import { AnalysisResponse, OffertResponse } from '../ai-price-engine/types';
import { generateAfterImage } from '../ai-image-engine';

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


/**
 * POST /api/ai/offert/after-image
 * Accepts multipart/form-data with:
 *   - image OR before_image (required): JPEG/PNG file
 *   - description (optional): Text description
 *   - step1 (optional): JSON string of Step 1 analysis data
 *   - step2 (optional): JSON string of Step 2 offert data
 * Returns { after_image_base64, mime_type }
 */
router.post(
    '/after-image',
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'before_image', maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            // Accept either 'image' or 'before_image' field name
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            const file = files?.image?.[0] ?? files?.before_image?.[0];

            if (!file) {
                return res.status(400).json({ error: 'No image file provided (use field name "image" or "before_image")' });
            }

            const beforeImage = file.buffer;
            const description = req.body.description || undefined;

            // Parse optional JSON fields
            let step1Data: AnalysisResponse | undefined;
            let step2Data: OffertResponse | undefined;

            if (req.body.step1) {
                try {
                    step1Data = JSON.parse(req.body.step1);
                } catch (e) {
                    return res.status(400).json({ error: 'Invalid JSON in step1 field' });
                }
            }

            if (req.body.step2) {
                try {
                    step2Data = JSON.parse(req.body.step2);
                } catch (e) {
                    return res.status(400).json({ error: 'Invalid JSON in step2 field' });
                }
            }

            const startTime = Date.now();

            // Generate after-image
            const result = await generateAfterImage({
                beforeImage,
                description,
                step1Data,
                step2Data,
            });

            const latencyMs = Date.now() - startTime;

            res.json({
                ...result,
                provider: process.env.AFTER_IMAGE_PROVIDER || 'gemini',
                model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
                latency_ms: latencyMs,
            });
        } catch (error: any) {
            console.error('[AI-Offert] After-image error:', error);

            // Handle Multer errors
            if (error.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({
                    error: 'Invalid upload field',
                    details: 'Use field name "image" or "before_image" for the image file',
                });
            }

            // Handle specific AI errors
            if (error.message?.includes('No image data') || error.message?.includes('Gemini image generation failed')) {
                return res.status(502).json({ error: 'AI Service Error', details: error.message });
            }

            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
);


export const aiOffertRouter = router;
