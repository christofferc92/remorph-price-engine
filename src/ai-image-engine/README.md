# AI Image Engine

This module handles AI-based after-renovation image generation for Remorph.

## Purpose

Generate realistic "after" images showing what a bathroom will look like after renovation, based on:
- Before image
- User description
- AI analysis data (Step 1)
- Renovation scope (Step 2)

## Architecture

### Provider Pattern

The module uses a provider pattern to support multiple AI image generation services:

- **Gemini** (default): Uses Google's `gemini-2.5-flash-image` model
- **OpenAI** (future): DALL-E integration (not yet implemented)

### Structure

```
src/ai-image-engine/
├── types.ts              # TypeScript interfaces
├── providers/
│   └── gemini.ts        # Gemini provider implementation
├── index.ts             # Public API
└── README.md            # This file
```

## Usage

```typescript
import { generateAfterImage } from '../ai-image-engine';

const result = await generateAfterImage({
  beforeImage: imageBuffer,
  description: 'Modern bathroom with white tiles',
  step1Data: analysisResponse,  // Optional
  step2Data: offertResponse,     // Optional
});

// result.after_image_base64 - Base64 encoded image
// result.mime_type - 'image/png' or 'image/jpeg'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AFTER_IMAGE_PROVIDER` | `"gemini"` | Which provider to use (`gemini` or `openai`) |
| `GEMINI_IMAGE_MODEL` | `"gemini-2.5-flash-image"` | Gemini model for image generation |
| `GOOGLE_API_KEY` | (required) | Google AI API key |

## Prompt Strategy

The Gemini provider builds prompts from:

1. **Base instruction**: "Generate a realistic after-renovation image of this Swedish bathroom"
2. **User description** (if provided)
3. **Current state** from Step 1 image observations
4. **Renovation scope** from Step 2 summary
5. **Material details** from Step 2 confirmed inputs (floor finish, tile quality, etc.)

## Error Handling

- Throws if `GOOGLE_API_KEY` not set
- Throws if Gemini returns no image data
- Throws if response format is unexpected
- All errors are caught and re-thrown with descriptive messages

## Testing

```bash
npm run smoke-ai-after-image path/to/bathroom.jpg
```

## Future Enhancements

- OpenAI DALL-E provider
- Style presets (modern, traditional, minimalist)
- Multiple image variations
- Image-to-image editing (preserve layout better)
