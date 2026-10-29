import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createState, availableMemories, chooseArchiveMemory, applyQuestion, finishState, buildModelMessages } from './engine.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const sessions = new Map();
const busy = new Set();
const modelHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const port = Number(process.env.PORT || 4177);
const allowedFiles = new Set(['index.html', 'style.css', 'app.js', 'memories.js']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function bodyOf(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 12000) throw new Error('Request is too large.');
  }
  return JSON.parse(body || '{}');
}

async function models() {
  const response = await fetch(`${modelHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error('The local model service did not respond.');
  const data = await response.json();
  return (data.models || []).map(model => model.name);
}

async function selectMemory(question, session) {
  const choices = availableMemories(session.state).map(memory => memory.id);
  const response = await fetch(`${modelHost}/api/chat`, {
    method: 'POST', signal: AbortSignal.timeout(90000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: session.model, stream: false, keep_alive: '10m', messages: buildModelMessages(question, session.state), format: { type: 'object', properties: { memoryId: { type: 'string', enum: [...choices, 'none'] } }, required: ['memoryId'], additionalProperties: false }, options: { temperature: 0, num_ctx: 4096, num_predict: 80 } })
  });
  if (!response.ok) throw new Error('The local model could not answer. Check that it is running, then try again. No memory has been erased.');
  const result = await response.json();
  const parsed = JSON.parse(result.message.content);
  if (parsed.memoryId !== 'none' && !choices.includes(parsed.memoryId)) throw new Error('The signal was unreadable. Try again. No memory has been erased.');
  return parsed.memoryId === 'none' ? null : parsed.memoryId;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return json(response, 403, { error: 'This request came from another window.' });
      if (url.pathname === '/api/status' && request.method === 'GET') {
        const installed = await models().catch(() => []);
        return json(response, 200, { models: installed, ready: installed.length > 0 });
      }
      if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
      const input = await bodyOf(request);
      if (url.pathname === '/api/start') {
        const mode = input.mode === 'local' ? 'local' : 'archive';
        if (mode === 'local' && !(await models()).includes(input.model)) return json(response, 400, { error: 'Choose an installed model first.' });
        const id = randomUUID();
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const session = { state: createState(), mode, model: input.model || null };
        sessions.set(id, session);
        return json(response, 200, { id, ...session });
      }
      const session = sessions.get(input.id);
      if (!session) return json(response, 404, { error: 'This recording has expired. Begin a new session.', expired: true });
      if (url.pathname === '/api/session') return json(response, 200, session);
      if (url.pathname === '/api/ask') {
        if (busy.has(input.id)) return json(response, 409, { error: 'Wait for the current transmission to finish.' });
        if (session.state.phase !== 'listening') return json(response, 400, { error: 'The witness has finished speaking.' });
        if (typeof input.question !== 'string' || !input.question.trim() || input.question.trim().length > 280) return json(response, 400, { error: 'Ask a question between 1 and 280 characters.' });
        busy.add(input.id);
        try {
          const selected = session.mode === 'local' ? await selectMemory(input.question.trim(), session) : chooseArchiveMemory(input.question, availableMemories(session.state));
          const result = applyQuestion(session.state, input.question, selected);
          session.state = result.state;
          return json(response, 200, { ...result, mode: session.mode });
        } finally { busy.delete(input.id); }
      }
      if (url.pathname === '/api/finish') {
        session.state = finishState(session.state, input.memorial);
        return json(response, 200, { state: session.state });
      }
      return json(response, 404, { error: 'Unknown recording channel.' });
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!allowedFiles.has(file)) { response.writeHead(404); return response.end('Not found'); }
    const content = await readFile(path.join(root, file));
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    response.end(content);
  } catch (error) {
    json(response, 400, { error: error.name === 'TimeoutError' ? 'The signal timed out. No memory has been erased. Please try again.' : error.message || 'The signal was interrupted.' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Last Witness is listening at http://127.0.0.1:${port}`));
