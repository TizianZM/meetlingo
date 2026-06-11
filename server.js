const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// ── OpenAI ───────────────────────────────────────────
const { OpenAI } = require('openai');
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY environment variable is not set');
  return new OpenAI({ apiKey: key });
}

// ── In-memory session state ───────────────────────────
let listenerSessions = new Map();
let textQueue        = [];
let nextChunkId      = 1;
let meetingActive    = false;
let meetingStartTime = null;
let recentTexts      = new Map();
let recentContext    = [];
let meetingAgenda    = '';

const SESSION_TIMEOUT = 60000;

function getActiveLangs() {
  const now = Date.now();
  const langs = new Set();
  listenerSessions.forEach((s) => { if (now - s.lastSeen < SESSION_TIMEOUT) langs.add(s.lang); });
  return [...langs];
}

// ── Session management ────────────────────────────────

app.post('/api/reset-session', express.json(), (req, res) => {
  listenerSessions = new Map();
  textQueue        = [];
  nextChunkId      = 1;
  meetingActive    = false;
  meetingStartTime = null;
  recentTexts      = new Map();
  recentContext    = [];
  // meetingAgenda intentionally NOT cleared
  res.json({ success: true });
});

app.post('/api/agenda', express.json(), (req, res) => {
  meetingAgenda = req.body.agenda || '';
  res.json({ success: true });
});

app.get('/api/agenda', (req, res) => {
  res.json({ agenda: meetingAgenda });
});

app.post('/api/meeting-start', express.json(), (req, res) => {
  meetingActive    = true;
  meetingStartTime = Date.now();
  console.log('[Session] Meeting started at', meetingStartTime);
  res.json({ success: true });
});

app.post('/api/meeting-end', (req, res) => {
  meetingActive = false;
  console.log('[Session] Meeting ended');
  res.json({ success: true });
});

app.get('/api/meeting-status', (req, res) => {
  res.json({ active: meetingActive });
});

app.get('/api/meeting-time', (req, res) => {
  res.json({ startTime: meetingStartTime });
});

app.post('/api/listener-register', express.json(), (req, res) => {
  const { lang, sessionId } = req.body;
  if (lang && sessionId) listenerSessions.set(sessionId, { lang, lastSeen: Date.now() });
  res.json({ success: true, currentId: nextChunkId - 1 });
});

app.get('/api/listener-stats', (req, res) => {
  const now    = Date.now();
  const counts = {};
  // Include both REST and WS participants
  listenerSessions.forEach((s) => {
    if (now - s.lastSeen < SESSION_TIMEOUT) counts[s.lang] = (counts[s.lang] || 0) + 1;
  });
  wsParticipants.forEach((p) => {
    if (p.role === 'listener') counts[p.lang] = (counts[p.lang] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ counts, total });
});

app.get('/api/listener-poll', (req, res) => {
  const { lang, after } = req.query;
  const afterId = parseInt(after) || 0;
  const chunks  = textQueue
    .filter(c => c.lang === lang && c.id > afterId)
    .map(c => ({ id: c.id, original: c.original, translated: c.translated }));
  res.json({ chunks });
});

// ── Text translation (agenda, UI) ─────────────────────
app.post('/api/translate-text', express.json(), async (req, res) => {
  const { text, targetLanguage } = req.body;
  if (!text || !targetLanguage) return res.json({ success: false });
  try {
    const result = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 500, temperature: 0,
      messages: [
        { role: 'system', content: `Translate the following text to ${targetLanguage}. Output ONLY the translated text. Preserve line breaks and formatting. No explanations.` },
        { role: 'user',   content: text }
      ]
    });
    res.json({ success: true, translation: result.choices[0].message.content });
  } catch (err) {
    console.error('[TranslateText] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ── WebSocket Meeting Server ──────────────────────────
const wss = new WebSocket.Server({ noServer: true });

// WS participants: clientWs → { lang, role, id }
const wsParticipants = new Map();

// OpenAI translate sessions per target language: lang → { ws, audioBuf, transcriptBuf, active }
const translateSessions = new Map();

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/meeting') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  } else {
    socket.destroy();
  }
});

function buildWAV(pcmBuffer, sampleRate) {
  const dataLen = pcmBuffer.length;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1,  20); // PCM
  buf.writeUInt16LE(1,  22); // mono
  buf.writeUInt32LE(sampleRate,     24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2,  32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  pcmBuffer.copy(buf, 44);
  return buf;
}

function broadcastToLang(targetLang, msg) {
  const str = JSON.stringify(msg);
  wsParticipants.forEach((p, ws) => {
    if (p.lang === targetLang && ws.readyState === WebSocket.OPEN) ws.send(str);
  });
}

function broadcastAll(msg) {
  const str = JSON.stringify(msg);
  wsParticipants.forEach((p, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(str);
  });
}

function openTranslateSession(targetLang) {
  if (translateSessions.has(targetLang)) return;

  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error('[Realtime] Missing OPENAI_API_KEY'); return; }

  const openaiWs = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-realtime-translate',
    { headers: { 'Authorization': `Bearer ${key}`, 'OpenAI-Beta': 'realtime=v1' } }
  );

  const session = { ws: openaiWs, audioBuf: [], transcriptBuf: '', active: false };
  translateSessions.set(targetLang, session);

  openaiWs.on('open', () => {
    console.log(`[Realtime] Connected → ${targetLang}`);
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: `You are a live simultaneous interpreter. Translate all incoming speech to ${targetLang}. Output only the spoken translation — no explanations, no commentary, no metadata.`,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true
        }
      }
    }));
    session.active = true;
  });

  openaiWs.on('message', (raw) => {
    try {
      const evt = JSON.parse(raw.toString());

      if (evt.type === 'response.audio.delta' && evt.delta) {
        session.audioBuf.push(Buffer.from(evt.delta, 'base64'));
      }
      else if (evt.type === 'response.audio_transcript.delta' && evt.delta) {
        session.transcriptBuf += evt.delta;
      }
      else if (evt.type === 'response.audio.done') {
        if (session.audioBuf.length > 0) {
          const pcm        = Buffer.concat(session.audioBuf);
          session.audioBuf = [];
          const transcript        = session.transcriptBuf;
          session.transcriptBuf   = '';
          const wav  = buildWAV(pcm, 24000);
          const b64  = wav.toString('base64');
          broadcastToLang(targetLang, { type: 'audio', audio: b64, transcript });
          console.log(`[Realtime] → ${targetLang}: ${pcm.length}B${transcript ? ' "' + transcript.slice(0, 40) + '"' : ''}`);
        }
      }
      else if (evt.type === 'error') {
        console.error(`[Realtime] Error (${targetLang}):`, evt.error?.message || JSON.stringify(evt.error));
        broadcastToLang(targetLang, { type: 'error', message: evt.error?.message || 'Translation error' });
      }
    } catch (e) {
      console.error('[Realtime] Parse error:', e.message);
    }
  });

  openaiWs.on('close', (code) => {
    console.log(`[Realtime] Closed for ${targetLang}: ${code}`);
    translateSessions.delete(targetLang);
  });

  openaiWs.on('error', (err) => {
    console.error(`[Realtime] WS error (${targetLang}):`, err.message);
    translateSessions.delete(targetLang);
  });
}

function closeSessionIfUnused(targetLang) {
  let count = 0;
  wsParticipants.forEach((p) => { if (p.lang === targetLang) count++; });
  if (count === 0) {
    const s = translateSessions.get(targetLang);
    if (s) { s.ws.close(); translateSessions.delete(targetLang); console.log(`[Realtime] Closed idle: ${targetLang}`); }
  }
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'join') {
          const id = 'p_' + Math.random().toString(36).slice(2, 8);
          wsParticipants.set(ws, { lang: msg.lang, role: msg.role || 'listener', id });
          ws.send(JSON.stringify({ type: 'joined', id, active: meetingActive, startTime: meetingStartTime }));
          openTranslateSession(msg.lang);
          console.log(`[WS] Joined: ${msg.role} / ${msg.lang}`);
        }
        else if (msg.type === 'lang_change') {
          const p = wsParticipants.get(ws);
          if (p) {
            const old = p.lang;
            p.lang = msg.lang;
            openTranslateSession(msg.lang);
            setTimeout(() => closeSessionIfUnused(old), 15000);
          }
        }
        else if (msg.type === 'meeting_end') {
          meetingActive = false;
          fetch; // REST endpoint also called from client separately
          broadcastAll({ type: 'meeting_ended' });
          console.log('[WS] Meeting ended by host');
        }
      } catch (e) {
        console.error('[WS] JSON parse error:', e.message);
      }
    } else {
      // Binary: raw PCM16 audio from a speaker
      const speaker = wsParticipants.get(ws);
      if (!speaker) return;

      const audioB64 = Buffer.from(data).toString('base64');

      // Route to every target language that has at least one OTHER participant
      const targets = new Set();
      wsParticipants.forEach((p, cws) => { if (cws !== ws) targets.add(p.lang); });

      targets.forEach((lang) => {
        if (!translateSessions.has(lang)) openTranslateSession(lang);
        const s = translateSessions.get(lang);
        if (!s || !s.active || s.ws.readyState !== WebSocket.OPEN) return;
        s.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioB64 }));
      });
    }
  });

  ws.on('close', () => {
    const p = wsParticipants.get(ws);
    if (p) {
      const lang = p.lang;
      console.log(`[WS] Disconnected: ${p.role} / ${lang}`);
      wsParticipants.delete(ws);
      setTimeout(() => closeSessionIfUnused(lang), 15000);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    wsParticipants.delete(ws);
  });
});

// ── Start ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`MeetLingo running on http://localhost:${PORT}`);
});
