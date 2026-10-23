// Zero-dependency server: serves ./public and proxies grading requests to the Anthropic API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const GRADER_MODEL = process.env.GRADER_MODEL || 'sonnet';        // aliases or full ids, passed to `claude --model`
const INTERVIEWER_MODEL = process.env.INTERVIEWER_MODEL || 'haiku'; // fast replies for the chat
const PUBLIC = path.join(__dirname, 'public');
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

function readBody(req, limit = 25e6) {
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
  if (imageB64) {
    const img = path.join(workDir, `board-${Date.now()}.png`);
    fs.writeFileSync(img, Buffer.from(imageB64, 'base64'));
    prompt = `The candidate's whiteboard image is at ${img} — read it with the Read tool before grading.\n\n${prompt}`;
    args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', workDir);
  } else args.push('--tools', '');
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd: workDir, env: { ...process.env, ANTHROPIC_API_KEY: '' } }); // blank key → force subscription auth
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => reject(new Error(e.code === 'ENOENT' ? '`claude` CLI not found on PATH' : e.message)));
    p.on('close', code => {
      try { const j = JSON.parse(out); if (j.is_error) throw new Error(j.result); resolve(j.result); }
      catch (e) { reject(new Error(code ? (err || out || `claude exited ${code}`).slice(0, 400) : e.message)); }
    });
    p.stdin.end(prompt);
  });
}

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
    const { problem, stage, stageId, history, context, probe } = JSON.parse(await readBody(req)); // history: [{role:'user'|'assistant', text}]
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
  } catch (e) { send(500, { error: e.message }); }
}

async function grade(req, res) {
  const send = jsonReply(res);
  try {
    const { problem, stages, board } = JSON.parse(await readBody(req));
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
    send(500, { error: e.message });
  }
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/grade') return grade(req, res);
  if (req.method === 'POST' && req.url === '/api/interview') return interview(req, res);
  const file = path.join(PUBLIC, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`System Design Dojo → http://localhost:${PORT}`)); // localhost only: requests spend your Claude subscription
