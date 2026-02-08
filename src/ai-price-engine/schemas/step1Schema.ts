/**
 * JSON Schema for Step 1 Analysis Response
 * Used to enforce structured output from Gemini
 */

export const step1ResponseSchema = {
    type: "object",
    properties: {
        inferred_project_type: {
            type: "string",
            enum: ["bathroom", "kitchen", "bedroom", "living_room", "painting", "flooring", "unclear"]
        },
        image_observations: {
            type: "object",
            properties: {
                summary_sv: { type: "string" },
                inferred_size_sqm: {
                    type: "object",
                    properties: {
                        value: { type: "number" },
                        confidence: { type: "string", enum: ["low", "medium", "high"] },
                        basis_sv: { type: "string" }
                    },
                    required: ["value", "confidence", "basis_sv"]
                },
                visible_elements: {
                    type: "array",
                    items: { type: "string" }
                },
                uncertainties: {
                    type: "array",
                    items: { type: "string" }
                }
            },
            required: ["summary_sv", "visible_elements"]
        },
        scope_guess: {
            type: "object",
            properties: {
                value: { type: "string" },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                basis_sv: { type: "string" }
            },
            required: ["value", "confidence", "basis_sv"]
        },
        follow_up_questions: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    priority: { type: "integer" },
                    question_sv: { type: "string" },
                    type: { type: "string", enum: ["yes_no", "single_choice", "text", "number"] },
                    options: {
                        type: "array",
                        items: { type: "string" }
                    },
                    maps_to: { type: "string" },
                    why_it_matters_sv: { type: "string" },
                    ask_mode: { type: "string", enum: ["ask", "confirm"] },
                    prefill_guess: { type: ["string", "number", "null"] },
                    prefill_confidence: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
                    prefill_basis_sv: { type: ["string", "null"] }
                },
                required: ["id", "priority", "question_sv", "type", "maps_to", "why_it_matters_sv", "ask_mode"]
            }
        }
    },
    required: ["inferred_project_type", "follow_up_questions"]
};

export const step1ResponseSchemaSimplified = {
    type: "object",
    properties: {
        inferred_project_type: {
            type: "string",
            enum: ["bathroom", "kitchen", "bedroom", "living_room", "painting", "flooring", "unclear"]
        },
        follow_up_questions: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    priority: { type: "integer" },
                    question_sv: { type: "string" },
                    type: { type: "string", enum: ["yes_no", "single_choice", "number"] },
                    options: {
                        type: "array",
                        items: { type: "string" }
                    },
                    maps_to: { type: "string" },
                    why_it_matters_sv: { type: "string" },
                    ask_mode: { type: "string", enum: ["ask", "confirm"] },
                    prefill_guess: { type: ["string", "number", "null"] },
                    prefill_confidence: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
                    prefill_basis_sv: { type: ["string", "null"] }
                },
                required: ["id", "priority", "question_sv", "type", "maps_to", "why_it_matters_sv", "ask_mode"]
            }
        }
    },
    required: ["inferred_project_type", "follow_up_questions"]
};
