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
  if (!key) throw new Error('OPENAI_API_KEY not set');
  return new OpenAI({ apiKey: key });
}

// ── In-memory session state ───────────────────────────
let meetingActive    = false;
let meetingStartTime = null;
let meetingAgenda    = '';

// ── REST API ──────────────────────────────────────────
app.post('/api/send-code', express.json(), (req, res) => {
  console.log('[Auth] send-code → bypassed');
  res.json({ success: true });
});

app.post('/api/verify-code', express.json(), (req, res) => {
  console.log('[Auth] verify-code → always valid');
  res.json({ success: true });
});

app.post('/api/agenda', express.json(), (req, res) => {
  meetingAgenda = req.body.agenda || '';
  // Push to connected guests so mid-meeting agenda edits appear live
  broadcastAll({ type: 'agenda_update', agenda: meetingAgenda });
  res.json({ success: true });
});

app.get('/api/agenda', (req, res) => {
  res.json({ agenda: meetingAgenda });
});

app.post('/api/meeting-start', express.json(), (req, res) => {
  meetingActive    = true;
  meetingStartTime = Date.now();
  broadcastAll({ type: 'meeting_started' });
  console.log('[Session] Meeting started');
  res.json({ success: true });
});

app.post('/api/meeting-end', (req, res) => {
  meetingActive = false;
  closeAllTranslateSessions();
  broadcastAll({ type: 'meeting_ended' });
  console.log('[Session] Meeting ended');
  res.json({ success: true });
});

app.get('/api/meeting-status', (req, res) => {
  res.json({ active: meetingActive, startTime: meetingStartTime });
});

app.get('/api/meeting-time', (req, res) => {
  res.json({ startTime: meetingStartTime });
});

app.post('/api/translate-text', express.json(), async (req, res) => {
  const { text, targetLanguage } = req.body;
  if (!text || !targetLanguage) return res.json({ success: false });
  try {
    const result = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 500, temperature: 0,
      messages: [
        { role: 'system', content: `Translate to ${targetLanguage}. Output ONLY the translated text. Preserve line breaks. No explanations.` },
        { role: 'user',   content: text }
      ]
    });
    res.json({ success: true, translation: result.choices[0].message.content });
  } catch (err) {
    console.error('[TranslateText]', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/listener-stats', (req, res) => {
  const counts = {};
  wsParticipants.forEach((p) => {
    if (p.role === 'listener') counts[p.lang] = (counts[p.lang] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ counts, total });
});

// Legacy endpoints (kept for compatibility)
app.post('/api/reset-session', express.json(), (req, res) => { res.json({ success: true }); });
app.post('/api/listener-register', express.json(), (req, res) => { res.json({ success: true, currentId: 0 }); });
app.get('/api/listener-poll', (req, res) => { res.json({ chunks: [] }); });
app.post('/api/send-summary-email', express.json(), (req, res) => { res.json({ success: true }); });

// ── WebSocket ─────────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true });

// wsParticipants: ws → { id, name, lang, role, muted, speaking, lastAudio }
const wsParticipants = new Map();

// translateSessions: "${speakerId}_${targetLang}" → { ws, active, speakerId, targetLang, sourceLang }
const translateSessions = new Map();

// Speaker debounce timers: speakerId → timeout
const speakerTimers = new Map();

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/meeting') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  } else {
    socket.destroy();
  }
});

// ── Language codes ────────────────────────────────────
const LANG_CODES = {
  English: 'en', German: 'de', Spanish: 'es', French: 'fr',
  Italian: 'it', Japanese: 'ja', Portuguese: 'pt', Turkish: 'tr',
  Dutch: 'nl', Korean: 'ko', Chinese: 'zh', Arabic: 'ar',
  Russian: 'ru', Polish: 'pl', Swedish: 'sv', Hindi: 'hi',
  Greek: 'el', Ukrainian: 'uk'
};

// ── Utilities ─────────────────────────────────────────
function sanitizeLang(lang) {
  return LANG_CODES[lang] ? lang : 'English';
}

function sanitizeName(name, fallback) {
  const clean = String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 40);
  return clean || fallback;
}

function buildWAV(pcmBuffer, sampleRate) {
  const dataLen = pcmBuffer.length;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  pcmBuffer.copy(buf, 44);
  return buf;
}

function broadcastAll(msg) {
  const str = JSON.stringify(msg);
  wsParticipants.forEach((p, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(str);
  });
}

function broadcastToLang(targetLang, msg, excludeSpeakerId) {
  const str = JSON.stringify(msg);
  wsParticipants.forEach((p, ws) => {
    if (p.lang === targetLang && ws.readyState === WebSocket.OPEN) {
      if (!excludeSpeakerId || p.id !== excludeSpeakerId) ws.send(str);
    }
  });
}

function broadcastToHost(msg) {
  const str = JSON.stringify(msg);
  wsParticipants.forEach((p, ws) => {
    if (p.role === 'host' && ws.readyState === WebSocket.OPEN) ws.send(str);
  });
}

function findParticipantById(id) {
  for (const [, p] of wsParticipants) { if (p.id === id) return p; }
  return null;
}

function broadcastParticipantList() {
  const list = [];
  wsParticipants.forEach((p) => {
    list.push({ id: p.id, name: p.name, lang: p.lang, role: p.role, muted: !!p.muted, speaking: !!p.speaking });
  });
  broadcastAll({ type: 'participant_list', participants: list });
}

function updateSpeakerActivity(speaker) {
  if (!speaker.speaking) {
    speaker.speaking = true;
    // Clients update their participant UI from speaker_active/_inactive —
    // no full participant_list rebroadcast needed on every toggle
    broadcastAll({ type: 'speaker_active', id: speaker.id, name: speaker.name, lang: speaker.lang });
  }
  clearTimeout(speakerTimers.get(speaker.id));
  speakerTimers.set(speaker.id, setTimeout(() => {
    speaker.speaking = false;
    speakerTimers.delete(speaker.id);
    broadcastAll({ type: 'speaker_inactive', id: speaker.id });
  }, 1500));
}

// ── OpenAI Translate Session (per speaker × target lang) ──────────
function openTranslateSession(speakerId, sourceLang, targetLang) {
  const key = `${speakerId}_${targetLang}`;
  if (translateSessions.has(key)) return;

  const key_env = process.env.OPENAI_API_KEY;
  if (!key_env) { console.error('[Translate] Missing OPENAI_API_KEY'); return; }

  const langCode = LANG_CODES[targetLang] || 'en';
  console.log(`[Translate] Opening: ${speakerId} (${sourceLang}) → ${targetLang} (${langCode})`);

  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`,
    { headers: { 'Authorization': `Bearer ${key_env}` } }
  );

  // pending: audio chunks that arrive while the OpenAI handshake is in flight —
  // flushed on session.updated so the first words of speech aren't dropped
  const session = { ws: openaiWs, active: false, speakerId, sourceLang, targetLang, pending: [] };
  translateSessions.set(key, session);

  openaiWs.on('open', () => {
    console.log(`[Translate] WS open: ${key}`);
  });

  openaiWs.on('message', (raw) => {
    try {
      const evt = JSON.parse(raw.toString());

      if (evt.type === 'session.created') {
        openaiWs.send(JSON.stringify({
          type: 'session.update',
          session: { audio: {
            input:  { noise_reduction: { type: 'near_field' } },
            output: { language: langCode }
          }}
        }));
      }
      else if (evt.type === 'session.updated') {
        session.active = true;
        // Flush audio buffered during the handshake
        session.pending.forEach((audioB64) => {
          openaiWs.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: audioB64 }));
        });
        session.pending = [];
        console.log(`[Translate] Ready: ${key}`);
      }
      else if (evt.type === 'session.output_audio.delta' && evt.delta) {
        if (!session.gotOutput) {
          session.gotOutput = true;
          console.log(`[Translate] First audio out: ${key}`);
        }
        const pcm = Buffer.from(evt.delta, 'base64');
        const wav = buildWAV(pcm, 24000);
        // Send to all participants with targetLang except the speaker themselves
        broadcastToLang(targetLang, { type: 'audio', audio: wav.toString('base64') }, speakerId);
      }
      else if (evt.type === 'session.output_transcript.delta' && evt.delta) {
        broadcastToLang(targetLang, { type: 'transcript', text: evt.delta }, speakerId);
      }
      else if (evt.type === 'session.input_transcript.delta' && evt.delta) {
        const sp = findParticipantById(speakerId);
        const name = sp?.name || '?';
        const lang = sp?.lang || sourceLang;
        // Broadcast source text to everyone EXCEPT the speaker themselves
        const payload = JSON.stringify({ type: 'source_transcript', text: evt.delta, speakerId, name, lang });
        wsParticipants.forEach((p, pws) => {
          if (p.id !== speakerId && pws.readyState === WebSocket.OPEN) pws.send(payload);
        });
      }
      else if (evt.type === 'error') {
        const msg = evt.error?.message || JSON.stringify(evt.error);
        console.error(`[Translate] Error (${key}):`, msg);
        // A broken session would otherwise sit in the map swallowing audio
        // forever — close it so the next chunk transparently reopens one.
        try { openaiWs.close(); } catch(e){}
        if (translateSessions.get(key) === session) translateSessions.delete(key);
      }
    } catch (e) {
      console.error('[Translate] Parse error:', e.message);
    }
  });

  openaiWs.on('close', (code) => {
    console.log(`[Translate] Closed: ${key} (${code})`);
    // Only remove if the map still points at THIS session — a late close
    // event must not evict a newly reopened session under the same key
    if (translateSessions.get(key) === session) translateSessions.delete(key);
  });

  openaiWs.on('error', (err) => {
    console.error(`[Translate] WS error (${key}):`, err.message);
    if (translateSessions.get(key) === session) translateSessions.delete(key);
  });
}

function closeSpeakerSessions(speakerId) {
  const keysToClose = [];
  translateSessions.forEach((s, key) => {
    if (s.speakerId === speakerId) keysToClose.push(key);
  });
  keysToClose.forEach((key) => {
    const s = translateSessions.get(key);
    if (s) { try { s.ws.close(); } catch(e){} translateSessions.delete(key); }
  });
}

// Close sessions whose target language no longer has any listener
// (other than the speaker) — otherwise the OpenAI WS stays open idle
// until the speaker disconnects.
function pruneOrphanedSessions() {
  translateSessions.forEach((s, key) => {
    let hasAudience = false;
    wsParticipants.forEach((p) => {
      if (p.id !== s.speakerId && p.lang === s.targetLang) hasAudience = true;
    });
    if (!hasAudience) {
      console.log(`[Translate] Pruning orphaned session: ${key}`);
      try { s.ws.close(); } catch(e){}
      translateSessions.delete(key);
    }
  });
}

function closeAllTranslateSessions() {
  translateSessions.forEach((s, key) => {
    try { s.ws.close(); } catch(e){}
    translateSessions.delete(key);
  });
}

// ── WS Connection ──────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'join') {
          const id   = 'p_' + Math.random().toString(36).slice(2, 8);
          const role = msg.role === 'host' ? 'host' : 'listener';
          const name = sanitizeName(msg.name, role === 'host' ? 'Host' : 'Guest');
          const lang = sanitizeLang(msg.lang);
          wsParticipants.set(ws, { id, name, lang, role, muted: false, speaking: false });
          ws.send(JSON.stringify({ type: 'joined', id, name, active: meetingActive, startTime: meetingStartTime }));
          broadcastParticipantList();
          console.log(`[WS] Joined: ${role} "${name}" / ${lang}`);
        }
        else if (msg.type === 'lang_change') {
          const p = wsParticipants.get(ws);
          if (p) {
            closeSpeakerSessions(p.id);
            p.lang = sanitizeLang(msg.lang);
            console.log(`[WS] Lang change: ${p.role} "${p.name}" → ${p.lang}`);
            pruneOrphanedSessions();
            broadcastParticipantList();
          }
        }
        else if (msg.type === 'name_change') {
          const p = wsParticipants.get(ws);
          if (p && msg.name) {
            p.name = sanitizeName(msg.name, p.name);
            broadcastParticipantList();
            // If currently speaking, re-broadcast speaker_active with updated name
            if (p.speaking) {
              broadcastAll({ type: 'speaker_active', id: p.id, name: p.name, lang: p.lang });
            }
            console.log(`[WS] Name changed: ${p.role} → "${p.name}"`);
          }
        }
        else if (msg.type === 'meeting_end') {
          meetingActive = false;
          closeAllTranslateSessions();
          broadcastAll({ type: 'meeting_ended' });
          console.log('[WS] Meeting ended by host');
        }
        else if (msg.type === 'mute_participant') {
          const sender = wsParticipants.get(ws);
          if (!sender || sender.role !== 'host') return; // only the host may mute others
          const target = findParticipantById(msg.targetId);
          if (target) {
            target.muted = !target.muted;
            broadcastParticipantList();
            console.log(`[WS] ${target.muted ? 'Muted' : 'Unmuted'}: ${target.name}`);
          }
        }
        else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        console.error('[WS] JSON parse error:', e.message);
      }
    } else {
      // Binary: raw PCM16 audio from any speaker
      const speaker = wsParticipants.get(ws);
      if (!speaker || speaker.muted) return;

      // Silence gate with hangover: an always-open mic streams silence/room
      // noise nonstop, which bloats the OpenAI input buffer (latency grows
      // until translation stalls). Forward audio only while speech is active,
      // plus 1.2s of trailing silence so the model still sees phrase boundaries.
      // readInt16LE instead of an Int16Array view — ws buffers can be
      // unaligned, and the typed-array constructor throws on odd offsets
      let peak = 0;
      const sampleCount = Math.floor(data.length / 2);
      for (let i = 0; i < sampleCount; i++) {
        let a = data.readInt16LE(i * 2);
        if (a < 0) a = -a;
        if (a > peak) peak = a;
      }
      const now = Date.now();
      if (peak > 300) speaker.lastLoud = now;          // ~1% full scale (quiet mics still pass)
      if (!speaker.lastLoud || now - speaker.lastLoud > 1200) return;

      updateSpeakerActivity(speaker);

      const audioB64 = Buffer.from(data).toString('base64');

      // Collect all OTHER participants grouped by lang
      const targetLangs   = new Set();
      const sameLangWs    = [];

      wsParticipants.forEach((p, cws) => {
        if (cws === ws) return;
        if (p.lang !== speaker.lang) {
          targetLangs.add(p.lang);
        } else {
          // Same language: relay audio directly without translation
          sameLangWs.push(cws);
        }
      });

      // Route through translate sessions for different target languages
      targetLangs.forEach((targetLang) => {
        const key = `${speaker.id}_${targetLang}`;
        if (!translateSessions.has(key)) {
          openTranslateSession(speaker.id, speaker.lang, targetLang);
        }
        const s = translateSessions.get(key);
        if (!s) return;
        if (!s.active || s.ws.readyState !== WebSocket.OPEN) {
          // Session still handshaking — buffer instead of dropping the first words
          if (s.pending.length < 100) s.pending.push(audioB64); // ~17s cap at 170ms/chunk
          return;
        }
        s.ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: audioB64 }));
      });

      // Relay directly (same language, no translation needed)
      if (sameLangWs.length > 0) {
        const wav = buildWAV(Buffer.from(data), 24000);
        const msg = JSON.stringify({ type: 'audio', audio: wav.toString('base64') });
        sameLangWs.forEach((cws) => {
          if (cws.readyState === WebSocket.OPEN) cws.send(msg);
        });
      }
    }
  });

  ws.on('close', () => {
    const p = wsParticipants.get(ws);
    if (p) {
      console.log(`[WS] Disconnected: ${p.role} "${p.name}"`);
      clearTimeout(speakerTimers.get(p.id));
      speakerTimers.delete(p.id);
      wsParticipants.delete(ws);
      // Close all translate sessions opened by this speaker
      closeSpeakerSessions(p.id);
      // Close other speakers' sessions that targeted this participant's language
      pruneOrphanedSessions();
      broadcastAll({ type: 'participant_left', id: p.id });
      broadcastParticipantList();
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    const p = wsParticipants.get(ws);
    if (p) { closeSpeakerSessions(p.id); wsParticipants.delete(ws); }
  });
});

// ── Start ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`MeetLingo running on http://localhost:${PORT}`);
});
