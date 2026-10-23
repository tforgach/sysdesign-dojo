# System Design Dojo

Practice system design interviews using the [Hello Interview](https://www.hellointerview.com) delivery framework. You get a realistic problem (Ticketmaster, WhatsApp, a rate limiter, and 30+ more) and work through six stages:

1. Functional requirements
2. Non-functional requirements
3. Core entities
4. API / interface
5. High-level design (whiteboard)
6. Deep dives

Speak your answers (browser dictation), ask the AI interviewer clarifying questions, and draw your architecture on a whiteboard. In the whiteboard and deep-dive stages the interviewer probes your design. At the end an LLM grades the whole session, awards a belt, and saves it to your history.

## Requirements

- Node.js 18+
- [Claude Code](https://claude.com/claude-code) CLI installed and logged in (`claude` on your PATH). Interviewer and grading calls run headless through it, using your Claude subscription. No API key needed.
- A Chromium-based browser (Chrome/Edge) for speech recognition.

## Run

```
node server.js
```

Open http://localhost:3000.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Bind address. Keep it local: requests spend your Claude usage |
| `GRADER_MODEL` | `sonnet` | Model for end-of-session grading |
| `INTERVIEWER_MODEL` | `haiku` | Model for interviewer chat |

History and in-progress sessions are stored in your browser's localStorage. Nothing is saved server-side.

## License

MIT
