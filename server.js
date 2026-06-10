const express = require('express');
const http = require('http');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' })); // base64 WAV audio can be several MB for longer phrases

// ── OpenAI ───────────────────────────────────────────
const { OpenAI } = require('openai');
// Lazy init — avoids crash on startup if env var loads after module init
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY environment variable is not set');
  return new OpenAI({ apiKey: key });
}

// ── In-memory session state ───────────────────────────
let listenerSessions = new Map(); // sessionId → { lang, lastSeen }
let textQueue = [];               // { id, lang, original, translated }
let nextChunkId = 1;
let meetingActive = false;
let meetingStartTime = null;      // set when host presses START — used for cross-device timer sync
let recentTexts = new Map();      // text → timestamp — dedup within 30s
let recentContext = [];           // rolling last 3 transcriptions for GPT context
let meetingAgenda = '';           // set by host via /api/agenda

const SESSION_TIMEOUT = 60000; // ms — 60s buffer for Safari timer throttling

// Derive currently active languages from live sessions
function getActiveLangs() {
  const now = Date.now();
  const langs = new Set();
  listenerSessions.forEach((session) => {
    if (now - session.lastSeen < SESSION_TIMEOUT) langs.add(session.lang);
  });
  return [...langs];
}

// ── Session management ────────────────────────────────

// Reset (called when host loads page)
app.post('/api/reset-session', express.json(), (req, res) => {
  listenerSessions = new Map();
  textQueue = [];
  nextChunkId = 1;
  meetingActive = false;
  meetingStartTime = null;
  recentTexts = new Map();
  recentContext = [];
  meetingAgenda = '';
  res.json({ success: true });
});

// Agenda: host saves, listeners fetch
app.post('/api/agenda', express.json(), (req, res) => {
  meetingAgenda = req.body.agenda || '';
  res.json({ success: true });
});

app.get('/api/agenda', (req, res) => {
  res.json({ agenda: meetingAgenda });
});

// Host starts meeting
app.post('/api/meeting-start', express.json(), (req, res) => {
  meetingActive = true;
  meetingStartTime = Date.now();
  console.log('[Session] Meeting started at', meetingStartTime);
  res.json({ success: true });
});

// Host ends meeting — listeners detect this via /api/meeting-status poll
app.post('/api/meeting-end', (req, res) => {
  meetingActive = false;
  console.log('[Session] Meeting ended');
  res.json({ success: true });
});

// Poll meeting status (listener waiting screen)
app.get('/api/meeting-status', (req, res) => {
  res.json({ active: meetingActive });
});

// Returns server-side meeting start timestamp for cross-device timer sync
app.get('/api/meeting-time', (req, res) => {
  res.json({ startTime: meetingStartTime });
});

// ── Listener endpoints ────────────────────────────────

// Register / keepalive (called every 8s by listener)
// Returns currentId so listener starts from "now" instead of chunk 0 on rejoin
app.post('/api/listener-register', express.json(), (req, res) => {
  const { lang, sessionId } = req.body;
  if (lang && sessionId) {
    listenerSessions.set(sessionId, { lang, lastSeen: Date.now() });
  }
  res.json({ success: true, currentId: nextChunkId - 1 });
});

// Active listener counts per language (host dashboard)
app.get('/api/listener-stats', (req, res) => {
  const now = Date.now();
  const counts = {};
  listenerSessions.forEach((session) => {
    if (now - session.lastSeen < SESSION_TIMEOUT) {
      counts[session.lang] = (counts[session.lang] || 0) + 1;
    }
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ counts, total });
});

// Poll for new translated text chunks
app.get('/api/listener-poll', (req, res) => {
  const { lang, after } = req.query;
  const afterId = parseInt(after) || 0;
  const chunks = textQueue
    .filter(c => c.lang === lang && c.id > afterId)
    .map(c => ({ id: c.id, original: c.original, translated: c.translated }));
  res.json({ chunks });
});

// ── Host translation pipeline ─────────────────────────
// Audio → Whisper (transcribe once) → GPT-4o-mini × active langs (parallel, no TTS)
const LANG_TO_ISO = {
  'English': 'en', 'German': 'de', 'Spanish': 'es', 'French': 'fr',
  'Italian': 'it', 'Japanese': 'ja', 'Portuguese': 'pt', 'Turkish': 'tr',
  'Dutch': 'nl', 'Korean': 'ko', 'Chinese': 'zh', 'Arabic': 'ar',
  'Russian': 'ru', 'Polish': 'pl', 'Swedish': 'sv', 'Hindi': 'hi',
  'Greek': 'el', 'Ukrainian': 'uk',
};

app.post('/api/host-translate', express.json(), async (req, res) => {
  const { audio, hostLang } = req.body;
  const whisperLang = LANG_TO_ISO[hostLang] || hostLang || 'de'; // convert "English" → "en"
  try {
    const audioBuffer = Buffer.from(audio, 'base64');
    const { Readable } = require('stream');
    const stream = Readable.from(audioBuffer);
    stream.path = 'audio.wav';

    const transcription = await getOpenAI().audio.transcriptions.create({
      file: stream,
      model: 'whisper-1',
      language: whisperLang,  // dynamic — set by host in presenter language selector
      temperature: 0,         // deterministic, fewer hallucinations
    });
    const originalText = transcription.text ? transcription.text.trim() : '';
    console.log('[Host] Transcribed:', originalText);

    // Filter: skip empty, too short, or known Whisper hallucinations
    // These are phrases Whisper generates from silence/noise based on training data
    const HALLUCINATIONS = [
      // Greetings/closings
      'Danke.', 'Danke schön.', 'Vielen Dank.', 'Tschüss.', 'Auf Wiedersehen.',
      'Bitte.', 'Gern geschehen.',
      'Thank you.', 'Thanks for watching.', 'Thanks for listening.',
      'You\'re welcome.',
      // Subtitle credits (very common Whisper hallucination from video training data)
      'Untertitel von', 'Untertitel: ', 'Untertitel der Amara', 'Untertitel im Auftrag',
      'Untertitelung', 'UT:', 'Übersetzt von', 'Übertitel',
      'Amara.org', 'amara.org',
      'ZDF', 'funk,',
      // Other known hallucinations
      'www.', '.com', '.de', '.org',
      'Copyright', '©',
      'Subtitles by', 'Subtitled by', 'Closed captions',
    ];
    // Also block anything that's just punctuation, numbers, or single words under 3 chars
    const isJunk = /^[\s.,!?…\-–—]+$/.test(originalText);
    const isHallucination = HALLUCINATIONS.some(h => originalText === h || originalText.startsWith(h) || originalText.includes(h));
    if (!originalText || originalText.length < 4 || isHallucination || isJunk) {
      console.log('[Host] Skipped (hallucination/junk):', originalText);
      return res.json({ success: false });
    }

    // Dedup: skip if identical text was sent within the last 30 seconds
    const now = Date.now();
    const lastSeen = recentTexts.get(originalText);
    if (lastSeen && now - lastSeen < 30000) {
      console.log('[Host] Skipped (duplicate):', originalText);
      return res.json({ success: false });
    }
    recentTexts.set(originalText, now);
    // Clean up old entries to prevent memory leak
    if (recentTexts.size > 100) {
      const cutoff = now - 30000;
      recentTexts.forEach((ts, text) => { if (ts < cutoff) recentTexts.delete(text); });
    }

    // Respond immediately to host with transcription
    res.json({ success: true, original: originalText });

    // Update rolling context (last 3 sentences)
    recentContext.push(originalText);
    if (recentContext.length > 3) recentContext.shift();

    // Only translate for languages with currently active listeners
    const langs = getActiveLangs();
    if (langs.length === 0) return;

    // Build context string for GPT (previous sentences, if any)
    const contextBlock = recentContext.length > 1
      ? `\nFor context, the previous sentences were:\n${recentContext.slice(0, -1).join('\n')}\n\nNow translate:`
      : '';

    await Promise.all(langs.map(async (lang) => {
      try {
        const translation = await getOpenAI().chat.completions.create({
          model: 'gpt-4o-mini', max_tokens: 200, temperature: 0,
          messages: [
            { role: 'system', content: `You are a professional live interpreter. Translate the spoken text to ${lang}. Output ONLY the translated text, nothing else. Keep it natural and conversational.${contextBlock}` },
            { role: 'user', content: originalText }
          ]
        });
        const translatedText = translation.choices[0].message.content;
        textQueue.push({ id: nextChunkId++, lang, original: originalText, translated: translatedText });
        if (textQueue.length > 500) textQueue.shift();
        console.log('[Host] →', lang, ':', translatedText);
      } catch (e) {
        console.error('[Host] Lang error:', lang, e.message);
      }
    }));

  } catch (err) {
    console.error('[Host] Error:', err.message);
    if (!res.headersSent) res.json({ success: false, error: err.message });
  }
});

// ── Text translation (agenda, UI strings) ─────────────
app.post('/api/translate-text', express.json(), async (req, res) => {
  const { text, targetLanguage } = req.body;
  if (!text || !targetLanguage) return res.json({ success: false });
  try {
    const result = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 500, temperature: 0,
      messages: [
        { role: 'system', content: `Translate the following text to ${targetLanguage}. Output ONLY the translated text. Preserve line breaks and formatting. No explanations.` },
        { role: 'user', content: text }
      ]
    });
    res.json({ success: true, translation: result.choices[0].message.content });
  } catch (err) {
    console.error('[TranslateText] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`MeetLingo running on http://localhost:${PORT}`);
});
