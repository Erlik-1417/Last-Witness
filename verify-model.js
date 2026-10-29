import assert from 'node:assert/strict';
import { createState, applyQuestion, buildModelMessages } from './engine.js';

const model = process.env.MODEL || 'qwen2.5:3b';
const cases = [
  ['What was the name on the front gate?', 'gate'],
  ['Was there anyone who let sad people in for free?', 'ruth'],
  ['What happened when the river flooded?', 'rain'],
  ['Tell me about the fox.', 'fox'],
  ['What is the capital of Mars?', 'none']
];

async function select(question, state) {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', signal: AbortSignal.timeout(90000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, messages: buildModelMessages(question, state), format: { type: 'object', properties: { memoryId: { type: 'string', enum: [...state.remaining, 'none'] } }, required: ['memoryId'], additionalProperties: false }, options: { temperature: 0, num_ctx: 4096, num_predict: 80 } })
  });
  assert.ok(response.ok, `Model service returned ${response.status}`);
  const result = await response.json();
  const selected = JSON.parse(result.message.content).memoryId;
  console.log(JSON.stringify({ question, selected, seconds: Number((result.total_duration / 1e9).toFixed(2)) }));
  return selected;
}

for (const [question, expected] of cases) assert.equal(await select(question, createState()), expected);
const { state } = applyQuestion(createState(), 'The fox?', 'fox');
assert.equal(await select('Tell me about the orange toy fox.', state), 'none');
console.log('Local model verification passed: relevance, paraphrases, unrelated questions, and erased context.');
