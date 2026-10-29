import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('HTTP game lifecycle rejects bad requests and commits model turns atomically', async t => {
  let modelFailure = false;
  let holdModel = false;
  let releaseModel;
  const modelServer = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: 'test-local-model' }] }));
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const context = JSON.parse(input.messages[1].content);
    if (holdModel) await new Promise(resolve => { releaseModel = resolve; });
    if (modelFailure) { response.writeHead(503); return response.end('{}'); }
    response.end(JSON.stringify({ message: { content: JSON.stringify({ memoryId: context.availableRecords[0].id }) } }));
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const gamePort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: String(gamePort), OLLAMA_HOST: `http://127.0.0.1:${modelServer.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { releaseModel?.(); child.kill(); modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve)); });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Game server exited before listening.'); })]);
  const origin = `http://127.0.0.1:${gamePort}`;
  const post = async (endpoint, body, headers = {}) => {
    const response = await fetch(`${origin}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await fetch(`${origin}/server.js`)).status, 404);
  assert.equal((await post('start', { mode: 'archive' }, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await post('session', { id: 'missing' })).status, 404);
  const session = await post('start', { mode: 'local', model: 'test-local-model' });
  assert.equal(session.status, 200);
  const id = session.data.id;
  assert.equal((await post('ask', { id, question: '' })).status, 400);
  assert.equal((await post('finish', { id, memorial: 'Too soon.' })).status, 400);
  modelFailure = true;
  assert.equal((await post('ask', { id, question: 'Tell me about the gate.' })).status, 400);
  assert.equal((await post('session', { id })).data.state.turns.length, 0);
  modelFailure = false;
  holdModel = true;
  const firstRequest = post('ask', { id, question: 'Tell me about this place.' });
  for (let attempt = 0; attempt < 100 && !releaseModel; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(releaseModel);
  assert.equal((await post('ask', { id, question: 'A second simultaneous question.' })).status, 409);
  releaseModel(); holdModel = false;
  assert.equal((await firstRequest).data.state.turns.length, 1);
  let result;
  for (let index = 1; index < 7; index++) {
    result = await post('ask', { id, question: 'What else do you remember?' });
    assert.equal(result.status, 200);
  }
  assert.equal(result.data.state.phase, 'memorial');
  assert.equal(result.data.state.rescued.length, 7);
  assert.equal(result.data.state.lost.length, 7);
  assert.equal((await post('ask', { id, question: 'An eighth question.' })).status, 400);
  const ending = await post('finish', { id, memorial: '<script>Not executable, just words.</script>' });
  assert.equal(ending.data.state.phase, 'ended');
  assert.equal(ending.data.state.memorial, '<script>Not executable, just words.</script>');
  const archive = await post('start', { mode: 'archive' });
  const archiveTurn = await post('ask', { id: archive.data.id, question: 'Tell me about the fox.' });
  assert.equal(archiveTurn.data.turn.rescuedId, 'fox');
});
