import { createState, availableMemories, chooseArchiveMemory, applyQuestion, finishState } from './engine.js';

const prefix = 'last-witness-public-recording-';

export async function publicApi(endpoint, input) {
  if (endpoint === 'start') {
    const id = crypto.randomUUID();
    const session = { id, state: createState(), mode: 'archive', model: null };
    localStorage.setItem(prefix + id, JSON.stringify(session));
    return session;
  }
  const saved = localStorage.getItem(prefix + input.id);
  if (!saved) throw new Error('This recording is no longer available. Start a new recording.');
  const session = JSON.parse(saved);
  if (endpoint === 'session') return session;
  if (endpoint === 'ask') {
    const selected = chooseArchiveMemory(input.question, availableMemories(session.state));
    const result = applyQuestion(session.state, input.question, selected);
    session.state = result.state;
    localStorage.setItem(prefix + input.id, JSON.stringify(session));
    return { ...result, mode: 'archive' };
  }
  if (endpoint === 'finish') {
    session.state = finishState(session.state, input.memorial);
    localStorage.setItem(prefix + input.id, JSON.stringify(session));
    return { state: session.state };
  }
  throw new Error('Unknown recording channel.');
}
