/**
 * Prompt for generating additional follow-up questions (questions 6+).
 *
 * This is called in the background while the user is answering the first 4
 * questions and the address question (Q5). It receives:
 *  - The initial analysis (step1 output, which includes the first 4 questions)
 *  - The user's answers to the first 4 questions
 *  - The target total question count (user-selected, 5-20)
 *
 * It must return EXACTLY (target_total - 5) new questions,
 * each distinct from the original 4 and the hardcoded address question.
 */

import { AnalysisResponse, FollowUpQuestion } from '../../types';

export interface GenerateMoreQuestionsInput {
    step1: AnalysisResponse;
    answers: Record<string, string | number>;
    targetTotal: number;
    userDescription: string;
}

export function buildGenerateMoreQuestionsPrompt(input: GenerateMoreQuestionsInput): string {
    const { step1, answers, targetTotal, userDescription } = input;
    const numToGenerate = targetTotal - 5; // 5 = 4 initial + 1 address question

    if (numToGenerate <= 0) {
        throw new Error(`targetTotal must be > 5 to generate more questions. Got ${targetTotal}`);
    }

    // Build summary of already-asked questions and their answers
    const askedQuestionsContext = step1.follow_up_questions.map((q, i) => {
        const answer = answers[q.id] ?? answers[`q${i + 1}`] ?? 'Ej besvarat';
        return `Q${i + 1} (id=${q.id}, maps_to=${q.maps_to}): "${q.question_sv}"\n   Answer: ${JSON.stringify(answer)}`;
    }).join('\n\n');

    const schema = `{
  "additional_questions": [
    {
      "id": "q6",
      "priority": 6,
      "question_sv": "Question in Swedish?",
      "type": "yes_no" | "single_choice" | "text" | "number",
      "options": ["option1", "option2", "Vet ej"],
      "maps_to": "scope_level",
      "why_it_matters_sv": "Short explanation in Swedish",
      "ask_mode": "confirm" | "ask",
      "prefill_guess": "value from image" | null,
      "prefill_confidence": "low" | "medium" | "high" | null,
      "prefill_basis_sv": "Why I guessed this" | null
    }
    ... EXACTLY ${numToGenerate} more questions, numbered starting from q6 ...
  ]
}`;

    return `You are an assistant for Swedish renovation estimating. Your job is to generate EXACTLY ${numToGenerate} additional follow-up questions.

CONTEXT:
- Project type: ${step1.inferred_project_type}
- User's description: "${userDescription}"
- Scope guess: ${step1.scope_guess?.value ?? 'unclear'} (confidence: ${step1.scope_guess?.confidence ?? 'unknown'})
- Image summary: ${step1.image_observations?.summary_sv ?? 'Not available'}

ALREADY ASKED QUESTIONS AND ANSWERS (DO NOT REPEAT THESE TOPICS):
${askedQuestionsContext}

ALSO ALREADY HANDLED (DO NOT ASK ABOUT):
- Q5: User's address / location (handled separately by the app via geolocation)

YOUR TASK:
Generate EXACTLY ${numToGenerate} NEW follow-up questions that:
1. Are NOT duplicates of the questions already asked above
2. Cover the NEXT MOST IMPORTANT cost drivers not yet clarified
3. Are informed by the user's answers – e.g. if they said full bathroom renovation, ask details about fixtures, tiles, plumbing
4. Are prioritized by pricing impact (most important remaining cost driver first)
5. Use Swedish language for all user-facing text

General focus areas to cover (if not already addressed):
- Material choices and quality tier (tile brand/size, fixture tier)
- Demolition scope and complexity
- Underfloor heating details (if not clarified)
- Ventilation and electrical changes
- Layout changes (moving walls, plumbing relocations)
- Access constraints affecting labor
- Timeline and occupancy during renovation
- Any risk factors (previous water damage, asbestos in old homes, etc.)

QUESTION NUMBERING:
- Start IDs from q6 and increment (q6, q7, ... up to q${5 + numToGenerate})
- Start priorities from 6 and increment

PREFILL/CONFIRM FLOW:
- If you have context from the image or user's description that lets you make a good guess:
  - Set ask_mode="confirm", provide prefill_guess, prefill_confidence, prefill_basis_sv
- Otherwise:
  - Set ask_mode="ask", set prefill_* fields to null

Return ONLY valid JSON matching this exact schema:
${schema}

CRITICAL RULES:
- Must return EXACTLY ${numToGenerate} questions in additional_questions array
- Do NOT include questions on topics already covered (check the Already Asked list)
- Do NOT include an address/location/municipality question
- Use single_choice instead of text whenever possible
- Include "Vet ej" option where uncertainty is expected
- All question text, options, and explanations must be in Swedish
- Return ONLY the JSON, no markdown code blocks or extra text`;
}
