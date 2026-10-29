import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, availableMemories, chooseArchiveMemory, applyQuestion, finishState, buildModelMessages } from '../engine.js';
import { memories } from '../memories.js';

test('seven successful questions preserve seven records and erase seven different records', () => {
  let state = createState();
  for (let index = 0; index < 7; index++) {
    const previous = structuredClone(state);
    const selected = state.remaining[0];
    const result = applyQuestion(state, `Question ${index + 1}`, selected);
    assert.deepEqual(state, previous);
    assert.ok(result.turn.lostId);
    assert.notEqual(selected, result.turn.lostId);
    state = result.state;
    assert.equal(state.rescued.length, index + 1);
    assert.equal(state.lost.length, index + 1);
    assert.equal(state.phase, index === 6 ? 'memorial' : 'listening');
  }
  assert.equal(state.remaining.length, 0);
  assert.equal(new Set([...state.rescued, ...state.lost]).size, memories.length);
  assert.throws(() => applyQuestion(state, 'An eighth question', null));
});

test('erased and rescued records never enter the next model context', () => {
  const { state, turn } = applyQuestion(createState(), 'Tell me about the gate', 'gate');
  const payload = JSON.parse(buildModelMessages('What else?', state)[1].content);
  assert.equal(payload.availableRecords.length, 12);
  assert.ok(!payload.availableRecords.some(record => record.id === turn.lostId || record.id === 'gate'));
  assert.ok(!JSON.stringify(payload).includes(turn.answer));
});

test('unanswerable questions still consume a turn and erase a memory', () => {
  const { state, turn } = applyQuestion(createState(), 'What is the capital of Mars?', null);
  assert.equal(state.turns.length, 1);
  assert.equal(state.lost.length, 1);
  assert.equal(state.rescued.length, 0);
  assert.equal(turn.rescuedId, null);
});

test('a model cannot recover erased records or invent new records', () => {
  const first = applyQuestion(createState(), 'What is the gate?', 'gate');
  for (const selected of [first.turn.lostId, 'invented', 'gate']) {
    const result = applyQuestion(first.state, 'Bring it back', selected);
    assert.equal(result.turn.rescuedId, null);
    assert.deepEqual(result.state.rescued, ['gate']);
  }
});

test('archive routing matches known topics and declines unrelated questions', () => {
  assert.equal(chooseArchiveMemory('What happened in the flood?', memories), 'rain');
  assert.equal(chooseArchiveMemory('Tell me about the fox.', memories), 'fox');
  assert.equal(chooseArchiveMemory('What is quantum chromodynamics?', memories), null);
  assert.equal(chooseArchiveMemory('Tell me about the fox.', availableMemories({ remaining: ['gate'] })), null);
});

test('empty and oversized questions cannot mutate the recording', () => {
  const state = createState();
  for (const question of ['', ' ', 'x'.repeat(281), null]) assert.throws(() => applyQuestion(state, question, 'gate'));
  assert.equal(state.turns.length, 0);
});

test('the final record requires the seventh turn and preserves the player words', () => {
  let state = createState();
  assert.throws(() => finishState(state, 'Too soon.'));
  for (let index = 0; index < 7; index++) state = applyQuestion(state, `Question ${index}`, null).state;
  assert.throws(() => finishState(state, ''));
  assert.throws(() => finishState(state, 'a'.repeat(2401)));
  const final = finishState(state, '  Someone kept a lamp burning.  ');
  assert.equal(final.memorial, 'Someone kept a lamp burning.');
  assert.equal(final.phase, 'ended');
  assert.equal(state.phase, 'memorial');
});
