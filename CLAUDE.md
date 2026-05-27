# MeetLingo — Technical Memory
_Zuletzt aktualisiert: Mai 2026_

---

## Architecture

### Stack
- **server.js** — Node.js + Express (REST only, kein WebSocket)
- **public/js/translation.js** — Browser-seitige Aufnahme + API calls
- **public/js/audio.js** — AudioContext helpers (nicht mehr für Translation genutzt)
- **public/js/ui-lang.js** — Geteilte UI-Übersetzungen für alle Onboarding/Post-Meeting Seiten
- **OpenAI API** — Whisper + GPT-4o-mini + TTS-1

### Seiten-Übersicht

| Datei | Zweck |
|-------|-------|
| `index.html` | Startseite — Sprachauswahl (Flag-Grid) |
| `login.html` | E-Mail eingeben |
| `verify.html` | 6-stelligen Code eingeben |
| `preferences.html` | Zielsprache + Lautstärke wählen, dann START LISTENING |
| `waiting.html` | Listener-Wartescreen bis Host gestartet hat |
| `meeting.html` | Listener-Meetingscreen (Translation läuft) |
| `host.html` | Host-Screen (Mic, Agenda, Timer, START/END) |
| `ended.html` | Post-Meeting Bewertung + E-Mail-Summary |
| `confirmation.html` | Host-Bestätigungsscreen nach END |

---

## Translation Pipeline (aktuelle Architektur — Host-Broadcast)

### Konzept: Host-Mic → Server → alle Listener-Sprachen parallel
**NICHT** die OpenAI Realtime API — diese hat bei diesem Account andere Modellnamen.
Listener haben **kein Mikrofon** — nur der Host nimmt auf.

```
HOST Mic → PCM16 chunks → WAV → POST /api/host-translate
  → Whisper (transkribiert einmalig)
  → res.json({ success, original }) sofort zurück an Host
  → dann parallel für jede registrierte Listener-Sprache:
       GPT-4o-mini (übersetzt) → TTS-1 voice:alloy (MP3)
       → Push { id, lang, audio } in audioQueue (in-memory)

LISTENER pollt GET /api/listener-poll?lang=Spanish&after=42
  → bekommt neue { id, audio } chunks
  → AudioManager.playBase64Audio(chunk) spielt ab (sequentiell)
```

### Ablauf beim Meeting-Start
1. `host.html` lädt → `localStorage.removeItem('meetlingo_meeting_active')` + `POST /api/reset-session`
2. Listener lädt `meeting.html` → `POST /api/listener-register { lang }`
3. Host drückt START → `startTranslation()` + `meetlingo_meeting_active = 'true'`
4. Host spricht → chunks → `/api/host-translate` → audioQueue befüllt
5. Listener pollt jede Sekunde → empfängt + spielt Audio ab

### window.ML_HOST_MODE Flag
```js
// host.html setzt VOR translation.js:
window.ML_HOST_MODE = true;

// translation.js entscheidet:
const endpoint = window.ML_HOST_MODE ? '/api/host-translate' : '/api/translate';
```

### Wichtige Parameter in translation.js
```js
const SILENCE_THRESHOLD = 0.015;  // Lautstärke-Grenze für Sprache
const SILENCE_DURATION  = 600;    // ms Stille bevor gesendet wird
processor = audioContext.createScriptProcessor(2048, 1, 1);
audioContext = new AudioContext({ sampleRate: 16000 });
```

### server.js Endpoints (vollständig)
```js
// POST /api/reset-session → löscht registeredLangs, audioQueue, nextChunkId
// POST /api/listener-register { lang } → fügt Sprache zu registeredLangs hinzu
// GET  /api/listener-poll?lang=X&after=N → gibt Chunks zurück (id > N, lang === X)
// POST /api/host-translate { audio } → Whisper + parallel GPT+TTS für jede Sprache
// POST /api/translate { audio, targetLanguage } → Whisper+GPT+TTS für einen Listener (Legacy)
// POST /api/translate-text { text, targetLanguage } → Text-only Übersetzung (Agenda + UI)

// WICHTIG: stream.path = 'audio.wav' muss gesetzt sein für Whisper
// WICHTIG: audioQueue hat max 200 Einträge (FIFO), dann älteste entfernen
```

### audio.js — playBase64Audio (für Listener)
```js
// Plays MP3 audio (TTS-1 output) via decodeAudioData
// Verwendet AudioManager.playBase64Audio(base64) — sequentiell geplant
// AudioContext: 24kHz (audio.js), decodeAudioData resampled automatisch
// NICHT playPcm16Chunk() — das ist für raw PCM16 (Realtime API, nicht verwendet)
```

### Script-Reihenfolge
```html
<!-- host.html -->
<script>window.ML_HOST_MODE = true;</script>
<script src="/js/audio.js"></script>
<script src="/js/translation.js"></script>

<!-- meeting.html (Listener) — KEIN translation.js, KEIN Mikrofon -->
<script src="/js/audio.js"></script>
<script>
  // AudioManager.playBase64Audio(chunk) für Playback
  // fetch('/api/listener-poll?lang=...&after=...') jede Sekunde
</script>
```

---

## OpenAI Account — Modell-Eigenheiten

Dieser Account hat **andere Modellnamen** als Standard-OpenAI:

| Verfügbar | Standard-Name (funktioniert NICHT) |
|-----------|-------------------------------------|
| `gpt-realtime` | `gpt-4o-realtime-preview` ❌ |
| `gpt-realtime-translate` | `gpt-4o-realtime-preview-2024-10-01` ❌ |
| `gpt-realtime-mini` | `gpt-4o-mini-realtime-preview` ❌ |

Realtime API aufgegeben weil: verhält sich wie Chatbot, sendet kein Audio, falsche Event-Namen.

---

## localStorage Keys (vollständig)

| Key | Inhalt | Gesetzt von |
|-----|--------|-------------|
| `meetlingo_lang` | Zielsprache z.B. `"Spanish"` | index.html, preferences.html |
| `meetlingo_volume` | Lautstärke 0–100 (Integer) | preferences.html |
| `meetlingo_meeting_start` | Timestamp `Date.now()` bei Host-Start | host.html `startTimer()` |
| `meetlingo_meeting_end` | Timestamp `Date.now()` bei Host-End | host.html END-Button |
| `meetlingo_meeting_active` | `'true'` wenn Meeting läuft, wird gelöscht bei END | host.html |
| `meetlingo_agenda` | Agenda-Text vom Host (manuell gespeichert) | host.html Save-Button |
| `meetlingo_email` | E-Mail-Adresse des Listeners | login.html |
| `meetlingo_rating` | Sterne-Bewertung 1–5 | ended.html |

### WICHTIG: meetlingo_meeting_active
- `meetlingo_meeting_start` bleibt nach jedem Meeting in localStorage → **NICHT** als "läuft gerade"-Check verwenden
- Stattdessen `meetlingo_meeting_active === 'true'` prüfen
- Wird beim START gesetzt, beim END gelöscht

---

## Meeting-Flow (Listener)

```
index.html → login.html → verify.html → preferences.html
  → [meetlingo_meeting_active === 'true'?]
       JA  → meeting.html (Timer synced mit Host)
       NEIN → waiting.html (pollt jede Sekunde, redirect wenn active=true)
```

## Meeting-Flow (Host)

```
host.html → START → setzt meetlingo_meeting_start + meetlingo_meeting_active='true'
          → END   → setzt meetlingo_meeting_end, entfernt meetlingo_meeting_active
          → confirmation.html
```

---

## Timer-Synchronisation

- **Host** setzt `meetlingo_meeting_start = Date.now()` beim START
- **Listener** (meeting.html) liest `meetlingo_meeting_start` und rechnet `elapsed = Date.now() - start`
- meeting.html setzt `meetlingo_meeting_start` **NICHT** mehr selbst — sonst Zeitverlust
- Beide Timer zeigen identische verstrichene Zeit

```js
// meeting.html — RICHTIG:
var start = parseInt(localStorage.getItem('meetlingo_meeting_start') || Date.now());

// meeting.html — FALSCH (entfernt!):
// localStorage.setItem('meetlingo_meeting_start', Date.now().toString()); ← NIE WIEDER
```

---

## UI-Sprachen (18 Sprachen)

Alle Seiten übernehmen die Sprache aus `localStorage.meetlingo_lang`.

**Unterstützte Sprachen:**
English, German, Spanish, French, Italian, Japanese, Portuguese, Turkish, Dutch, Korean, Chinese, Arabic, Russian, Polish, Swedish, Hindi, Greek, Ukrainian

### ui-lang.js — Funktionen
```js
mlGetLang()        // → aktuell gewählte Sprache
mlT()              // → Translations-Objekt für aktuelle Sprache
mlApply(pageKey)   // → setzt alle UI-Texte auf der Seite ('login'|'verify'|'preferences'|'ended')
mlWireLogoToHome() // → Logo-Click → index.html (setzt mlLeaveOk=true)
mlWireBeforeUnload()// → beforeunload-Warning bei unbeabsichtigtem Refresh
```

### Jede Seite lädt ui-lang.js und ruft auf:
```html
<script src="/js/ui-lang.js"></script>
<script>
  mlWireLogoToHome();
  mlWireBeforeUnload();
  mlApply('preferences'); // pageKey je nach Seite
</script>
```

### Agenda-Übersetzung (meeting.html)
- `agendaCache[lang]` → verhindert doppelte API-Calls
- `translateAgenda(lang)` → ruft `/api/translate-text` auf wenn lang ≠ 'English'
- Wird aufgerufen aus `applyUILanguage()` bei Sprachwechsel

---

## preferences.html — Sprachkarten

**Top 6 (immer sichtbar):** English → German → Spanish → French → Italian → Japanese

**Weitere 12 (via "More languages" Toggle):**
Portuguese, Turkish, Dutch, Korean, Chinese, Arabic, Russian, Polish, Swedish, Hindi, Greek, Ukrainian

```js
window.moreLangsOpen = false;  // auf window, damit mlApply darauf zugreift
// Toggle expandiert/klappt das zweite Grid ein
// Auto-expand wenn gespeicherte Sprache in der Extended-Liste ist
// Karten-Click → localStorage.setItem('meetlingo_lang', lang) + mlApply('preferences')
```

---

## host.html — Agenda

- Textarea `id="agenda-input"` — Host tippt Agenda
- **Expliziter Save-Button** (`id="agenda-save-btn"`) → `localStorage.setItem('meetlingo_agenda', ...)`
- "Saved ✓" Label (`id="agenda-saved-label"`) blendet kurz ein
- Kein Auto-Save mehr — Host bestimmt wann Gäste die Agenda sehen

---

## Navigationsmuster

```js
// Vor jeder intentionalen Navigation:
window.mlLeaveOk = true;
window.location.href = 'ziel.html';

// In meeting.html:
var intentionalLeave = false;
function doLeave() {
  intentionalLeave = true;
  // stopTranslation, setze meetlingo_meeting_end, navigate
}
window.addEventListener('beforeunload', e => {
  if (!intentionalLeave) { e.preventDefault(); e.returnValue = ''; }
});
```

---

## Safari-spezifische Bugs

- **Kein `let` doppelt** über Script-Dateien hinweg → SyntaxError
  - `isMuted` → umbenannt zu `_muteBtnState` in meeting.html
- **Buffer → String**: `ws` Library gibt Buffer zurück → `.toString()` nötig
- **AudioContext sampleRate**: Browser 48kHz, OpenAI braucht 16kHz → `new AudioContext({ sampleRate: 16000 })`

---

## Lautstärke-System

- `localStorage.meetlingo_volume` → Integer 0–100
- `playBase64Audio()` normalisiert: `if (vol > 1) vol = vol / 100`
- Standard: 50

---

## host.html — Zwei Views (Setup + Active)

```
host-setup-view  → sichtbar beim Laden (Agenda, Stats, QR)
host-active-view → sichtbar nach START (Listeners-Count, Mute, Transcription)
```

Bei START:
```js
document.getElementById('host-setup-view').style.display = 'none';
document.getElementById('host-active-view').style.display = 'flex';
startTranslation(); // ← direkt im user-gesture chain (kein navigate!)
```

Mic-Pulse Animation beim Sprechen:
```js
window.onAudioActivity = function() {
  btn.classList.add('mic-active');  // CSS: animation: mic-pulse 1s infinite
  clearTimeout(_pulseTimeout);
  _pulseTimeout = setTimeout(() => btn.classList.remove('mic-active'), 800);
};
```

---

## Server starten

```bash
cd ~/Documents/MEETLINGO
npm start
# → http://localhost:3000
```

## Nach Code-Änderungen

- **Nur JS/HTML geändert**: CMD+R in Safari (kein Server-Neustart nötig)
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

## Sicherheit

- `.env` enthält echten OpenAI API Key → **NIEMALS in Git committen**
- `.gitignore` muss `.env` enthalten
