/**
 * JSON Schema for Step 1 Analysis Response
 * Used to enforce structured output from Gemini
 */

import { SchemaType } from '@google/generative-ai';

export const step1ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        inferred_project_type: {
            type: SchemaType.STRING,
            enum: ["bathroom", "kitchen", "bedroom", "living_room", "painting", "flooring", "unclear"]
        },
        image_observations: {
            type: SchemaType.OBJECT,
            properties: {
                summary_sv: { type: SchemaType.STRING },
                inferred_size_sqm: {
                    type: SchemaType.OBJECT,
                    properties: {
                        value: { type: SchemaType.NUMBER },
                        confidence: { type: SchemaType.STRING, enum: ["low", "medium", "high"] },
                        basis_sv: { type: SchemaType.STRING }
                    },
                    required: ["value", "confidence", "basis_sv"]
                },
                visible_elements: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING }
                },
                uncertainties: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING }
                }
            },
            required: ["summary_sv", "visible_elements"]
        },
        scope_guess: {
            type: SchemaType.OBJECT,
            properties: {
                value: { type: SchemaType.STRING },
                confidence: { type: SchemaType.STRING, enum: ["low", "medium", "high"] },
                basis_sv: { type: SchemaType.STRING }
            },
            required: ["value", "confidence", "basis_sv"]
        },
        follow_up_questions: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    id: { type: SchemaType.STRING },
                    priority: { type: SchemaType.INTEGER },
                    question_sv: { type: SchemaType.STRING },
                    type: { type: SchemaType.STRING, enum: ["yes_no", "single_choice", "text", "number"] },
                    options: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING }
                    },
                    maps_to: { type: SchemaType.STRING },
                    why_it_matters_sv: { type: SchemaType.STRING },
                    ask_mode: { type: SchemaType.STRING, enum: ["ask", "confirm"] },
                    prefill_guess: { type: SchemaType.STRING },
                    prefill_confidence: { type: SchemaType.STRING, enum: ["low", "medium", "high"] },
                    prefill_basis_sv: { type: SchemaType.STRING }
                },
                required: ["id", "priority", "question_sv", "type", "maps_to", "why_it_matters_sv", "ask_mode"]
            }
        }
    },
    required: ["inferred_project_type", "follow_up_questions"]
};

export const step1ResponseSchemaSimplified = {
    type: SchemaType.OBJECT,
    properties: {
        inferred_project_type: {
            type: SchemaType.STRING,
            enum: ["bathroom", "kitchen", "bedroom", "living_room", "painting", "flooring", "unclear"]
        },
        follow_up_questions: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    id: { type: SchemaType.STRING },
                    priority: { type: SchemaType.INTEGER },
                    question_sv: { type: SchemaType.STRING },
                    type: { type: SchemaType.STRING, enum: ["yes_no", "single_choice", "number"] },
                    options: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING }
                    },
                    maps_to: { type: SchemaType.STRING },
                    why_it_matters_sv: { type: SchemaType.STRING },
                    ask_mode: { type: SchemaType.STRING, enum: ["ask", "confirm"] },
                    prefill_guess: { type: SchemaType.STRING },
                    prefill_confidence: { type: SchemaType.STRING, enum: ["low", "medium", "high"] },
                    prefill_basis_sv: { type: SchemaType.STRING }
                },
                required: ["id", "priority", "question_sv", "type", "maps_to", "why_it_matters_sv", "ask_mode"]
            }
        }
    },
    required: ["inferred_project_type", "follow_up_questions"]
};
