# AI Price Engine

This directory contains the new AI-based price engine for Remorph renovations.

## Purpose

Unlike the deterministic price engine (which relies solely on rigid catalog rules), this engine uses Gemini AI to:
1.  **Analyze images** to infer scope, dimensions, and conditions (Step 1).
2.  **Generate questions** dynamically based on visual observations.
3.  **Generate an "offertunderlag"** (quote basis) from user answers (Step 2).

## Current Scope

-   **Bathroom Renovations ONLY** (for now).
-   **Preparation Only**: This module is not yet wired into the live `/api` endpoints.

## Structure

```
src/ai-price-engine/
├── prompts/
│   └── bathroom/       # Bathroom-specific prompt builders
│       ├── step1.ts    # Image -> Questions
│       └── step2.ts    # Answers -> Offertunderlag
├── services/
│   ├── gemini.ts            # Image analysis service
│   └── offert-generator.ts  # Offert generation service
├── index.ts            # Public API surface
├── types.ts            # Shared framework-agnostic types
└── README.md           # This file
```

## Usage

This module exports:
-   `analyzeBathroomImage(imageBuffer: Buffer, userDescription?: string)`
-   `generateOffertunderlag(step1Data, userAnswers)`
-   Shared types

It allows the application to ingest an image, get structured data back, interact with the user, and produce a final estimate basis *without* hard-coding every permutation.

## Source & History

Extracted from the POC in `temp/new-Concept-AI-Questions`.
Once this engine is fully verified and integrated, the `temp` folder can be deleted.
