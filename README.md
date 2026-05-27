# MeetLingo

**Real-time speech translation for multilingual meetings.**

A host speaks into their microphone — MeetLingo transcribes, translates, and delivers the speech to every listener in their own language, live.

🌐 **Live Demo:** [meetlingo-production.up.railway.app](https://meetlingo-production.up.railway.app)

---

## What it does

1. **Host** opens the host dashboard, selects their speaking language, and presses Start
2. **Listeners** join via QR code or link, pick their preferred language
3. Host speaks → listeners read the live translation on their phone

No app install required. Works in any browser.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Speech-to-Text | OpenAI Whisper |
| Translation | GPT-4o-mini (parallel, per active language) |
| Audio playback | Web Audio API |
| Deployment | Railway |

---

## Architecture

```
Host mic → PCM16 chunks → WAV → POST /api/host-translate
  → Whisper (transcribe once)
  → GPT-4o-mini × N active languages (parallel)
  → text pushed to in-memory queue

Listeners poll GET /api/listener-poll every 300ms
  → receive translated text
  → display live in chat-style UI
```

- **One transcription, N translations** — Whisper runs once regardless of how many listeners are connected
- **No WebSockets** — lightweight long-polling keeps Railway deployment simple
- **Session-aware** — listeners register with a session ID and language; server tracks active languages and only translates into languages someone actually needs

---

## Supported Languages

English · German · Spanish · French · Italian · Japanese · Portuguese · Turkish · Dutch · Korean · Chinese · Arabic · Russian · Polish · Swedish · Hindi · Greek · Ukrainian

---

## Running Locally

```bash
git clone https://github.com/TizianZM/meetlingo.git
cd meetlingo
npm install
```

Create a `.env` file:
```
OPENAI_API_KEY=your_key_here
```

```bash
npm start
# → http://localhost:3000
```

---

## Project Structure

```
meetlingo/
├── server.js              # Express server + all API endpoints
├── public/
│   ├── index.html         # Landing page (language selection + QR code)
│   ├── host.html          # Host dashboard (mic, agenda, listener stats)
│   ├── meeting.html       # Listener meeting view (live translation)
│   ├── preferences.html   # Language & volume settings
│   ├── waiting.html       # Listener wait screen
│   ├── ended.html         # Post-meeting feedback
│   └── js/
│       ├── translation.js # Mic capture → Whisper → API
│       ├── audio.js       # Audio playback (Web Audio API)
│       └── ui-lang.js     # UI translations for all 18 languages
```

---

Built by [Tizian Zimmermann](https://github.com/TizianZM)
