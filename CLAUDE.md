# MeetLingo — Technical Memory
_Zuletzt aktualisiert: Juni 2026 (Meeting-Räume + Host-Auth + Chat-Redesign)_

---

## Architecture

### Stack
- **server.js** — Node.js + Express **+ `ws` WebSocket-Server** (`/ws/meeting`). Express dient nur noch für Hilfs-REST-Endpoints; die gesamte Audio-/Translation-Pipeline läuft über WebSocket. **State ist pro Raum** (siehe „Meeting-Räume").
- **public/js/realtime.js** — Browser-WebSocket-Client (bidirektional): Mic-Capture, PCM16-Upload, gapless Audio-Playback, Sprach-/Namens-Wechsel. Sendet `room` (+ Host `hostToken`) beim Join.
- **public/js/chat.js** — **Geteilter Chat-Renderer** (`window.MeetLingoChat`). Eine Karte pro Sprecher-Turn: `Name + Sprachkürzel` + Originaltext + Übersetzungs-Box. Wird von Host **und** Listener identisch genutzt.
- **public/js/waveform.js** — `AnalyserNode`-basierte Balken-Visualisierung (`MeetLingoWaveform.start/stop`).
- **public/js/audio.js** — **veraltet/ungenutzt.** Playback läuft jetzt in realtime.js. Nicht mehr eingebunden.
- **public/js/ui-lang.js** — Geteilte UI-Übersetzungen für alle Onboarding/Post-Meeting Seiten.
- **OpenAI Realtime Translations API** — `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate` (Speech-to-Speech). Zusätzlich `gpt-4o-mini` für Text-Übersetzung (Agenda/UI).

---

## Meeting-Räume + Host-Auth (wichtig — seit Juni 2026)

**Kein globales Meeting mehr.** Jeder Host besitzt einen **Raum** mit eigenem State. Mehrere Meetings laufen parallel & isoliert.

```js
// server.js
rooms     : Map(code -> Room)   // code = 6-stellig, Alphabet ohne I/O/0/1
wsToRoom  : Map(ws -> code)      // schnelle Zuordnung bei message/close
Room = {
  code, hostToken,              // hostToken = crypto-random Secret, NUR der Host kennt es
  active, startTime, agenda,
  participants: Map(ws -> { id, name, lang, role, muted, speaking, isHost }),
  translateSessions: Map("speakerId_targetLang" -> session),
  speakerTimers: Map, lastActivity
}
// Leere Räume werden nach 1h idle gereapt (ROOM_TTL_MS).
```

### Ablauf
1. **Host** lädt host.html → Bootstrap (`window._roomReady`): stored `meetlingo_room`+`meetlingo_host_token` reused wenn Server den Raum noch kennt, sonst `POST /api/create-room` → `{ room, hostToken }`. Code wird angezeigt (`#host-room-code`), QR-Link = `…/?room=CODE`.
2. **Gast** scannt QR → `index.html?room=CODE` → Code-Feld vorausgefüllt (oder manuell tippen) → `meetlingo_room` gesetzt → wandert über localStorage durchs Onboarding.
3. Alle REST/WS-Calls tragen `room`; **Host-Aktionen tragen `hostToken`**.

### Host-Authentifizierung
- **REST** `meeting-start`/`-end`/`agenda` (POST): ohne gültiges `hostToken` → **403** (`hostOk()` via `crypto.timingSafeEqual`).
- **WS join** mit `role:'host'`: Token falsch → **Downgrade zu Listener** (`isHost=false`).
- **WS** `mute_participant`/`meeting_end`: nur wenn `self.isHost` (sonst ignoriert).
- localStorage: `meetlingo_room` (Host+Gast), `meetlingo_host_token` (nur Host, geheim).
- **In-memory:** Server-Neustart löscht Räume → Host erzeugt beim Laden automatisch einen neuen (`onMLRoomNotFound` als Safety-Net beim WS-Join).

### Seiten-Übersicht

| Datei | Zweck |
|-------|-------|
| `index.html` | Startseite — **Meeting-Code** (aus `?room=` oder manuell) + Sprachauswahl |
| `login.html` | E-Mail eingeben |
| `verify.html` | 6-stelligen **E-Mail**-Code eingeben (Server bypassed → immer gültig) |
| `name.html` | Name-Onboarding (setzt `meetlingo_name`) |
| `preferences.html` | Zielsprache + Lautstärke wählen, dann START LISTENING → waiting.html |
| `waiting.html` | Listener-Wartescreen; **joint Raum per WS** (zählt im Host-Setup mit) |
| `meeting.html` | Listener-Meetingscreen (Translation läuft, kann auch selbst sprechen) |
| `host.html` | Host-Screen (Mic, Agenda, Timer, Teilnehmer, START/END) |
| `ended.html` | Post-Meeting Bewertung + E-Mail-Summary |
| `confirmation.html` | Host-Bestätigungsscreen nach END |

---

## Translation Pipeline (WebSocket — bidirektional)

### Konzept: Jeder Teilnehmer kann sprechen
**NICHT** mehr REST-Polling. **NICHT** die OpenAI Chat-Realtime API — sondern die **Realtime _Translations_** API.
Jeder verbundene Client (Host **und** Listener) kann Mic aktivieren und sprechen. Routing nach Zielsprache:

```
SPEAKER Mic → PCM16 24kHz chunks → binary WS frame → server
  server Silence-Gate (peak > 300, 1200ms Hangover) verwirft Stille
  → für jede ANDERE Zielsprache unter den Teilnehmern:
       translateSession "${speakerId}_${targetLang}" (OpenAI WS)
       → session.output_audio.delta (PCM16 24kHz) → WAV → broadcast an targetLang
       → session.output_transcript.delta → broadcast an targetLang
       → session.input_transcript.delta → source_transcript an alle außer Speaker
  → Teilnehmer mit GLEICHER Sprache: Audio direkt durchgereicht (keine Übersetzung)

LISTENER/CLIENT empfängt { type:'audio', audio } → realtime.js _scheduleChunk()
  → gapless geplant via decodeAudioData (24kHz AudioContext)
```

### Translate-Session-Lifecycle (server.js)
- `translateSessions: "${speakerId}_${targetLang}" → { ws, active, pending[], ... }`
- Lazy erstellt beim ersten Audio-Chunk für eine neue Zielsprache (`openTranslateSession`).
- **Handshake-Buffering:** Chunks die während `session.created`→`session.updated` ankommen werden in `pending[]` gepuffert (max 100 ≈ 17s) und nach `session.updated` geflusht → erste Worte gehen nicht verloren.
- **Auto-Recovery:** Bei `error`/`close`/`ws error` wird die Session aus der Map entfernt → nächster Chunk öffnet transparent eine neue. Late-close evictet keine neu geöffnete Session (Identitäts-Check `translateSessions.get(key) === session`).
- **Pruning:** `pruneOrphanedSessions()` schließt Sessions, deren Zielsprache keine Zuhörer mehr hat (bei lang_change / disconnect). `closeSpeakerSessions(id)` bei Disconnect. `closeAllTranslateSessions()` bei Meeting-Ende.

### Silence-Gate (server, binary handler)
```js
// Always-on Mic streamt sonst Stille → OpenAI-Input-Buffer wächst → Translation stallt.
// readInt16LE (NICHT Int16Array-View — ws-Buffer können unaligned sein → throw bei odd offset)
if (peak > 300) speaker.lastLoud = now;            // ~1% full scale
if (!speaker.lastLoud || now - speaker.lastLoud > 1200) return;  // 1.2s Hangover
```

### WS-Nachrichtenprotokoll
**Client → Server (JSON):** `join {room, lang, role, name, hostToken?}` (Host sendet `hostToken`), `lang_change {lang}`, `name_change {name}`, `mute_participant {targetId}` (nur authed Host), `meeting_end` (nur authed Host), `ping`. **Binary frame:** roher PCM16 24kHz.
**Server → Client (JSON):** `joined {id, name, role, active, startTime}`, `room_not_found`, `audio {audio}`, `transcript {text, speakerId, name, sourceLang}`, `source_transcript {text, name, lang, speakerId}`, `speaker_active/_inactive`, `participant_list`, `participant_left`, `agenda_update`, `meeting_started`, `meeting_ended`, `pong`, `error`.

> **Chat-Pairing:** `transcript` (Übersetzung) trägt jetzt `speakerId/name/sourceLang`, damit chat.js Original (`source_transcript`) + Übersetzung zur **selben Karte** zusammenführt.

### REST-Endpoints (server.js) — alle raum-scoped
```js
POST /api/send-code, /api/verify-code   → Auth gebypassed (immer success)
POST /api/create-room                   → { success, room, hostToken }  (jeder darf erstellen)
POST /api/agenda   { room, hostToken, agenda }  → 403 ohne Token; broadcast agenda_update
GET  /api/agenda?room=CODE              → { agenda }
POST /api/meeting-start { room, hostToken }     → 403 ohne Token; active=true, broadcast meeting_started
POST /api/meeting-end   { room, hostToken }     → 403 ohne Token; closeAllTranslateSessions, broadcast meeting_ended
GET  /api/meeting-status?room=CODE      → { exists, active, startTime }  ← autoritativ (auch Timer-Quelle)
GET  /api/listener-stats?room=CODE      → { counts, total } aus room.participants
POST /api/translate-text { text, targetLanguage } → gpt-4o-mini, Text-only, stateless (kein Raum)
POST /api/send-summary-email            → No-Op-Stub (Admin aktiviert später echten Versand)
// ENTFERNT: /api/meeting-time (→ meeting-status), /api/reset-session,
//           /api/listener-register, /api/listener-poll
```

### window.ML_HOST_MODE Flag
```js
// host.html setzt VOR realtime.js:  window.ML_HOST_MODE = true;
// realtime.js: role     = ML_HOST_MODE ? 'host' : 'listener'
//              _langKey  = ML_HOST_MODE ? 'meetlingo_host_lang' : 'meetlingo_lang'
//              _nameKey  = ML_HOST_MODE ? 'meetlingo_host_name' : 'meetlingo_name'
//   → Host-Sprache/-Name kontaminieren nicht die Listener-Prefs im selben Browser
//   → Host sendet zusätzlich hostToken beim join (role==='host')
```

### realtime.js — Public API (`window.MeetLingoRealtime`)
```
connect, startMic(onGranted,onDenied), setMuted, isMuted, setLang, setName,
endMeeting, muteParticipant, disconnect, setVolume, unlockAudio,
getInputAnalyser, getOutputAnalyser, getMyId
```
Window-Callbacks die Seiten setzen: `onMLConnected, onMLTranscript, onMLSourceTranscript,
onMLSpeakerActive/Inactive, onMLParticipants, onMLParticipantLeft, onMLAgendaUpdate,
onMLMeetingStarted/Ended, onMLAudioActivity, onMLError`.

### Audio-Parameter (realtime.js)
```js
AudioContext({ sampleRate: 24000 })      // OpenAI Realtime Translations = 24kHz
createScriptProcessor(4096, 1, 1)
// Resample-Fallback wenn ctx.sampleRate ≠ 24000 (alte Browser ignorieren die Option)
// Float32 → PCM16 mit 2x Gain
// Silence-Gate-Schwelle clientseitig für Waveform/Activity: vol > 0.01
// Gapless: _nextPlayAt, _MAX_BUFFER_AHEAD = 3.0s, _activeSources[] (stop bei lang_change)
```

### Script-Reihenfolge
```html
<!-- host.html -->
<script>window.ML_HOST_MODE = true;</script>
<script src="/js/realtime.js"></script>
<script src="/js/waveform.js"></script>
<script src="/js/chat.js"></script>

<!-- meeting.html (Listener — kann ebenfalls sprechen) -->
<script src="/js/realtime.js"></script>
<script src="/js/waveform.js"></script>
<script src="/js/chat.js"></script>

<!-- waiting.html lädt jetzt auch realtime.js → joint per WS, damit der Host
     Wartende sofort im Connected-Guests-Zähler sieht -->
```

### chat.js — `window.MeetLingoChat`
```js
init(containerEl, { emptyText })       // Container muss flex-column sein
addSource(speakerId, name, srcLang, delta)        // Original (foreign) deltas
addTranslation(speakerId, name, srcLang, delta)   // Übersetzungs-deltas (eigene Sprache)
setEmptyText(t) / reset()
// 1 Karte je Sprecher-Turn (keyed by speakerId), finalisiert nach 2.6s Stille.
// Eigene Nachrichten erscheinen NICHT (Server excludet den Sprecher).
// meeting.html mountet in #conversation-history, host.html in #active-transcript.
```

---

## OpenAI Account — Modell-Eigenheiten

Dieser Account hat **andere Modellnamen** als Standard-OpenAI:

| Verfügbar | Standard-Name (funktioniert NICHT) |
|-----------|-------------------------------------|
| `gpt-realtime` | `gpt-4o-realtime-preview` ❌ |
| `gpt-realtime-translate` | `gpt-4o-realtime-preview-2024-10-01` ❌ |
| `gpt-realtime-mini` | `gpt-4o-mini-realtime-preview` ❌ |

Die **Chat-Realtime** API wurde aufgegeben (verhielt sich wie Chatbot, sendete kein Audio). Die aktuelle Pipeline nutzt die **Translations**-Variante (`/v1/realtime/translations`) — diese liefert echtes übersetztes Audio + Transcripts.

---

## localStorage Keys (vollständig)

| Key | Inhalt | Gesetzt von |
|-----|--------|-------------|
| `meetlingo_room` | Raum-Code (6-stellig) | index.html (?room=), host.html bootstrap |
| `meetlingo_host_token` | **Geheimes** Host-Token für den eigenen Raum | host.html (create-room) |
| `meetlingo_lang` | Listener-Zielsprache z.B. `"Spanish"` | index.html, preferences.html |
| `meetlingo_host_lang` | Host-Sprechsprache (getrennt von Listener!) | realtime.js (ML_HOST_MODE) |
| `meetlingo_name` | Listener-Anzeigename | name.html, realtime.js setName |
| `meetlingo_host_name` | Host-Anzeigename (getrennt, mirror zu host_lang) | host.html, realtime.js setName |
| `meetlingo_volume` | Lautstärke 0–100 (Integer) | preferences.html |
| `meetlingo_meeting_start` | Timestamp bei Host-Start | host.html `startTimer()` |
| `meetlingo_meeting_end` | Timestamp bei Host-End | host.html END-Button |
| `meetlingo_meeting_active` | `'true'` wenn Meeting läuft, gelöscht bei END | host.html |
| `meetlingo_agenda` | Agenda-Text vom Host | host.html Save-Button |
| `meetlingo_email` | E-Mail-Adresse des Listeners | login.html |
| `meetlingo_rating` | Sterne-Bewertung 1–5 | ended.html |
| `meetlingo_summary` | Meeting-Summary-Text | ended.html / host summary |

### Timer / „läuft gerade"
- **Autoritativ ist der Server:** `joined`-Message + `GET /api/meeting-status` liefern `{ active, startTime }`. Host-Reload-Recovery basiert darauf (nicht mehr auf unconditional cleanup).
- `meetlingo_meeting_start` bleibt nach Meetings in localStorage → **NICHT** als „läuft gerade"-Check verwenden. Stattdessen `meetlingo_meeting_active === 'true'` bzw. Server-Status.
- meeting.html setzt `meetlingo_meeting_start` **NICHT** selbst (sonst Zeitverlust) — liest nur Server-`startTime`.

---

## Meeting-Flow (Listener)

```
(QR /?room=CODE oder Code tippen) → index.html [room gesetzt]
  → login.html → verify.html → name.html → preferences.html
  → waiting.html  [joint Raum per WS; onMLConnected.active ODER meeting_started → meeting.html]
  → meeting.html  [prüft meeting-status?room: !exists→index, !active→waiting]
```

## Meeting-Flow (Host)

```
host.html → _roomReady (reuse stored room ODER create-room) → Code+QR anzeigen → WS connect
          → START → startMic() → POST /api/meeting-start {room,hostToken}, broadcast meeting_started
          → END   → POST /api/meeting-end {room,hostToken} + WS meeting_end → confirmation.html
```

---

## host.html — Zwei Views (Setup + Active)

```
host-setup-view  → sichtbar beim Laden (Agenda, Stats, QR)
host-active-view → sichtbar nach START (Teilnehmer-Panel, Mute, Transcription, Waveforms)
```

Bei START (direkt im user-gesture chain — Mic-Permission!):
```js
document.getElementById('host-setup-view').style.display = 'none';
document.getElementById('host-active-view').style.display = 'flex';
MeetLingoRealtime.startMic(...);  // synchron aus dem Click heraus
```

---

## Features (aktueller Stand)

- **Meeting-Räume + Host-Auth** — siehe eigener Abschnitt oben.
- **Einheitliches Chat-Design (Host + Listener)** — chat.js: eine Karte je Turn, `Name + Sprachkürzel` + Originaltext + Übersetzungs-Box in der eigenen Sprache.
- **Bidirektionale Übersetzung** — jeder Teilnehmer kann sprechen, gleiche Sprache wird direkt durchgereicht.
- **Zwei Waveform-Boxen für ALLE** — „Your Voice" (eigene, grün, Input-Analyser) + „Others/Listeners" (blau, Output-Analyser). Listener-Input-Wave startet bei Mic-Start.
- **Teilnehmer-Panel (Host)** — `participant_list`, Speaking-Highlight, Mute-Buttons.
- **Host-Mute mit Enforcement** — Host mutet → Listener wird **zwangs-gemutet, Mic-Knopf gesperrt** (🔒, opacity 0.55, nicht klickbar) + lokalisiertes Banner (`MUTED_BY_HOST` map in meeting.html). Suppress no-signal-bar währenddessen.
- **Live-Agenda** — In-Meeting-Bearbeitung via `agenda_update`, pro Raum.
- **Wartezimmer-Zähler** — waiting.html joint per WS → Host sieht Wartende live im Setup-View (`#guest-count` aus `participant_list`).
- **Name-Onboarding** — name.html, server-seitig sanitisiert.

## Sicherheit / Hardening (server.js)
- **Host-Token** gated jede Host-Aktion (REST 403 / WS-Downgrade) — `crypto.timingSafeEqual`.
- `sanitizeLang()` (Whitelist → sonst English), `sanitizeName()` (entfernt `<>&"'`, max 40 Zeichen).
- Mute/End nur für authentifizierten Host (`self.isHost`), nicht nur Rolle.
- HTML-Escaping der Teilnehmernamen.
- Raum-IDs/Token via `crypto` (randomInt / randomBytes), nicht `Math.random`.
- `.env` (OpenAI API Key) **NIEMALS** committen; muss in `.gitignore`.

---

## UI-Sprachen (18 Sprachen)

Alle Seiten übernehmen die Sprache aus `localStorage.meetlingo_lang`.

**Unterstützte Sprachen:**
English, German, Spanish, French, Italian, Japanese, Portuguese, Turkish, Dutch, Korean, Chinese, Arabic, Russian, Polish, Swedish, Hindi, Greek, Ukrainian

`LANG_CODES` in server.js mappt diese auf ISO-Codes (en, de, es, …) für die OpenAI-Session (`output.language`).

### ui-lang.js — Funktionen
```js
mlGetLang()        // → aktuell gewählte Sprache
mlT()              // → Translations-Objekt für aktuelle Sprache
mlApply(pageKey)   // → setzt alle UI-Texte ('login'|'verify'|'preferences'|'ended'|…)
mlWireLogoToHome() // → Logo-Click → index.html (setzt mlLeaveOk=true)
mlWireBeforeUnload()// → beforeunload-Warning bei unbeabsichtigtem Refresh
```

### Agenda-Übersetzung
- `agendaCache[lang]` → verhindert doppelte API-Calls
- `translateAgenda(lang)` → `/api/translate-text` wenn lang ≠ 'English'

---

## preferences.html — Sprachkarten

**Top 6 (immer sichtbar):** English → German → Spanish → French → Italian → Japanese
**Weitere 12 (via "More languages" Toggle):** Portuguese, Turkish, Dutch, Korean, Chinese, Arabic, Russian, Polish, Swedish, Hindi, Greek, Ukrainian

```js
window.moreLangsOpen = false;  // auf window, damit mlApply darauf zugreift
// Auto-expand wenn gespeicherte Sprache in der Extended-Liste ist
// Karten-Click → localStorage.setItem('meetlingo_lang', lang) + mlApply('preferences')
```

---

## Safari-spezifische Bugs

- **AudioContext aus User-Gesture:** Erstellung/`resume()` muss **synchron** im Click-Handler passieren (nicht im getUserMedia-`.then()`), sonst ist die Geste weg und `resume()` failt.
- **AudioContext Auto-Recovery:** `onstatechange` → bei `suspended`/`interrupted` automatisch `resume()`. Mic-Aktivierung/Unmute/Sprachwechsel kann den Context sonst killen → Playback stirbt.
- **`ws`-Buffer unaligned:** `readInt16LE(i*2)` statt `Int16Array`-View (typed-array-Konstruktor wirft bei odd offset).
- **Buffer → String:** `raw.toString()` vor `JSON.parse` bei OpenAI-WS-Messages.
- **Kein `let` doppelt** über Script-Dateien hinweg → SyntaxError.

---

## Lautstärke-System

- `localStorage.meetlingo_volume` → Integer 0–100, Standard 50
- realtime.js `_scheduleChunk` normalisiert: `if (vol > 1) vol = vol / 100`

---

## Server starten

```bash
cd ~/Documents/MEETLINGO
npm start          # → http://localhost:3000
```

## Nach Code-Änderungen
- **Nur JS/HTML geändert**: CMD+R im Browser (kein Server-Neustart nötig)
- **server.js geändert**: CTRL+C → npm start → CMD+R

---

## npm Packages

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "dotenv": "^16.0.3",
    "ws": "^8.14.2",
    "openai": "^4.x"
  }
}
```

---

## Test-Script

`test-audio-pipeline.js` (untracked) — End-to-End-Test: sendet echtes PCM16 (440Hz-Sinus) per WebSocket an `/ws/meeting`, prüft Audio-/Text-Translation-Responses.
**Hinweis:** referenziert `/api/force-translate`, das aktuell **nicht** in server.js existiert — Test ggf. anpassen oder Endpoint ergänzen.
