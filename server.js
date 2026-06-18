const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Serve static assets. HTML/JS must always revalidate so a Railway redeploy
// never leaves a browser running stale code (the classic "nothing works after
// deploy" trap: old host.html points at a room the restarted server forgot).
// ETags make revalidation cheap (304 when unchanged); other assets cache normally.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: function (res, filePath) {
    if (/\.(html|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use(express.json({ limit: '10mb' }));

// ── OpenAI ───────────────────────────────────────────
const { OpenAI } = require('openai');
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  return new OpenAI({ apiKey: key });
}

// ── Rooms (one independent meeting each) ─────────────────────────────
// Replaces the old single global meeting. Each room owns its own
// participants, translate sessions, agenda and a secret host token that
// gates host-only actions (start/end/mute/agenda).
//
// room = {
//   code, hostToken, active, startTime, agenda,
//   participants: Map(ws -> { id, name, lang, role, muted, speaking, isHost }),
//   translateSessions: Map("speakerId_targetLang" -> session),
//   speakerTimers: Map(speakerId -> timeout),
//   lastActivity
// }
const rooms     = new Map();   // code -> room
const wsToRoom  = new Map();   // ws -> code  (fast lookup on message/close)

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/O/0/1
function genRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}
function createRoom() {
  const room = {
    code: genRoomCode(),
    hostToken: crypto.randomBytes(24).toString('hex'),
    active: false,
    startTime: null,
    agenda: '',
    participants: new Map(),
    translateSessions: new Map(),
    speakerTimers: new Map(),
    lastActivity: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}
function getRoom(code) {
  return code ? rooms.get(String(code).trim().toUpperCase()) : null;
}
function isHostAuthed(room, token) {
  return !!room && typeof token === 'string' && token.length > 0 &&
         crypto.timingSafeEqual(Buffer.from(token), Buffer.from(room.hostToken));
}
// Tolerant equality for length-mismatched tokens (timingSafeEqual throws on
// different lengths). Wraps isHostAuthed so a wrong-length token just fails.
function hostOk(room, token) {
  try { return isHostAuthed(room, token); } catch (e) { return false; }
}

// Drop empty rooms after a while so the map doesn't grow forever.
const ROOM_TTL_MS = 1000 * 60 * 60; // 1h idle
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    if (room.participants.size === 0 && now - room.lastActivity > ROOM_TTL_MS) {
      closeAllTranslateSessions(room);
      rooms.delete(code);
      console.log(`[Room] Reaped idle room ${code}`);
    }
  });
}, 1000 * 60 * 10);

// ── REST API ──────────────────────────────────────────
app.post('/api/send-code', express.json(), (req, res) => {
  res.json({ success: true });
});
app.post('/api/verify-code', express.json(), (req, res) => {
  res.json({ success: true });
});

// Post-meeting summary email — intentionally a no-op stub for now (the firm's
// admin enables real sending later). Kept so ended.html doesn't 404.
app.post('/api/send-summary-email', express.json(), (req, res) => {
  res.json({ success: true });
});

// Host creates a fresh room and receives the secret token. Anyone may create
// a room (they only ever control the room they created, via this token).
app.post('/api/create-room', (req, res) => {
  const room = createRoom();
  console.log(`[Room] Created ${room.code}`);
  res.json({ success: true, room: room.code, hostToken: room.hostToken });
});

app.post('/api/agenda', express.json(), (req, res) => {
  const room = getRoom(req.body.room);
  if (!room || !hostOk(room, req.body.hostToken)) return res.status(403).json({ success: false, error: 'forbidden' });
  room.agenda = req.body.agenda || '';
  room.lastActivity = Date.now();
  broadcastAll(room, { type: 'agenda_update', agenda: room.agenda });
  res.json({ success: true });
});

app.get('/api/agenda', (req, res) => {
  const room = getRoom(req.query.room);
  res.json({ agenda: room ? room.agenda : '' });
});

app.post('/api/meeting-start', express.json(), (req, res) => {
  const room = getRoom(req.body.room);
  if (!room || !hostOk(room, req.body.hostToken)) return res.status(403).json({ success: false, error: 'forbidden' });
  room.active = true;
  room.startTime = Date.now();
  room.lastActivity = Date.now();
  broadcastAll(room, { type: 'meeting_started' });
  console.log(`[Room ${room.code}] Meeting started`);
  res.json({ success: true });
});

app.post('/api/meeting-end', express.json(), (req, res) => {
  const room = getRoom(req.body.room);
  if (!room || !hostOk(room, req.body.hostToken)) return res.status(403).json({ success: false, error: 'forbidden' });
  room.active = false;
  closeAllTranslateSessions(room);
  broadcastAll(room, { type: 'meeting_ended' });
  console.log(`[Room ${room.code}] Meeting ended`);
  res.json({ success: true });
});

app.get('/api/meeting-status', (req, res) => {
  const room = getRoom(req.query.room);
  if (!room) return res.json({ exists: false, active: false, startTime: null });
  res.json({ exists: true, active: room.active, startTime: room.startTime });
});

app.get('/api/listener-stats', (req, res) => {
  const room = getRoom(req.query.room);
  const counts = {};
  if (room) room.participants.forEach((p) => {
    if (p.role === 'listener') counts[p.lang] = (counts[p.lang] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ counts, total });
});

// Stateless text translation (agenda + UI) — no room needed.
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

// ── WebSocket ─────────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true });

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

// ── Per-room broadcast helpers ────────────────────────
function broadcastAll(room, msg) {
  const str = JSON.stringify(msg);
  room.participants.forEach((p, ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(str);
  });
}
function broadcastToLang(room, targetLang, msg, excludeSpeakerId) {
  const str = JSON.stringify(msg);
  room.participants.forEach((p, ws) => {
    if (p.lang === targetLang && ws.readyState === WebSocket.OPEN) {
      if (!excludeSpeakerId || p.id !== excludeSpeakerId) ws.send(str);
    }
  });
}
function findParticipantById(room, id) {
  for (const [, p] of room.participants) { if (p.id === id) return p; }
  return null;
}
function broadcastParticipantList(room) {
  const list = [];
  room.participants.forEach((p) => {
    list.push({ id: p.id, name: p.name, lang: p.lang, role: p.role, muted: !!p.muted, speaking: !!p.speaking });
  });
  broadcastAll(room, { type: 'participant_list', participants: list });
}
function updateSpeakerActivity(room, speaker) {
  if (!speaker.speaking) {
    speaker.speaking = true;
    broadcastAll(room, { type: 'speaker_active', id: speaker.id, name: speaker.name, lang: speaker.lang });
  }
  clearTimeout(room.speakerTimers.get(speaker.id));
  room.speakerTimers.set(speaker.id, setTimeout(() => {
    speaker.speaking = false;
    room.speakerTimers.delete(speaker.id);
    broadcastAll(room, { type: 'speaker_inactive', id: speaker.id });
  }, 1500));
}

// ── OpenAI Translate Session (per room × speaker × target lang) ──────
function openTranslateSession(room, speakerId, sourceLang, targetLang) {
  const key = `${speakerId}_${targetLang}`;
  if (room.translateSessions.has(key)) return;

  const key_env = process.env.OPENAI_API_KEY;
  if (!key_env) { console.error('[Translate] Missing OPENAI_API_KEY'); return; }

  const langCode = LANG_CODES[targetLang] || 'en';
  console.log(`[Translate ${room.code}] Opening: ${speakerId} (${sourceLang}) → ${targetLang} (${langCode})`);

  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`,
    { headers: { 'Authorization': `Bearer ${key_env}` } }
  );

  const session = { ws: openaiWs, active: false, speakerId, sourceLang, targetLang, pending: [] };
  room.translateSessions.set(key, session);

  openaiWs.on('open', () => {
    console.log(`[Translate ${room.code}] WS open: ${key}`);
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
        session.pending.forEach((audioB64) => {
          openaiWs.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: audioB64 }));
        });
        session.pending = [];
        console.log(`[Translate ${room.code}] Ready: ${key}`);
      }
      else if (evt.type === 'session.output_audio.delta' && evt.delta) {
        const pcm = Buffer.from(evt.delta, 'base64');
        const wav = buildWAV(pcm, 24000);
        broadcastToLang(room, targetLang, { type: 'audio', audio: wav.toString('base64') }, speakerId);
      }
      else if (evt.type === 'session.output_transcript.delta' && evt.delta) {
        const sp = findParticipantById(room, speakerId);
        broadcastToLang(room, targetLang, {
          type: 'transcript', text: evt.delta,
          speakerId, name: sp ? sp.name : '?', sourceLang: sp ? sp.lang : sourceLang
        }, speakerId);
      }
      else if (evt.type === 'session.input_transcript.delta' && evt.delta) {
        const sp = findParticipantById(room, speakerId);
        const name = sp ? sp.name : '?';
        const lang = sp ? sp.lang : sourceLang;
        const payload = JSON.stringify({ type: 'source_transcript', text: evt.delta, speakerId, name, lang });
        room.participants.forEach((p, pws) => {
          if (p.id !== speakerId && pws.readyState === WebSocket.OPEN) pws.send(payload);
        });
      }
      else if (evt.type === 'error') {
        const msg = evt.error && evt.error.message ? evt.error.message : JSON.stringify(evt.error);
        console.error(`[Translate ${room.code}] Error (${key}):`, msg);
        try { openaiWs.close(); } catch (e) {}
        if (room.translateSessions.get(key) === session) room.translateSessions.delete(key);
      }
    } catch (e) {
      console.error('[Translate] Parse error:', e.message);
    }
  });

  openaiWs.on('close', () => {
    if (room.translateSessions.get(key) === session) room.translateSessions.delete(key);
  });
  openaiWs.on('error', (err) => {
    console.error(`[Translate ${room.code}] WS error (${key}):`, err.message);
    if (room.translateSessions.get(key) === session) room.translateSessions.delete(key);
  });
}

function closeSpeakerSessions(room, speakerId) {
  const keysToClose = [];
  room.translateSessions.forEach((s, key) => { if (s.speakerId === speakerId) keysToClose.push(key); });
  keysToClose.forEach((key) => {
    const s = room.translateSessions.get(key);
    if (s) { try { s.ws.close(); } catch (e) {} room.translateSessions.delete(key); }
  });
}
function pruneOrphanedSessions(room) {
  room.translateSessions.forEach((s, key) => {
    let hasAudience = false;
    room.participants.forEach((p) => {
      if (p.id !== s.speakerId && p.lang === s.targetLang) hasAudience = true;
    });
    if (!hasAudience) {
      try { s.ws.close(); } catch (e) {}
      room.translateSessions.delete(key);
    }
  });
}
function closeAllTranslateSessions(room) {
  room.translateSessions.forEach((s, key) => {
    try { s.ws.close(); } catch (e) {}
    room.translateSessions.delete(key);
  });
}

// ── WS Connection ──────────────────────────────────────
wss.on('connection', (ws) => {
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      let msg;
      try { msg = JSON.parse(data.toString()); }
      catch (e) { return; }

      if (msg.type === 'join') {
        const room = getRoom(msg.room);
        if (!room) {
          // No such room — tell the client so it can show "meeting not found"
          // (or, for a host whose room vanished on restart, recreate one).
          try { ws.send(JSON.stringify({ type: 'room_not_found' })); } catch (e) {}
          return;
        }
        const id   = 'p_' + crypto.randomBytes(4).toString('hex');
        // role 'host' is only granted with the correct secret token; otherwise
        // the client is downgraded to a listener (can't mute/end the meeting).
        const wantsHost = msg.role === 'host';
        const authedHost = wantsHost && hostOk(room, msg.hostToken);
        const role = authedHost ? 'host' : 'listener';
        const name = sanitizeName(msg.name, role === 'host' ? 'Host' : 'Guest');
        const lang = sanitizeLang(msg.lang);
        if (wantsHost && !authedHost) {
          console.warn(`[WS ${room.code}] Host join rejected (bad token) — downgraded to listener`);
        }
        room.participants.set(ws, { id, name, lang, role, muted: false, speaking: false, isHost: authedHost });
        room.lastActivity = Date.now();
        wsToRoom.set(ws, room.code);
        ws.send(JSON.stringify({ type: 'joined', id, name, role, active: room.active, startTime: room.startTime }));
        broadcastParticipantList(room);
        console.log(`[WS ${room.code}] Joined: ${role} "${name}" / ${lang}`);
        return;
      }

      // All other messages require an established room membership.
      const room = getRoom(wsToRoom.get(ws));
      if (!room) return;
      const self = room.participants.get(ws);
      if (!self) return;
      room.lastActivity = Date.now();

      if (msg.type === 'lang_change') {
        closeSpeakerSessions(room, self.id);
        self.lang = sanitizeLang(msg.lang);
        pruneOrphanedSessions(room);
        broadcastParticipantList(room);
      }
      else if (msg.type === 'name_change') {
        if (msg.name) {
          self.name = sanitizeName(msg.name, self.name);
          broadcastParticipantList(room);
          if (self.speaking) broadcastAll(room, { type: 'speaker_active', id: self.id, name: self.name, lang: self.lang });
        }
      }
      else if (msg.type === 'meeting_end') {
        if (!self.isHost) return;               // only the authenticated host
        room.active = false;
        closeAllTranslateSessions(room);
        broadcastAll(room, { type: 'meeting_ended' });
        console.log(`[WS ${room.code}] Meeting ended by host`);
      }
      else if (msg.type === 'mute_participant') {
        if (!self.isHost) return;               // only the authenticated host
        const target = findParticipantById(room, msg.targetId);
        if (target) {
          target.muted = !target.muted;
          broadcastParticipantList(room);
        }
      }
      else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } else {
      // Binary: raw PCM16 audio from any speaker in the room
      const room = getRoom(wsToRoom.get(ws));
      if (!room) return;
      const speaker = room.participants.get(ws);
      if (!speaker || speaker.muted) return;

      // Silence gate with hangover (always-open mics bloat the OpenAI buffer).
      let peak = 0;
      const sampleCount = Math.floor(data.length / 2);
      for (let i = 0; i < sampleCount; i++) {
        let a = data.readInt16LE(i * 2);
        if (a < 0) a = -a;
        if (a > peak) peak = a;
      }
      const now = Date.now();
      if (peak > 300) speaker.lastLoud = now;
      if (!speaker.lastLoud || now - speaker.lastLoud > 1200) return;

      room.lastActivity = now;
      updateSpeakerActivity(room, speaker);

      const audioB64 = Buffer.from(data).toString('base64');
      const targetLangs = new Set();
      const sameLangWs  = [];

      room.participants.forEach((p, cws) => {
        if (cws === ws) return;
        if (p.lang !== speaker.lang) targetLangs.add(p.lang);
        else sameLangWs.push(cws);
      });

      targetLangs.forEach((targetLang) => {
        const key = `${speaker.id}_${targetLang}`;
        if (!room.translateSessions.has(key)) openTranslateSession(room, speaker.id, speaker.lang, targetLang);
        const s = room.translateSessions.get(key);
        if (!s) return;
        if (!s.active || s.ws.readyState !== WebSocket.OPEN) {
          if (s.pending.length < 100) s.pending.push(audioB64);
          return;
        }
        s.ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: audioB64 }));
      });

      if (sameLangWs.length > 0) {
        const wav = buildWAV(Buffer.from(data), 24000);
        const relay = JSON.stringify({ type: 'audio', audio: wav.toString('base64') });
        sameLangWs.forEach((cws) => { if (cws.readyState === WebSocket.OPEN) cws.send(relay); });
      }
    }
  });

  ws.on('close', () => {
    const room = getRoom(wsToRoom.get(ws));
    wsToRoom.delete(ws);
    if (!room) return;
    const p = room.participants.get(ws);
    if (p) {
      console.log(`[WS ${room.code}] Disconnected: ${p.role} "${p.name}"`);
      clearTimeout(room.speakerTimers.get(p.id));
      room.speakerTimers.delete(p.id);
      room.participants.delete(ws);
      room.lastActivity = Date.now();
      closeSpeakerSessions(room, p.id);
      pruneOrphanedSessions(room);
      broadcastAll(room, { type: 'participant_left', id: p.id });
      broadcastParticipantList(room);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    const room = getRoom(wsToRoom.get(ws));
    wsToRoom.delete(ws);
    if (room) {
      const p = room.participants.get(ws);
      if (p) closeSpeakerSessions(room, p.id);
      room.participants.delete(ws);
    }
  });
});

// ── Start ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`MeetLingo running on http://localhost:${PORT}`);
});
