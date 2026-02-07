/**
 * Test script for improved AI question and image generation
 * 
 * Tests the description analyzer and enhanced prompts with various scenarios
 */

import { analyzeDescription, buildContextInstructions } from './src/ai-price-engine/lib/descriptionAnalyzer';
import { buildStep1Prompt } from './src/ai-price-engine/prompts/bathroom/step1';

console.log('═══════════════════════════════════════════════════════');
console.log('Testing Description Analyzer');
console.log('═══════════════════════════════════════════════════════\n');

// Test Case 1: Floor-only renovation
console.log('Test 1: Floor-only renovation');
console.log('Input: "Jag vill bara byta golvet"');
const test1 = analyzeDescription('Jag vill bara byta golvet');
console.log('Analysis:', JSON.stringify(test1, null, 2));
console.log('Context Instructions:', buildContextInstructions(test1));
console.log('\n---\n');

// Test Case 2: Full renovation with premium budget
console.log('Test 2: Full renovation with premium budget');
console.log('Input: "Totalrenovering av badrummet med lyx kakel och golvvärme"');
const test2 = analyzeDescription('Totalrenovering av badrummet med lyx kakel och golvvärme');
console.log('Analysis:', JSON.stringify(test2, null, 2));
console.log('Context Instructions:', buildContextInstructions(test2));
console.log('\n---\n');

// Test Case 3: Partial renovation with exclusions
console.log('Test 3: Partial renovation with exclusions');
console.log('Input: "Byt golv och väggkakel men behåll toaletten och handfatet"');
const test3 = analyzeDescription('Byt golv och väggkakel men behåll toaletten och handfatet');
console.log('Analysis:', JSON.stringify(test3, null, 2));
console.log('Context Instructions:', buildContextInstructions(test3));
console.log('\n---\n');

// Test Case 4: Budget-conscious quick renovation
console.log('Test 4: Budget-conscious quick renovation');
console.log('Input: "Snabb och billig renovering, bara det nödvändiga"');
const test4 = analyzeDescription('Snabb och billig renovering, bara det nödvändiga');
console.log('Analysis:', JSON.stringify(test4, null, 2));
console.log('Context Instructions:', buildContextInstructions(test4));
console.log('\n---\n');

// Test Case 5: Empty description
console.log('Test 5: Empty description');
console.log('Input: ""');
const test5 = analyzeDescription('');
console.log('Analysis:', JSON.stringify(test5, null, 2));
console.log('Context Instructions:', buildContextInstructions(test5));
console.log('\n---\n');

console.log('═══════════════════════════════════════════════════════');
console.log('Testing Enhanced Step 1 Prompt');
console.log('═══════════════════════════════════════════════════════\n');

// Generate prompt for floor-only scenario
console.log('Prompt for floor-only renovation:');
console.log('---');
const prompt1 = buildStep1Prompt('Jag vill bara byta golvet', false);
console.log(prompt1.substring(0, 800) + '...\n[truncated for readability]\n');

console.log('═══════════════════════════════════════════════════════');
console.log('All tests completed!');
console.log('═══════════════════════════════════════════════════════');
