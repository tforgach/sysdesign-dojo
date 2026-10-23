// Zero-dependency server: serves ./public and proxies grading requests to the Anthropic API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const GRADER_MODEL = process.env.GRADER_MODEL || 'sonnet';        // aliases or full ids, passed to `claude --model`
const INTERVIEWER_MODEL = process.env.INTERVIEWER_MODEL || 'haiku'; // fast replies for the chat
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

// Cost / abuse guards: every request spends Claude subscription usage, so cap it.
const MAX_CONCURRENT = 2;                                        // simultaneous claude processes
const MAX_CALLS_PER_HOUR = Number(process.env.MAX_CALLS_PER_HOUR) || 150;
const CLAUDE_TIMEOUT_MS = 180e3;                                 // kill a hung process
const MAX_BODY = 8e6, MAX_IMAGE_B64 = 6e6;
let inFlight = 0; const callLog = [];
function reserveCall() {
  const cutoff = Date.now() - 3600e3;
  while (callLog.length && callLog[0] < cutoff) callLog.shift();
  if (inFlight >= MAX_CONCURRENT) throw Object.assign(new Error('Busy: too many requests at once, try again in a moment'), { status: 429 });
  if (callLog.length >= MAX_CALLS_PER_HOUR) throw Object.assign(new Error(`Hourly limit of ${MAX_CALLS_PER_HOUR} AI calls reached`), { status: 429 });
  callLog.push(Date.now()); inFlight++;
}
const allowedHosts = () => [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const SYSTEM = `You are a staff-level engineer conducting a system design interview using the Hello Interview delivery framework:
1. Functional requirements  2. Non-functional requirements  3. Core entities  4. API / interface  5. High-level design (whiteboard)  6. Deep dives.

You will receive the candidate's spoken transcript for each stage (auto-transcribed, so ignore minor transcription errors and filler words) and, for the high-level design, a description of their whiteboard plus an image of it.

Grade like a real interviewer calibrating for a senior engineer. Be specific and honest: quote or reference what the candidate actually said or drew, name concrete things they missed (e.g. "no mention of idempotency on the payment endpoint"), and do not invent content they did not say. An empty or very thin stage should score very low.

Stage expectations:
- Asking the interviewer good clarifying questions (scope, scale, users, constraints) is a positive signal in the requirements stages; asking none is a gap. Do not penalize a candidate for a number the interviewer gave them.
- Functional requirements: small, prioritized set ("Users should be able to..."), scoped sensibly, below-the-line items called out, clarifying questions asked.
- Non-functional: quantified and problem-specific (latency, availability vs consistency, scale, durability), not a generic list; tradeoffs named (e.g. CAP choice for this problem).
- Core entities: right nouns, key fields, relationships; not over-detailed.
- API: REST/RPC endpoints mapped to functional requirements, correct verbs and resources, request/response shapes, auth taken from tokens not body, pagination where relevant.
- In the high-level design and deep dives the interviewer interjects with probing questions (see the Q&A lines). Judge how well the candidate answered each probe — specificity, tradeoffs, correctness, staying composed — and weigh this heavily in those two stages. Probes the candidate never answered should count against them.
- High-level design: components satisfy every functional requirement, clear data flow, sensible data store choices with justification, no premature optimization, whiteboard readable and consistent with what was said.
- Deep dives: addresses the non-functional requirements and the real bottlenecks (scale, contention, consistency, failure modes, caching, sharding), weighs alternatives and tradeoffs, drives the conversation proactively.

Respond with ONLY a JSON object, no markdown fences, matching:
{
 "overall": {"score": <0-100>, "level": "<No hire | Lean no hire | Lean hire | Hire | Strong hire>", "summary": "<3-4 sentences>"},
 "stages": [ {"id": "functional|nonfunctional|entities|api|hld|deepdives", "score": <0-10>, "strengths": ["..."], "gaps": ["..."], "tip": "<one concrete thing to do next time>"} ],
 "missed_topics": ["<important topics for this specific problem never touched>"],
 "reference_outline": "<a concise outline of what a strong answer would have covered for this problem, esp. deep dives>"
}
The stages array must contain all six stages in order.`;

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const INTERVIEWER = `You are the interviewer in a system design interview, playing a realistic, friendly staff engineer. The candidate asks you clarifying questions while working through a stage of the Hello Interview framework.

Rules:
- Answer in 1-3 sentences, in first person, like a real interviewer in a live conversation.
- If asked about requirements, scope, scale or constraints, give a concrete, realistic answer (invent sensible numbers such as DAU, read/write ratio, latency expectations) and stay consistent with anything you said earlier in the conversation.
- Never design the system for the candidate or reveal "the answer". If they ask "what should the architecture be?" or "what database should I use?", turn it back: "What are you leaning toward and why?"
- If a question is vague, answer briefly and nudge them to be more specific. If they ask something out of scope, say so.
- You may mention that a requirement is something you'd like covered if they are missing something obvious, but only as a light nudge after they ask for guidance.`;

// Runs headless Claude Code (`claude -p`), so calls use your logged-in Claude subscription — no API key.
// Runs from an empty temp dir with tools/MCP/settings off so no project context leaks into the interview.
let workDir;
function claude({ system, prompt, model, imageB64 }) {
  workDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'sysdesign-'));
  const args = ['-p', '--output-format', 'json', '--system-prompt', system, '--model', model,
    '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', ''];
  let img;
  if (imageB64) {
    img = path.join(workDir, `board-${Date.now()}-${process.pid}.png`);
    fs.writeFileSync(img, Buffer.from(imageB64, 'base64'));
    prompt = `The candidate's whiteboard image is at ${img} — read it with the Read tool before grading.\n\n${prompt}`;
    args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', workDir);
  } else args.push('--tools', '');
  reserveCall(); let released = false; const release = () => { if (!released) { released = true; inFlight--; } };
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd: workDir, env: { ...process.env, ANTHROPIC_API_KEY: '' } }); // blank key → force subscription auth
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), CLAUDE_TIMEOUT_MS);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); release(); reject(new Error(e.code === 'ENOENT' ? '`claude` CLI not found on PATH' : e.message)); });
    p.on('close', code => {
      clearTimeout(timer); release(); if (img) fs.unlink(img, () => {});
      try { const j = JSON.parse(out); if (j.is_error) throw new Error(j.result); resolve(j.result); }
      catch (e) { reject(new Error(code ? (err || out || `claude exited ${code}`).slice(0, 400) : e.message)); }
    });
    p.stdin.end(prompt);
  });
}

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';

function jsonReply(res) {
  return (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
}

const PROBING = `This stage is a live back-and-forth, so you actively probe the candidate like a sharp interviewer.
- When asked to probe: ask exactly ONE pointed question (max 2 sentences) about the weakest or least-justified part of what they have said and drawn so far. Good targets: a functional requirement not yet covered by the diagram, a single point of failure, a hot key or hot partition, a race condition or double-booking/double-spend, consistency vs availability, an unjustified datastore choice, what happens on failure, scale math that does not add up, cache invalidation, retries/idempotency. Be specific to THIS design (name their components), never generic. Do not repeat a question already asked in the conversation.
- In the deep-dive stage, go one level deeper than they went; do not accept hand-waving ("we'd just shard it") — ask how.
- When the candidate answers one of your probes: react like a real interviewer — at most half a sentence of neutral acknowledgement (never say right/wrong or grade them aloud), then EITHER one sharper follow-up that goes a level deeper, OR if they handled it well, pivot to a different weakness with a new probe. Keep it to 1-3 sentences.
- If they instead ask you a clarifying question, answer it plainly and briefly.`;

async function interview(req, res) {
  const send = jsonReply(res);
  try {
    const b = JSON.parse(await readBody(req)); // history: [{role:'user'|'assistant', text}]
    if (!b.problem || !Array.isArray(b.history)) throw bad('Bad request');
    const problem = { title: str(b.problem.title, 200), prompt: str(b.problem.prompt, 2000) };
    const stage = str(b.stage, 100), stageId = str(b.stageId, 30), probe = !!b.probe, context = b.context || {};
    const history = b.history.slice(-40).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: str(m.text, 2000) }));
    const probing = stageId === 'hld' || stageId === 'deepdives';
    let system = `${INTERVIEWER}\n\nThe problem: ${problem.title}. ${problem.prompt}\nCurrent stage: ${stage}.`;
    if (probing) system += `\n\n${PROBING}`;
    if (context?.transcript) system += `\n\nWhat the candidate has said so far in this stage (auto-transcribed):\n${String(context.transcript).slice(-6000)}`;
    if (context?.board) system += `\n\nTheir whiteboard right now:\n${String(context.board).slice(0, 2000)}`;
    const convo = history.map(m => `${m.role === 'user' ? 'Candidate' : 'Interviewer'}: ${m.text}`).join('\n') || '(no conversation yet)';
    const prompt = probe
      ? `Conversation so far:\n${convo}\n\nThe candidate paused. Probe them now with your next question. Output only the question.`
      : `Conversation so far:\n${convo}\n\nReply as the interviewer to the candidate's last message. Output only your reply.`;
    send(200, { reply: (await claude({ system, prompt, model: INTERVIEWER_MODEL })).trim() });
  } catch (e) { send(e.status || 500, { error: e.message }); }
}

async function grade(req, res) {
  const send = jsonReply(res);
  try {
    const b = JSON.parse(await readBody(req));
    if (!b.problem || !Array.isArray(b.stages) || !b.board) throw bad('Bad request');
    if (b.board.image && (typeof b.board.image !== 'string' || b.board.image.length > MAX_IMAGE_B64)) throw bad('Whiteboard image too large');
    const problem = { title: str(b.problem.title, 200), prompt: str(b.problem.prompt, 2000) };
    const stages = b.stages.slice(0, 6).map(s => ({ id: str(s.id, 30), name: str(s.name, 100), seconds: Number(s.seconds) || 0, transcript: str(s.transcript, 20000),
      chat: Array.isArray(s.chat) ? s.chat.slice(-40).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: str(m.text, 2000) })) : [] }));
    const board = { description: str(b.board.description, 4000), image: b.board.image };
    const text = [`PROBLEM: ${problem.title}\n${problem.prompt}`]
      .concat(stages.map(s => `\n===== STAGE: ${s.name} (id: ${s.id}) — ${s.seconds}s spent =====\n${s.transcript.trim() || '(candidate said nothing)'}${s.chat?.length ? `\n--- Clarifying Q&A with the interviewer in this stage ---\n${s.chat.map(m => `${m.role === 'user' ? 'Candidate' : 'Interviewer'}: ${m.text}`).join('\n')}` : '\n--- The candidate asked the interviewer no questions in this stage ---'}`))
      .concat([`\n===== WHITEBOARD DESCRIPTION =====\n${board.description || '(empty whiteboard)'}`]).join('\n');
    // Model output is occasionally malformed JSON (e.g. a dropped closing bracket): try cheap repairs, then retry.
    const parse = raw => {
      const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      for (const tail of ['', ']}', '}', ']}}', '}}']) {
        let j; try { j = JSON.parse(body + tail); } catch { continue; }
        if (j?.overall && Array.isArray(j.stages) && j.stages.length === 6) return j; // right shape, not just valid JSON
      }
      throw new Error('Grader returned malformed or incomplete JSON');
    };
    let result, lastErr;
    for (let attempt = 0; attempt < 3 && !result; attempt++) {
      try { result = parse(await claude({ system: SYSTEM, prompt: text, model: GRADER_MODEL, imageB64: board.image })); }
      catch (e) { lastErr = e; }
    }
    if (!result) throw lastErr;
    send(200, result);
  } catch (e) {
    send(e.status || 500, { error: e.message });
  }
}

http.createServer((req, res) => {
  const deny = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(msg); };
  // Blocks DNS rebinding: only answer requests addressed to localhost on our port.
  if (!allowedHosts().includes(req.headers.host)) return deny(403, 'Forbidden host');
  if (req.method === 'POST') {
    // Blocks other websites from driving the API from your browser (CSRF): same-origin JSON only.
    if (!allowedHosts().some(h => req.headers.origin === `http://${h}`)) return deny(403, 'Forbidden origin');
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return deny(415, 'JSON only');
  } else if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'Method not allowed');
  if (req.method === 'POST' && req.url === '/api/grade') return grade(req, res);
  if (req.method === 'POST' && req.url === '/api/interview') return interview(req, res);
  if (req.method === 'POST') return deny(404, 'Not found');
  let rel; try { rel = decodeURIComponent(req.url.split('?')[0]); } catch { return deny(400, 'Bad URL'); }
  const file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, HOST, () => console.log(`System Design Dojo → http://localhost:${PORT}`)); // localhost only: requests spend your Claude subscription
