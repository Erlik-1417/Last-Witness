import { memories, memoryById } from './memories.js';

const $ = selector => document.querySelector(selector);
const screens = ['intro', 'setup', 'game', 'memorial', 'ending'];
let sessionId = localStorage.getItem('last-witness-session');
let state;
let mode = 'archive';
let model = null;
let pending = false;
let audioContext;
let soundBus;
let soundEnabled = false;
let toastTimer;

const suggestions = {
  gate: 'What was the name on the front gate?', wheel: 'Why was one carriage always empty?', song: 'What did the carousel sound like?', ruth: 'Who worked in the ticket office?', photo: 'Tell me about the birthday photographs.', rain: 'What happened when the river flooded?', fox: 'Was anything left in lost property?', letter: 'What did Arthur write in the letter?', summer: 'Tell me about a happy summer afternoon.', light: 'Who are you? Why is your light still on?', bench: 'Who used to sit on the north bench?', tomorrow: 'Did anyone think the park would reopen?', height: 'What were the pencil marks on the staff doorframe?', dance: 'Did anyone dance on the bandstand?'
};

function showScreen(name) {
  for (const screen of screens) $(`#${screen}`).classList.toggle('hidden', screen !== name);
  document.body.classList.toggle('ended', name === 'ending');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function toast(message) {
  $('#error-toast').textContent = message;
  $('#error-toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#error-toast').classList.add('hidden'), 10000);
}

async function api(endpoint, body) {
  const response = await fetch(`/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    if (result.expired) { localStorage.removeItem('last-witness-session'); sessionId = null; showScreen('setup'); checkModels(); }
    throw new Error(result.error || 'The connection was interrupted.');
  }
  return result;
}

async function checkModels() {
  $('#refresh-models').disabled = true;
  try {
    const result = await fetch('/api/status').then(response => response.json());
    const select = $('#model-select');
    select.replaceChildren();
    for (const name of result.models) { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); }
    if (result.ready) {
      mode = 'local'; model = result.models[0];
      $('#connection-title').textContent = 'Local connection found';
      $('#connection-description').textContent = 'Your model will read only the memories that remain. Nothing is sent to a cloud service.';
      $('#model-label').classList.remove('hidden');
      $('#connect').disabled = false;
      $('#archive-choice').textContent = 'Use the authored archive instead';
    } else {
      mode = 'archive'; model = null;
      $('#connection-title').textContent = 'The authored archive is available';
      $('#connection-description').textContent = 'No local model was found. Play the complete handwritten story in archive mode, or start Ollama with a model installed and check again.';
      $('#model-label').classList.add('hidden');
      $('#connect').disabled = false;
      $('#archive-choice').textContent = 'Archive edition selected';
    }
  } catch {
    $('#connection-title').textContent = 'The connection could not be checked';
    $('#connection-description').textContent = 'Make sure the local game server is running, then check again.';
    $('#connect').disabled = true;
  } finally { $('#refresh-models').disabled = false; }
}

function addTransmission(speaker, text, time) {
  const article = document.createElement('article');
  article.className = `transmission ${speaker === 'YOU' ? 'you' : ''}`;
  const label = document.createElement('div'); label.className = 'transmission-label';
  const who = document.createElement('span'); who.textContent = speaker;
  const timestamp = document.createElement('span'); timestamp.textContent = time;
  label.append(who, timestamp);
  const paragraph = document.createElement('p'); paragraph.textContent = text;
  article.append(label, paragraph); $('#transcript').append(article);
  return article;
}

function drawTranscript() {
  $('#transcript').replaceChildren();
  addTransmission('KEEPER', 'Oh. The door. I had forgotten it could open.\n\nYou do not need a ticket. Not anymore. There are a few things I still remember. What would you like to know?', '00:00');
  for (const [index, turn] of state.turns.entries()) {
    const timestamp = `${String(index + 1).padStart(2, '0')}:00`;
    addTransmission('YOU', turn.question, timestamp);
    addTransmission('KEEPER', turn.answer, timestamp);
  }
  if (state.phase !== 'listening') addTransmission('KEEPER', 'I cannot keep the pictures straight anymore. But you have some of them now. Will you leave something for whoever comes after you?', 'END OF TAPE');
  $('#transcript').scrollTop = $('#transcript').scrollHeight;
}

function selectNode(memory) {
  if (!state.remaining.includes(memory.id) || pending || state.phase !== 'listening') return;
  $('#selected-memory').replaceChildren();
  const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = memory.label;
  const title = document.createElement('p'); title.textContent = memory.title;
  $('#selected-memory').append(label, title);
  $('#question').value = suggestions[memory.id];
  $('#question').dispatchEvent(new Event('input'));
  $('#input-hint').textContent = 'Your question is ready. Press Ask Keeper to spend one turn.';
  $('#ask').textContent = 'Ask ↗';
  $('#question').focus({ preventScroll: true });
}

function renderMap() {
  const container = $('#map-nodes'); container.replaceChildren();
  for (const memory of memories) {
    const rescued = state.rescued.includes(memory.id);
    const lost = state.lost.includes(memory.id);
    const button = document.createElement('button');
    button.className = `map-node${rescued ? ' rescued' : lost ? ' lost' : ''}`;
    button.style.left = `${memory.coordinate[0]}%`; button.style.top = `${memory.coordinate[1]}%`;
    button.setAttribute('aria-label', lost ? 'An erased memory' : `${memory.title}${rescued ? ', preserved in your notebook' : ', ask about this memory'}`);
    button.title = lost ? 'Only an outline remains' : memory.title;
    button.disabled = lost || rescued || pending || state.phase !== 'listening';
    button.addEventListener('click', () => selectNode(memory));
    container.append(button);
  }
  $('.wheel-drawing').style.opacity = state.lost.includes('wheel') ? '.08' : '1';
  $('.carousel-drawing').style.opacity = state.lost.includes('song') ? '.08' : '1';
  $('#map-count').textContent = `${state.remaining.length} SIGNAL${state.remaining.length === 1 ? '' : 'S'}`;
}

function renderNotebook() {
  const notebook = $('#notebook'); notebook.replaceChildren();
  if (!state.rescued.length) {
    const empty = document.createElement('div'); empty.className = 'notebook-empty';
    const number = document.createElement('span'); number.textContent = '01.';
    const words = document.createElement('p'); words.textContent = 'Nothing here yet. Listen closely.';
    empty.append(number, words); notebook.append(empty);
  }
  for (const [index, id] of state.rescued.entries()) {
    const memory = memoryById.get(id);
    const entry = document.createElement('details'); entry.className = 'notebook-entry';
    const summary = document.createElement('summary');
    const number = document.createElement('span'); number.textContent = `${String(index + 1).padStart(2, '0')}.`;
    summary.append(number, document.createTextNode(memory.title));
    const paragraph = document.createElement('p'); paragraph.textContent = memory.echo;
    const artifact = document.createElement('pre'); artifact.textContent = memory.artifact;
    entry.append(summary, paragraph, artifact); notebook.append(entry);
  }
  $('#saved-count').textContent = `${state.rescued.length} SAVED`;
}

function renderGame() {
  const left = 7 - state.turns.length;
  $('#questions-left').textContent = String(left).padStart(2, '0');
  $('#ask').textContent = pending ? '…' : 'Ask ↗';
  $('#ask').setAttribute('aria-label', 'Ask Keeper');
  $('#input-hint').textContent = state.turns.length === 0 ? 'First, click a glowing point on the map. Then press Ask.' : `${left} questions left. Every question costs one turn and erases another memory.`;
  $('.map-hint').textContent = 'Click a glowing point to prepare a question. Nothing is spent until you press Ask.';
  if (!$('#question').value.trim()) {
    const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = 'CHOOSE WHAT SURVIVES';
    const instruction = document.createElement('p'); instruction.textContent = 'Select a glowing point to prepare your next question.';
    $('#selected-memory').replaceChildren(label, instruction);
  }
  $('#power-cells').replaceChildren();
  for (let index = 0; index < 7; index++) { const cell = document.createElement('i'); if (index >= left) cell.className = 'empty'; $('#power-cells').append(cell); }
  $('#question-form').classList.toggle('hidden', state.phase !== 'listening');
  $('#finish-prompt').classList.toggle('hidden', state.phase === 'listening');
  $('#keeper-status').textContent = pending ? 'FINDING THE WORDS' : state.phase === 'listening' ? 'KEEPER IS LISTENING' : 'THE TAPE HAS RUN OUT';
  $('#restart').disabled = pending;
  $('#edition-label').textContent = mode === 'local' ? `LOCAL MODEL / ${model}` : 'AUTHORED ARCHIVE / NO AI INFERENCE';
  $('#loss-notice').textContent = state.turns.at(-1)?.loss || '';
  renderMap(); renderNotebook();
}

function showMemorial() {
  $('#memorial-fragments').replaceChildren();
  for (const id of state.rescued) {
    const memory = memoryById.get(id);
    const button = document.createElement('button'); button.className = 'fragment'; button.type = 'button'; button.textContent = `+ ${memory.title}`;
    button.addEventListener('click', () => {
      const input = $('#memorial-text');
      const next = `${input.value}${input.value.trim() ? '\n\n' : ''}${memory.farewell}`;
      if (next.length > 2400) return toast('There is no more room on this page.');
      input.value = next; button.classList.add('used'); button.disabled = true; saveMemorialDraft();
    });
    $('#memorial-fragments').append(button);
  }
  $('#memorial-text').value = localStorage.getItem(`last-witness-draft-${sessionId}`) || '';
  showScreen('memorial');
}

function saveMemorialDraft() { localStorage.setItem(`last-witness-draft-${sessionId}`, $('#memorial-text').value); }

function showEnding() {
  $('#final-words').textContent = state.memorial;
  $('#ending-date').textContent = 'BELLWETHER ARCHIVE / RECORDING 001';
  $('#ending-count').textContent = `${state.rescued.length} MEMORIES PRESERVED. ${state.lost.length} LOST. ${state.remaining.length} LEFT UNASKED. ONE PERSON TO REMEMBER.`;
  showScreen('ending');
  if (audioContext && soundBus) soundBus.gain.setTargetAtTime(0, audioContext.currentTime, 2);
}

function audioTone(frequency, duration = .6) {
  if (!soundEnabled || !audioContext) return;
  const tone = audioContext.createOscillator(); const envelope = audioContext.createGain();
  tone.type = 'sine'; tone.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, audioContext.currentTime); envelope.gain.linearRampToValueAtTime(.025, audioContext.currentTime + .05); envelope.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  tone.connect(envelope); envelope.connect(audioContext.destination); tone.start(); tone.stop(audioContext.currentTime + duration);
}

async function toggleSound() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)(); soundBus = audioContext.createGain(); soundBus.gain.value = 0; soundBus.connect(audioContext.destination);
      for (const frequency of [55, 82.41, 110.2]) { const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.value = .2; oscillator.connect(gain); gain.connect(soundBus); oscillator.start(); }
      const length = audioContext.sampleRate * 3; const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate); const channel = buffer.getChannelData(0);
      for (let index = 0; index < length; index++) channel[index] = Math.random() * 2 - 1;
      const noise = audioContext.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = audioContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 350;
      const noiseGain = audioContext.createGain(); noiseGain.gain.value = .18; noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(soundBus); noise.start();
    }
    await audioContext.resume(); soundEnabled = !soundEnabled;
    soundBus.gain.setTargetAtTime(soundEnabled && state?.phase !== 'ended' ? .08 : 0, audioContext.currentTime, .4);
    $('#sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
    $('#sound-toggle').setAttribute('aria-label', soundEnabled ? 'Disable ambient sound' : 'Enable ambient sound');
    $('#sound-label').textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
  } catch { toast('Sound is not available in this browser. The story will continue without it.'); }
}

$('#begin').addEventListener('click', () => { showScreen('setup'); checkModels(); });
$('#back-intro').addEventListener('click', () => showScreen('intro'));
$('#refresh-models').addEventListener('click', checkModels);
$('#model-select').addEventListener('change', event => { model = event.target.value; mode = 'local'; });
$('#archive-choice').addEventListener('click', () => {
  mode = 'archive'; model = null; $('#connection-title').textContent = 'Authored archive selected';
  $('#connection-description').textContent = 'The complete story, using keyword matching. No model is running. You can return to local inference with Check again.';
  $('#model-label').classList.add('hidden'); $('#connect').disabled = false;
});
$('#connect').addEventListener('click', async () => {
  $('#connect').disabled = true;
  try {
    const session = await api('start', { mode, model }); sessionId = session.id; state = session.state;
    localStorage.setItem('last-witness-session', sessionId);
    $('#question').value = ''; $('#question').dispatchEvent(new Event('input'));
    showScreen('game'); drawTranscript(); renderGame(); audioTone(220);
    if (soundEnabled) soundBus.gain.setTargetAtTime(.08, audioContext.currentTime, .4);
  } catch (error) { toast(error.message); } finally { $('#connect').disabled = false; }
});
$('#question').addEventListener('input', event => { $('#character-count').textContent = `${event.target.value.length} / 280`; });
$('#question').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#question-form').requestSubmit(); } });
$('#question-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || !$('#question').value.trim()) return;
  const question = $('#question').value.trim(); pending = true;
  $('#ask').disabled = true; $('#question').disabled = true; renderGame();
  const waiting = addTransmission('KEEPER', 'One moment. I know it is here somewhere.', 'SIGNAL'); waiting.classList.add('pending'); $('#transcript').scrollTop = $('#transcript').scrollHeight;
  try {
    const result = await api('ask', { id: sessionId, question }); state = result.state;
    $('#question').value = ''; $('#question').dispatchEvent(new Event('input'));
    $('#selected-memory').replaceChildren();
    const hint = document.createElement('p'); hint.textContent = 'Somewhere else, a little less light.'; $('#selected-memory').append(hint);
    drawTranscript(); document.body.classList.add('signal-loss'); setTimeout(() => document.body.classList.remove('signal-loss'), 900); audioTone(146.83, 1.4);
  } catch (error) { waiting.remove(); toast(error.message); } finally {
    pending = false; $('#ask').disabled = false; $('#question').disabled = false;
    renderGame(); if (state.phase === 'listening') $('#question').focus({ preventScroll: true });
  }
});
$('#write-memorial').addEventListener('click', showMemorial);
$('#memorial-text').addEventListener('input', saveMemorialDraft);
$('#memorial-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const result = await api('finish', { id: sessionId, memorial: $('#memorial-text').value }); state = result.state; localStorage.setItem('last-witness-final', JSON.stringify({ state, mode, model })); showEnding(); }
  catch (error) { toast(error.message); } finally { button.disabled = false; }
});
$('#download').addEventListener('click', () => {
  const text = `THE BELLWETHER RECORDINGS\nLAST WITNESS / FINAL RECORD\n\n${state.memorial}\n\n${state.rescued.length} memories preserved. ${state.lost.length} lost.\n\nPRESERVED FRAGMENTS\n\n${state.rescued.map(id => { const memory = memoryById.get(id); return `${memory.title}\n${memory.farewell}\n\n${memory.artifact}`; }).join('\n\n---\n\n')}\n\nThis is a work of fiction.\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'bellwether-final-record.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
for (const id of ['restart', 'play-again']) $(`#${id}`).addEventListener('click', () => $('#restart-dialog').showModal());
$('#cancel-restart').addEventListener('click', () => $('#restart-dialog').close());
$('#confirm-restart').addEventListener('click', () => { $('#restart-dialog').close(); if (sessionId) localStorage.removeItem(`last-witness-draft-${sessionId}`); localStorage.removeItem('last-witness-session'); localStorage.removeItem('last-witness-final'); sessionId = null; state = undefined; showScreen('setup'); checkModels(); });
$('#sound-toggle').addEventListener('click', toggleSound);
$('#how-to-play').addEventListener('click', () => $('#help-dialog').showModal());
$('#close-help').addEventListener('click', () => $('#help-dialog').close());

async function restore() {
  const final = localStorage.getItem('last-witness-final');
  if (final) {
    try { const saved = JSON.parse(final); if (saved.state?.phase === 'ended') { state = saved.state; mode = saved.mode; model = saved.model; showEnding(); return; } } catch { localStorage.removeItem('last-witness-final'); }
  }
  if (!sessionId) return;
  try {
    const session = await api('session', { id: sessionId }); state = session.state; mode = session.mode; model = session.model;
    if (state.phase === 'ended') showEnding(); else { showScreen('game'); drawTranscript(); renderGame(); }
  } catch (error) { toast(error.message); }
}

restore();
