const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const words = t => (t.trim().match(/\S+/g) || []).length;
const state = { problem: null, stage: 0, transcripts: {}, seconds: {}, chats: {}, probeMark: {}, opts: { interject: true, speak: false } };
const shapes = []; // whiteboard: {type:'box'|'db'|'text'|'arrow', ...}

// ======================================================================
// Persistence (localStorage, always wrapped — it can be unavailable)
// ======================================================================
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const HKEY = 'sdd-history-v1', SKEY = 'sdd-session-v1';
const loadHistory = () => store.get(HKEY, []);
const saveSession = () => state.problem && store.set(SKEY, { ...state, shapes, savedAt: Date.now() });

// ======================================================================
// Belts / ranks
// ======================================================================
const beltFor = score => [...BELTS].reverse().find(b => score >= b.min);
const nextBelt = score => BELTS.find(b => b.min > score);
const beltPill = b => `<span class="belt-pill" style="background:${b.color}" title="${b.name}"></span>`;
function rankInfo() {
  const h = loadHistory();
  if (!h.length) return null;
  const recent = h.slice(0, 3), avg = recent.reduce((a, e) => a + e.result.overall.score, 0) / recent.length;
  return { avg, belt: beltFor(avg), next: nextBelt(avg), count: h.length, best: Math.max(...h.map(e => e.result.overall.score)) };
}

// ======================================================================
// Screens
// ======================================================================
function show(id) {
  if (typeof expanded !== 'undefined' && expanded) setExpanded(false);
  document.body.dataset.screen = id;
  ['home', 'game', 'results'].forEach(s => $(s).classList.toggle('hidden', s !== id));
  if (id === 'home') renderHome();
  scrollTo(0, 0);
}

// ---------- Home ----------
let catFilter = 'All', diffFilter = 0;

function renderHome() {
  const r = rankInfo();
  $('rank-chip').classList.toggle('hidden', !r);
  if (r) $('rank-chip').innerHTML = `${beltPill(r.belt)} <b style="color:var(--ink)">${r.belt.name}</b> · ${r.count} bout${r.count === 1 ? '' : 's'}`;

  // resume banner
  const sess = store.get(SKEY, null);
  $('resume').classList.toggle('hidden', !sess);
  if (sess) {
    $('resume').innerHTML = `<span>Unfinished bout: <b>${esc(sess.problem.title)}</b> — kata ${sess.stage + 1} of ${STAGES.length}</span>
      <span><button class="btn gold small" id="do-resume">Resume</button> <button class="btn ghost small" id="do-discard">Discard</button></span>`;
    $('do-resume').onclick = () => resume(sess);
    $('do-discard').onclick = () => { store.del(SKEY); renderHome(); };
  }

  // stats
  if (r) {
    const toNext = r.next ? `${Math.ceil(r.next.min - r.avg)} pts to ${r.next.name}` : 'Highest rank reached';
    const pct = r.next ? Math.max(4, ((r.avg - r.belt.min) / (r.next.min - r.belt.min)) * 100) : 100;
    $('stats').innerHTML = `
      <div class="stat"><small>Rank (avg last 3)</small><b>${beltPill(r.belt)} ${r.belt.name}</b><div class="progress"><i style="width:${pct}%"></i></div><small style="margin-top:4px">${toNext}</small></div>
      <div class="stat"><small>Bouts fought</small><b>${r.count}</b></div>
      <div class="stat"><small>Best score</small><b>${Math.round(r.best)}</b></div>
      <div class="stat"><small>Average (last 3)</small><b>${Math.round(r.avg)}</b></div>`;
  } else $('stats').innerHTML = '';

  // filters
  const cats = ['All', ...new Set(PROBLEMS.map(p => p.cat))];
  $('cat-chips').innerHTML = cats.map(c => `<button class="chip ${c === catFilter ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('');
  $('diff-chips').innerHTML = [[0, 'Any'], [1, '● Warm-up'], [2, '●● Standard'], [3, '●●● Hard']].map(([d, l]) => `<button class="chip ${d === diffFilter ? 'on' : ''}" data-diff="${d}">${l}</button>`).join('');
  document.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { catFilter = b.dataset.cat; renderHome(); });
  document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => { diffFilter = +b.dataset.diff; renderHome(); });

  // problem grid
  const played = new Set(loadHistory().map(e => e.problem));
  const list = PROBLEMS.filter(p => (catFilter === 'All' || p.cat === catFilter) && (!diffFilter || p.diff === diffFilter));
  $('count').textContent = `${list.length} of ${PROBLEMS.length}`;
  $('problem-grid').innerHTML = list.map(p => `<button class="card-p ${played.has(p.title) ? 'done' : ''}" data-title="${esc(p.title)}">
      <b>${esc(p.title)}</b><small>${esc(p.prompt.split('. ')[0].replace(/\.$/, ''))}.</small>
      <div class="meta"><span>${p.cat}</span><span class="dots">${[1, 2, 3].map(i => `<i class="${i <= p.diff ? 'on' : ''}"></i>`).join('')}</span></div></button>`).join('');
  document.querySelectorAll('.card-p').forEach(b => b.onclick = () => start(PROBLEMS.find(p => p.title === b.dataset.title)));

  renderHistory();
}

$('random').onclick = () => start(PROBLEMS[Math.floor(Math.random() * PROBLEMS.length)]);
$('daily').onclick = () => {
  const d = new Date(), seed = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
  start(PROBLEMS[seed % PROBLEMS.length]);
};

function start(problem) {
  stopMic();
  Object.assign(state, { problem, stage: 0, transcripts: {}, seconds: {}, chats: {}, probeMark: {} });
  shapes.length = 0; selected = null;
  enterGame();
}
function resume(sess) {
  Object.assign(state, { problem: sess.problem, stage: sess.stage, transcripts: sess.transcripts, seconds: sess.seconds, chats: sess.chats, probeMark: sess.probeMark || {}, opts: { ...state.opts, ...sess.opts } });
  shapes.length = 0; shapes.push(...(sess.shapes || [])); selected = null;
  enterGame();
}
function enterGame() {
  $('problem-title').textContent = state.problem.title;
  $('problem-meta').textContent = `${state.problem.cat} · ${'●'.repeat(state.problem.diff)}`;
  $('problem-prompt').textContent = state.problem.prompt;
  $('opt-interject').checked = state.opts.interject; $('opt-speak').checked = state.opts.speak;
  show('game'); renderStage(); saveSession();
}
$('leave').onclick = () => { if (confirm('Leave the mat? Your progress is saved and you can resume from the home screen.')) { stopMic(); stopTimer(); saveSession(); show('home'); } };

// ======================================================================
// Stage flow
// ======================================================================
let timerId, stageStart;
const stage = () => STAGES[state.stage];

function renderStage() {
  const s = stage();
  $('stepper').innerHTML = STAGES.map((x, i) => `${i ? '<span class="step-line"></span>' : ''}<span class="step ${i < state.stage ? 'done' : i === state.stage ? 'current' : ''}"><span class="k">${x.num}</span>${x.name}</span>`).join('');
  $('stage-num').textContent = s.num; $('stage-name').textContent = s.name; $('stage-goal').textContent = s.goal;
  $('stage-tips').innerHTML = s.tips.map(t => `<li>${esc(t)}</li>`).join('');
  $('transcript').value = state.transcripts[s.id] || '';
  $('board-wrap').classList.toggle('hidden', !s.board);
  $('probe-row').classList.toggle('hidden', !s.probes);
  $('sensei-sub').textContent = s.probes ? 'Expect pointed questions about your design. Answer here or out loud.' : 'Ask clarifying questions. They are graded too.';
  $('chat-input').placeholder = s.probes ? 'Answer the interviewer, or ask a question…' : 'e.g. How many users do we need to support?';
  $('back').disabled = state.stage === 0;
  $('next').textContent = state.stage === STAGES.length - 1 ? 'Finish & be graded ✓' : 'Next kata →';
  renderChat();
  if (s.board) requestAnimationFrame(draw);
  stageStart = Date.now() - (state.seconds[s.id] || 0) * 1000;
  stopTimer(); timerId = setInterval(tick, 500); tick();
}
const stopTimer = () => clearInterval(timerId);

let ticks = 0;
function tick() {
  const s = stage(), sec = Math.floor((Date.now() - stageStart) / 1000), budget = s.minutes * 60;
  state.seconds[s.id] = sec;
  $('timer').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('over', sec > budget);
  $('timer').title = `Suggested: ${s.minutes} min`;
  $('timebar').style.width = `${Math.min(100, sec / budget * 100)}%`;
  $('timebar').parentElement.classList.toggle('over', sec > budget);
  if (++ticks % 10 === 0) saveSession();
}

function saveStage() { state.transcripts[stage().id] = $('transcript').value; }
$('transcript').oninput = () => { saveStage(); saveSession(); };
$('opt-interject').onchange = e => { state.opts.interject = e.target.checked; saveSession(); };
$('opt-speak').onchange = e => { state.opts.speak = e.target.checked; if (!e.target.checked) speechSynthesis?.cancel(); saveSession(); };

$('next').onclick = () => {
  stopMic(); saveStage(); stopTimer();
  if (state.stage === STAGES.length - 1) return grade();
  state.stage++; renderStage(); saveSession(); scrollTo(0, 0);
};
$('back').onclick = () => { stopMic(); saveStage(); state.stage--; renderStage(); saveSession(); };

// ======================================================================
// Voice
// ======================================================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const dictations = [];

// Dictate into any input/textarea. Browsers end sessions on silence, so restart while wanted.
function makeDictation(btnOrBtns, target, { idle, active, status, onText, onStop }) {
  const btns = [].concat(btnOrBtns);
  const label = on => btns.forEach(b => { b.classList.toggle('recording', on); b.textContent = on ? active : idle; });
  let rec = null, want = false, base = '';
  const d = {
    get on() { return want; },
    stop() {
      const was = want; want = false;
      if (rec) { rec.onend = null; try { rec.stop(); } catch {} rec = null; }
      label(false); if (status) status.textContent = '';
      if (was) onStop?.();
    },
    toggle() {
      if (want) { d.stop(); return; }
      if (!SR) { alert('Speech recognition is not supported in this browser — use Chrome/Safari, or type instead.'); return; }
      dictations.forEach(x => x !== d && x.stop());
      speechSynthesis?.cancel(); // don't let the mic hear the interviewer
      want = true; label(true);
      const begin = () => {
        rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
        base = target.value;
        rec.onresult = e => {
          let fin = '', interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
          if (fin) base += (base && !/\s$/.test(base) ? ' ' : '') + fin.trim();
          target.value = base + (interim ? (base ? ' ' : '') + interim : '');
          onText?.();
        };
        rec.onerror = e => { if (status) status.textContent = e.error === 'not-allowed' ? 'Microphone permission denied.' : `Mic error: ${e.error}`; if (e.error === 'not-allowed') d.stop(); };
        rec.onend = () => { if (want) begin(); };
        rec.start();
      };
      begin();
    },
  };
  dictations.push(d); return d;
}
const stageMic = makeDictation([$('mic'), $('board-mic')], $('transcript'), {
  idle: 'Speak your answer', active: 'Stop', status: $('mic-status'),
  onText: () => saveStage(),
  onStop: () => { saveStage(); saveSession(); maybeInterject(); }, // the interviewer jumps in when you pause
});
const chatMic = makeDictation($('chat-mic'), $('chat-input'), { idle: 'Mic', active: 'Stop' });
$('mic').onclick = $('board-mic').onclick = () => stageMic.toggle();
$('board-probe').onclick = () => $('probe').click();
$('chat-mic').onclick = () => chatMic.toggle();
function stopMic() { dictations.forEach(d => d.stop()); }

function speak(text) {
  if (!state.opts.speak || !window.speechSynthesis) return;
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.03; speechSynthesis.speak(u);
}

// ======================================================================
// Interviewer chat + probing
// ======================================================================
const chatFor = () => (state.chats[stage().id] ||= []);

function renderChat() {
  const log = $('chat-log');
  log.innerHTML = chatFor().map(m => `<div class="msg ${m.role}${m.kind === 'probe' ? ' probe' : ''}${m.pending ? ' pending' : ''}">${esc(m.text)}</div>`).join('')
    || `<div class="hint">${stage().probes ? 'Start talking. When you pause, the interviewer will push on your design. Or hit "Challenge me".' : 'Clarify scope, users and scale before you commit — just like a real interview.'}</div>`;
  log.scrollTop = log.scrollHeight;
  const last = [...chatFor()].reverse().find(m => m.role === 'assistant' && !m.pending);
  $('board-note').textContent = last ? `Interviewer: ${last.text}` : '';
}

// Call the interviewer. `probe` = they pick the next question; otherwise they reply to the latest message.
async function callInterviewer({ probe = false, text = '' } = {}) {
  const chat = chatFor(), s = stage();
  const history = STAGES.flatMap(x => state.chats[x.id] || []).filter(m => !m.pending).map(({ role, text }) => ({ role, text }));
  if (text) { chat.push({ role: 'user', text }); history.push({ role: 'user', text }); }
  const thinking = { role: 'assistant', text: probe ? 'The interviewer leans in…' : 'Thinking…', pending: true }; chat.push(thinking); renderChat();
  setBusy(true);
  try {
    const r = await fetch('/api/interview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      problem: state.problem, stage: s.name, stageId: s.id, history, probe,
      context: s.probes ? { transcript: $('transcript').value, board: describeBoard() } : undefined }) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error);
    chat.splice(chat.indexOf(thinking), 1, { role: 'assistant', text: data.reply, kind: probe ? 'probe' : undefined });
    speak(data.reply);
  } catch (e) { chat.splice(chat.indexOf(thinking), 1, { role: 'assistant', text: `(interviewer unavailable: ${e.message})` }); }
  setBusy(false); renderChat(); saveSession();
}
let busy = false;
function setBusy(b) { busy = b; $('chat-send').disabled = b; $('probe').disabled = b; }

function sendChat() {
  const text = $('chat-input').value.trim(); if (!text || busy) return;
  chatMic.stop(); $('chat-input').value = '';
  callInterviewer({ text });
}
$('chat-send').onclick = sendChat;
$('chat-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } };

$('probe').onclick = () => { if (!busy) { state.probeMark[stage().id] = words($('transcript').value); callInterviewer({ probe: true }); } };

// Auto-interject when the candidate stops talking after saying something new.
function maybeInterject() {
  const s = stage();
  if (!s.probes || !state.opts.interject || busy) return;
  const w = words($('transcript').value);
  if (w - (state.probeMark[s.id] || 0) >= 40) { state.probeMark[s.id] = w; callInterviewer({ probe: true }); }
}

// ======================================================================
// Whiteboard
// ======================================================================
const canvas = $('board'), ctx = canvas.getContext('2d');
let tool = 'select', drag = null, selected = null;

document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.onclick = () => {
  tool = b.dataset.tool; selected = null;
  document.querySelectorAll('#toolbar [data-tool]').forEach(x => x.classList.toggle('active', x === b)); draw();
});
$('clear-board').onclick = () => { if (confirm('Wipe the whiteboard?')) { shapes.length = 0; draw(); saveSession(); } };
$('delete-shape').onclick = deleteSelected;
addEventListener('keydown', e => { if ((e.key === 'Delete' || e.key === 'Backspace') && !/TEXTAREA|INPUT/.test(document.activeElement.tagName) && selected) { e.preventDefault(); deleteSelected(); } });
function deleteSelected() { if (selected) { shapes.splice(shapes.indexOf(selected), 1); selected = null; draw(); saveSession(); } }

const view = { s: 1 }; // world -> canvas scale (set each draw)
const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width / view.s, y: (e.clientY - r.top) * canvas.height / r.height / view.s }; };
const inBox = (s, p) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function hit(p) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'arrow' ? distToSeg(p, { x: s.x, y: s.y }, { x: s.x2, y: s.y2 }) < 8 : inBox(s, p)) return s;
  }
  return null;
}

canvas.onpointerdown = e => {
  canvas.setPointerCapture(e.pointerId);
  const p = pos(e);
  if (tool === 'select') {
    selected = hit(p); drag = selected && { mode: 'move', last: p }; draw();
  } else if (tool === 'text') {
    const label = prompt('Text:'); if (label) { ctx.font = '16px sans-serif'; shapes.push({ type: 'text', x: p.x, y: p.y, w: ctx.measureText(label).width + 10, h: 24, label }); draw(); saveSession(); }
  } else if (tool === 'arrow') {
    const s = { type: 'arrow', x: p.x, y: p.y, x2: p.x, y2: p.y }; shapes.push(s); drag = { mode: 'new', s };
  } else {
    const s = { type: tool, x: p.x, y: p.y, w: 0, h: 0, label: '', ox: p.x, oy: p.y }; shapes.push(s); drag = { mode: 'new', s };
  }
};
canvas.onpointermove = e => {
  if (!drag) return;
  const p = pos(e);
  if (drag.mode === 'move') {
    const dx = p.x - drag.last.x, dy = p.y - drag.last.y, s = selected;
    s.x += dx; s.y += dy; if (s.type === 'arrow') { s.x2 += dx; s.y2 += dy; }
    drag.last = p;
  } else if (drag.s.type === 'arrow') { drag.s.x2 = p.x; drag.s.y2 = p.y; }
  else { const s = drag.s; s.x = Math.min(s.ox, p.x); s.y = Math.min(s.oy, p.y); s.w = Math.abs(p.x - s.ox); s.h = Math.abs(p.y - s.oy); }
  draw();
};
canvas.onpointerup = () => {
  if (drag && drag.mode === 'new') {
    const s = drag.s;
    if (s.type === 'arrow') { if (Math.hypot(s.x2 - s.x, s.y2 - s.y) < 12) shapes.splice(shapes.indexOf(s), 1); selected = null; }
    else {
      if (s.w < 20 || s.h < 20) { s.w = 130; s.h = 60; s.x = s.ox - 65; s.y = s.oy - 30; } // plain click = default size
      draw(); s.label = prompt(s.type === 'db' ? 'Database name:' : 'Service name:') || ''; selected = s;
    }
  }
  drag = null; draw(); saveSession();
};
canvas.ondblclick = e => {
  const s = hit(pos(e));
  if (s && s.type !== 'arrow') { const l = prompt('Label:', s.label); if (l !== null) { s.label = l; draw(); saveSession(); } }
};

function draw() {
  // Expanded: 1:1. Inline: shrink to fit anything drawn outside the inline area.
  let sc = 1;
  if (!expanded && shapes.length) {
    const maxX = Math.max(...shapes.map(s => Math.max(s.x, s.x2 ?? 0, s.x + (s.w || 0)))), maxY = Math.max(...shapes.map(s => Math.max(s.y, s.y2 ?? 0, s.y + (s.h || 0))));
    sc = Math.min(1, (canvas.width - 24) / Math.max(maxX, 1), (canvas.height - 24) / Math.max(maxY, 1));
  }
  view.s = sc;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fdfaf1'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.lineWidth = 2; ctx.font = '16px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of shapes) {
    const sel = s === selected; ctx.strokeStyle = sel ? '#b5473a' : '#2c2b27'; ctx.fillStyle = '#2a2118';
    if (s.type === 'box') { ctx.fillStyle = '#f0e2c0'; ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 8); ctx.fill(); ctx.stroke(); }
    else if (s.type === 'db') {
      const ry = Math.min(14, s.h / 4); ctx.fillStyle = '#dfe9d2';
      ctx.beginPath(); ctx.moveTo(s.x, s.y + ry); ctx.ellipse(s.x + s.w / 2, s.y + ry, s.w / 2, ry, 0, Math.PI, 0);
      ctx.lineTo(s.x + s.w, s.y + s.h - ry); ctx.ellipse(s.x + s.w / 2, s.y + s.h - ry, s.w / 2, ry, 0, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(s.x + s.w / 2, s.y + ry, s.w / 2, ry, 0, 0, Math.PI); ctx.stroke();
    } else if (s.type === 'arrow') {
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x2, s.y2); ctx.stroke();
      const a = Math.atan2(s.y2 - s.y, s.x2 - s.x);
      ctx.beginPath(); ctx.moveTo(s.x2, s.y2); ctx.lineTo(s.x2 - 12 * Math.cos(a - .4), s.y2 - 12 * Math.sin(a - .4)); ctx.lineTo(s.x2 - 12 * Math.cos(a + .4), s.y2 - 12 * Math.sin(a + .4)); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      continue;
    } else if (sel) { ctx.strokeRect(s.x - 4, s.y - 4, s.w + 8, s.h + 8); }
    ctx.fillStyle = '#2a2118'; ctx.fillText(s.label, s.x + s.w / 2, s.y + s.h / 2 + (s.type === 'db' ? 6 : 0), Math.max(s.w - 8, 20));
  }
}

// ---------- Expand / collapse ----------
let expanded = false;
function setExpanded(on) {
  if (on === expanded) return;
  expanded = on;
  $('board-wrap').classList.toggle('expanded', on);
  document.body.style.overflow = on ? 'hidden' : ''; document.body.classList.toggle('board-open', on);
  $('board-expand').textContent = on ? 'Collapse' : 'Expand';
  fitCanvas(); renderChat();
}
function fitCanvas() {
  if (expanded) requestAnimationFrame(() => { const r = canvas.getBoundingClientRect(); canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); draw(); });
  else { canvas.width = 1100; canvas.height = 520; draw(); }
}
$('board-expand').onclick = () => setExpanded(!expanded);
addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) setExpanded(false); });
addEventListener('resize', () => expanded && fitCanvas());

// Text description of the board so the interviewer/grader don't rely on the image alone.
function describeBoard() {
  const nodes = shapes.filter(s => s.type === 'box' || s.type === 'db');
  const near = (x, y) => { let best = null, bd = 60; for (const n of nodes) { const d = Math.hypot(Math.max(n.x - x, 0, x - (n.x + n.w)), Math.max(n.y - y, 0, y - (n.y + n.h))); if (d < bd) { bd = d; best = n; } } return best; };
  const name = n => n ? `${n.label || '(unlabeled)'}${n.type === 'db' ? ' [database]' : ''}` : '(nothing)';
  const lines = nodes.map(n => `- ${name(n)}`);
  const edges = shapes.filter(s => s.type === 'arrow').map(a => `- ${name(near(a.x, a.y))} -> ${name(near(a.x2, a.y2))}`);
  const notes = shapes.filter(s => s.type === 'text').map(s => `- "${s.label}"`);
  return `Components:\n${lines.join('\n') || '(none)'}\nConnections:\n${edges.join('\n') || '(none)'}\nAnnotations:\n${notes.join('\n') || '(none)'}`;
}

// ======================================================================
// Grading + results
// ======================================================================
async function grade() {
  show('results');
  $('results').innerHTML = '<div class="loading"><svg class="enso-draw" viewBox="0 0 120 120"><use href="#enso-path"/></svg><p>The interviewer is reviewing your bout…</p></div>';
  draw();
  const body = {
    problem: state.problem,
    stages: STAGES.map(s => ({ id: s.id, name: s.name, seconds: state.seconds[s.id] || 0, transcript: state.transcripts[s.id] || '',
      chat: (state.chats[s.id] || []).filter(m => !m.pending && !m.text.startsWith('(interviewer unavailable')).map(({ role, text }) => ({ role, text })) })),
    board: { description: describeBoard(), image: shapes.length ? canvas.toDataURL('image/png').split(',')[1] : null },
  };
  try {
    const r = await fetch('/api/grade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (!data.overall || !Array.isArray(data.stages)) throw new Error('Grader returned an unexpected format — hit Retry.');
    const before = rankInfo();
    saveHistory(data); store.del(SKEY);
    renderResults(data, { promoted: before ? beltFor(rankInfo().avg).min > beltFor(before.avg).min : true });
  } catch (e) {
    $('results').innerHTML = `<p class="error">Grading failed: ${esc(e.message)}</p><div class="row"><button class="btn seal" id="retry">Retry</button> <button class="btn ghost" id="home-btn">Home</button></div>`;
    $('retry').onclick = grade; $('home-btn').onclick = () => show('home');
  }
}

function saveHistory(result) {
  const entry = { date: Date.now(), problem: state.problem.title, result,
    seconds: Object.values(state.seconds).reduce((a, b) => a + b, 0),
    questions: Object.values(state.chats).flat().filter(m => m.role === 'user').length };
  store.set(HKEY, [entry, ...loadHistory()].slice(0, 100));
}

const list = (a, cls) => a?.length ? `<ul class="${cls}">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

function ensoSvg(score) {
  const r = 70, c = 2 * Math.PI * r, arc = Math.max(0, Math.min(100, score)) / 100 * c * .92;
  return `<svg viewBox="0 0 170 170"><circle cx="85" cy="85" r="${r}" fill="none" stroke="#ece6d8" stroke-width="10"/>
    <circle cx="85" cy="85" r="${r}" fill="none" filter="url(#brush)" stroke="#b5473a" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc} ${c}"/></svg>`;
}

function renderResults(d, { promoted = false, header = '' } = {}) {
  const score = Number(d.overall?.score) || 0, belt = beltFor(score);
  $('results').innerHTML = `${header}
    <div class="verdict">
      <div class="enso">${ensoSvg(score)}<div class="num"><div>${score}<small>OUT OF 100</small></div></div></div>
      <div><div class="level">${esc(d.overall?.level ?? '')}</div>
        <h2>${esc(belt.name === 'Black Belt' ? 'A true master.' : 'Your form this bout')}</h2>
        <div class="belt-banner">${beltPill(belt)}<span>${belt.name} performance</span></div>
        <p>${esc(d.overall?.summary ?? '')}</p>${promoted ? '<p><b style="color:var(--seal)">Your rank has risen.</b></p>' : ''}</div>
    </div>
    ${(d.stages || []).map((s, i) => `<div class="kata"><div class="num-badge">${STAGES[i]?.num ?? ''}</div><div>
      <h3><span>${esc(STAGES[i]?.name || s.id)}</span><span>${esc(s.score)}/10</span></h3>
      <div class="bar"><i style="width:${Math.max(0, Math.min(10, Number(s.score) || 0)) * 10}%"></i></div>
      ${list(s.strengths, 'good')}${list(s.gaps, 'gap')}<p class="tip"><b>Next time:</b> ${esc(s.tip ?? '')}</p></div></div>`).join('')}
    <div class="panel"><h3>Ground you never covered</h3>${list(d.missed_topics, 'gap')}</div>
    <div class="panel"><h3>What a master's answer covers</h3><p style="white-space:pre-wrap">${esc(d.reference_outline ?? '')}</p></div>
    <div class="row"><button class="btn seal" id="again">${header ? 'Back to the dojo' : 'Another bout'}</button></div>`;
  $('again').onclick = () => show('home');
  scrollTo(0, 0);
}

// ---------- History ----------
function renderHistory() {
  const h = loadHistory();
  $('history-wrap').classList.toggle('hidden', !h.length);
  if (!h.length) return;
  $('trend').innerHTML = trendSvg(h.slice(0, 20).reverse());
  $('history').innerHTML = h.slice(0, 15).map((e, i) => `<div class="hist-row" data-i="${i}">
    <span><b>${esc(e.problem)}</b> <span class="muted">${new Date(e.date).toLocaleString()} · ${Math.round(e.seconds / 60)} min · ${e.questions} message${e.questions === 1 ? '' : 's'} to interviewer</span></span>
    <span>${beltPill(beltFor(e.result.overall.score))} <b>${esc(e.result.overall.score)}</b>/100 · ${esc(e.result.overall.level)}</span></div>`).join('');
  document.querySelectorAll('.hist-row').forEach(r => r.onclick = () => {
    const e = h[r.dataset.i]; show('results');
    renderResults(e.result, { header: `<div class="panel"><b>${esc(e.problem)}</b> <span class="muted">${new Date(e.date).toLocaleString()}</span></div>` });
  });
}

function trendSvg(entries) {
  const W = 800, H = 110, pad = 16, n = entries.length;
  const x = i => n === 1 ? W / 2 : pad + i * (W - 2 * pad) / (n - 1), y = v => H - pad - v / 100 * (H - 2 * pad);
  const pts = entries.map((e, i) => `${x(i)},${y(e.result.overall.score)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#8aa081" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    ${entries.map((e, i) => `<circle cx="${x(i)}" cy="${y(e.result.overall.score)}" r="4" fill="#b5473a"><title>${esc(e.problem)}: ${e.result.overall.score}</title></circle>`).join('')}</svg>`;
}

// ---------- boot ----------
document.body.dataset.screen = 'home';
renderHome();
