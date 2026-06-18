# MeetLingo

**Real-time speech translation for multilingual meetings.**

Everyone in the room can speak — MeetLingo translates each person's voice into every other participant's language, live, as speech **and** text. Same chat view for host and listeners.

🌐 **Live Demo:** [meetlingo-production.up.railway.app](https://meetlingo-production.up.railway.app)

---

## What it does

1. **Host** opens the host dashboard → gets a 6-character **meeting code** + QR link, picks a speaking language, presses Start.
2. **Listeners** scan the QR (or type the code), enter a name, pick their language → join the same room.
3. Anyone speaks → everyone else hears the **translated audio** and reads the live transcript in their own language. Same-language participants get the audio passed through untranslated.

Multiple meetings run in parallel and fully isolated. No app install — works in any browser.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express + `ws` WebSocket server |
| Speech translation | OpenAI **Realtime Translations** API (`gpt-realtime-translate`, speech-to-speech) |
| Text translation | `gpt-4o-mini` (agenda + UI strings) |
| Audio capture/playback | Web Audio API (24 kHz PCM16, gapless scheduling) |
| Deployment | Railway (auto-deploy from `master`) |

---

## Architecture

```
Speaker mic → PCM16 24kHz chunks → binary WS frame → server
  server silence-gate (peak > 300, 1.2s hangover) drops silence
  → per OTHER target language among participants:
       OpenAI translate-session "${speakerId}_${targetLang}" (WS)
       → translated audio (PCM16 → WAV) broadcast to that language
       → translated + source transcripts broadcast for the chat
  → same-language participants: audio passed through, no translation

Client receives { type:'audio' } → gapless playback via Web Audio API
```

- **Per-room state** — `rooms: Map(code → Room)`; each host owns an isolated room with its own participants, agenda and translate-sessions. Empty rooms are reaped after 1h idle.
- **Host authentication** — host actions (start/end/agenda/mute) are gated by a secret `hostToken` (`crypto.timingSafeEqual`); REST returns 403 and WS downgrades an impostor `role:host` join to listener.
- **Bidirectional** — every connected client can enable their mic and speak; translation routes by target language.
- **WebSocket, not polling** — a single `/ws/meeting` connection carries audio frames, transcripts and control messages both ways.
- **Resilient sessions** — translate-sessions are lazily opened per `(speaker, language)`, buffer audio during the handshake so the first words aren't lost, auto-recover on error/close, and are pruned when no listener needs that language.

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
├── server.js              # Express + ws server, per-room state, host auth, translate pipeline
├── public/
│   ├── index.html         # Landing — meeting code (?room= or manual) + language
│   ├── login.html         # Email entry
│   ├── verify.html        # Email code (auth bypassed server-side)
│   ├── name.html          # Name onboarding
│   ├── preferences.html   # Target language + volume
│   ├── waiting.html       # Listener wait screen (joins room over WS)
│   ├── meeting.html       # Listener meeting view (can also speak)
│   ├── host.html          # Host dashboard (mic, agenda, code/QR, participants)
│   ├── ended.html         # Post-meeting feedback
│   └── js/
│       ├── realtime.js    # WS client: mic capture, PCM16 upload, gapless playback
│       ├── chat.js        # Shared chat renderer (one card per speaker turn)
│       ├── waveform.js    # AnalyserNode bar visualization
│       └── ui-lang.js     # UI translations for all 18 languages
```

> `public/js/audio.js` and `translation.js` belong to the retired Whisper/long-polling
> pipeline and are no longer used.

---

Built by [Tizian Zimmermann](https://github.com/TizianZM)
