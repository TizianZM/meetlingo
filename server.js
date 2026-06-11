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
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY environment variable is not set');
  return new OpenAI({ apiKey: key });
}

// ── Resend (email) ────────────────────────────────────
const { Resend } = require('resend');
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY environment variable is not set');
  return new Resend(key);
}

// ── Verification codes ────────────────────────────────
// email → { code, expires }  (10-minute TTL, cleaned on use)
const pendingCodes = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── PDF generation ────────────────────────────────────
const PDFDocument = require('pdfkit');
const SVGtoPDF   = require('svg-to-pdfkit');
const https      = require('https');

let _zimmLogoSvg = null;
function fetchZimmLogo() {
  if (_zimmLogoSvg) return Promise.resolve(_zimmLogoSvg);
  return new Promise((resolve) => {
    https.get('https://zimm.com/wp-content/uploads/2023/08/zimm-group.svg', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { _zimmLogoSvg = d; resolve(d); });
    }).on('error', () => resolve(null));
  });
}

async function generateMeetingPDF({ startTime, endTime, agenda, transcriptions, languages, summary }) {
  const logoSvg = await fetchZimmLogo();
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 } });
    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end',  () => resolve(Buffer.concat(bufs)));

    const W = doc.page.width - 120; // usable width

    // ── Header ──────────────────────────────────────────
    if (logoSvg) {
      try { SVGtoPDF(doc, logoSvg, 60, 58, { width: 160, height: 22 }); } catch {}
    }
    doc.fontSize(9).fillColor('#888888').font('Helvetica')
       .text('MEETING REPORT', 60, 65, { width: W, align: 'right' });
    doc.moveDown(0.4);

    // ── Thin divider ─────────────────────────────────────
    const lineY = () => doc.y;
    const rule  = () => {
      doc.moveTo(60, lineY()).lineTo(60 + W, lineY()).lineWidth(0.5).strokeColor('#DDDDDD').stroke();
      doc.moveDown(0.6);
    };

    doc.y = 95;
    rule();

    // ── Title ────────────────────────────────────────────
    doc.fontSize(22).fillColor('#1a1a1a').font('Helvetica-Bold')
       .text('Meeting Summary', 60, doc.y, { width: W });
    doc.moveDown(0.3);

    // ── Date / Duration ──────────────────────────────────
    const start    = new Date(startTime);
    const end      = new Date(endTime || Date.now());
    const durSec   = Math.max(0, Math.floor((end - start) / 1000));
    const durMin   = Math.floor(durSec / 60);
    const durLabel = durMin > 0 ? `${durMin} min ${String(durSec % 60).padStart(2,'0')} s` : `${durSec} s`;
    const dateStr  = start.toLocaleDateString('de-AT', { day:'2-digit', month:'long', year:'numeric' });
    const timeStr  = start.toLocaleTimeString('de-AT', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';

    doc.fontSize(10).fillColor('#555555').font('Helvetica');
    const metaLeft  = 60;
    const metaRight = 60 + W / 2;
    const metaY     = doc.y + 4;

    // Left column
    const field = (label, value, x, y) => {
      doc.fontSize(8).fillColor('#999').font('Helvetica').text(label.toUpperCase(), x, y);
      doc.fontSize(11).fillColor('#1a1a1a').font('Helvetica-Bold').text(value, x, doc.y + 1);
    };

    field('Date',      dateStr,   metaLeft,  metaY);
    const afterDate = doc.y + 10;
    field('Start',     timeStr,   metaLeft,  afterDate);
    const afterTime = doc.y + 10;
    field('Duration',  durLabel,  metaLeft,  afterTime);

    field('Location',  'Virtual Meeting — MeetLingo',  metaRight, metaY);
    const afterLoc = doc.y + 10;
    field('Languages', languages.length ? languages.join(', ') : '—', metaRight, afterLoc);

    doc.y = Math.max(doc.y, afterTime + 24) + 8;
    rule();

    // ── Agenda ───────────────────────────────────────────
    if (agenda && agenda.trim()) {
      doc.fontSize(11).fillColor('#95C11E').font('Helvetica-Bold').text('AGENDA', 60, doc.y);
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#1a1a1a').font('Helvetica').text(agenda.trim(), 60, doc.y, { width: W, lineGap: 3 });
      doc.moveDown(0.8);
      rule();
    }

    // ── Meeting Summary ───────────────────────────────────
    doc.fontSize(11).fillColor('#95C11E').font('Helvetica-Bold').text('MEETING SUMMARY', 60, doc.y);
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#333333').font('Helvetica')
       .text(summary || 'No summary available.', 60, doc.y, { width: W, lineGap: 3, align: 'justify' });
    doc.moveDown(1);

    // ── Transcription Highlights ──────────────────────────
    if (transcriptions && transcriptions.length > 0) {
      rule();
      doc.fontSize(11).fillColor('#95C11E').font('Helvetica-Bold').text('TRANSCRIPT EXCERPTS', 60, doc.y);
      doc.moveDown(0.4);
      transcriptions.slice(0, 20).forEach((t, i) => {
        doc.fontSize(9).fillColor('#777').font('Helvetica').text(`[${i+1}]`, 60, doc.y, { continued: true });
        doc.fontSize(10).fillColor('#333').font('Helvetica').text('  ' + t, { width: W - 20, lineGap: 2 });
        doc.moveDown(0.15);
      });
    }

    // ── Footer ────────────────────────────────────────────
    const footerY = doc.page.height - 50;
    doc.moveTo(60, footerY).lineTo(60 + W, footerY).lineWidth(0.5).strokeColor('#DDDDDD').stroke();
    doc.fontSize(8).fillColor('#AAAAAA').font('Helvetica')
       .text(`Generated by MeetLingo · ZIMM GmbH · zimm.com · ${new Date().toISOString().slice(0,10)}`, 60, footerY + 8, { width: W, align: 'center' });

    doc.end();
  });
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
let allTranscriptions = [];       // full transcript log for summary/PDF
let meetingEndTime = null;
let peakListenerLangs = new Set();// languages seen during the meeting

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

// ── Email verification ────────────────────────────────

app.post('/api/send-code', express.json(), async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({ success: false, error: 'Invalid email address' });
  }
  const code = generateCode();
  pendingCodes.set(email.toLowerCase(), { code, expires: Date.now() + 10 * 60 * 1000 });

  try {
    await getResend().emails.send({
      from: 'MeetLingo <onboarding@resend.dev>',
      to: email,
      subject: `Your MeetLingo code: ${code}`,
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
          <div style="text-align:center;margin-bottom:28px;">
            <span style="font-size:24px;font-weight:700;color:#95C11E;">MeetLingo</span>
            <span style="font-size:13px;color:#A77F4E;margin-left:4px;">by ZIMM</span>
          </div>
          <div style="background:#fff;border-radius:16px;padding:32px 24px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
            <p style="font-size:16px;color:#444;margin:0 0 24px;">Your verification code is:</p>
            <div style="font-size:48px;font-weight:700;letter-spacing:12px;color:#1a1c1c;margin-bottom:24px;">${code}</div>
            <p style="font-size:13px;color:#999;margin:0;">Valid for 10 minutes. Do not share this code.</p>
          </div>
          <p style="text-align:center;font-size:12px;color:#bbb;margin-top:24px;">MeetLingo &mdash; Real-time meeting translation</p>
        </div>
      `,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
    res.json({ success: false, error: 'Failed to send email' });
  }
});

app.post('/api/verify-code', express.json(), (req, res) => {
  const { email, code } = req.body;
  const key = (email || '').toLowerCase();
  const entry = pendingCodes.get(key);
  if (!entry) return res.json({ success: false, error: 'No code sent to this email' });
  if (Date.now() > entry.expires) {
    pendingCodes.delete(key);
    return res.json({ success: false, error: 'Code expired — request a new one' });
  }
  if (entry.code !== String(code).trim()) {
    return res.json({ success: false, error: 'Incorrect code' });
  }
  pendingCodes.delete(key);
  res.json({ success: true });
});

// ── Session management ────────────────────────────────

// Reset (called when host loads page)
app.post('/api/reset-session', express.json(), (req, res) => {
  listenerSessions = new Map();
  textQueue = [];
  nextChunkId = 1;
  meetingActive = false;
  meetingStartTime = null;
  meetingEndTime = null;
  recentTexts = new Map();
  recentContext = [];
  meetingAgenda = '';
  allTranscriptions = [];
  peakListenerLangs = new Set();
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
  meetingEndTime = Date.now();
  console.log('[Session] Meeting ended');
  res.json({ success: true });
});

// Returns snapshot of meeting data for summary/confirmation page
app.get('/api/meeting-summary', (req, res) => {
  const langs = peakListenerLangs.size > 0
    ? [...peakListenerLangs]
    : getActiveLangs();
  res.json({
    startTime:       meetingStartTime,
    endTime:         meetingEndTime || Date.now(),
    agenda:          meetingAgenda,
    transcriptions:  allTranscriptions,
    languages:       langs,
  });
});

// Generates PDF + sends summary email to listener
app.post('/api/send-summary-email', express.json(), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, error: 'No email provided' });

  const langs        = peakListenerLangs.size > 0 ? [...peakListenerLangs] : getActiveLangs();
  const startTime    = meetingStartTime || Date.now();
  const endTime      = meetingEndTime   || Date.now();
  const durSec       = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const durMin       = Math.floor(durSec / 60);
  const durLabel     = durMin > 0 ? `${durMin} min ${String(durSec % 60).padStart(2,'0')} s` : `${durSec} s`;
  const dateStr      = new Date(startTime).toLocaleDateString('de-AT', { day:'2-digit', month:'long', year:'numeric' });

  try {
    // Generate GPT summary from all transcriptions
    let gptSummary = 'No transcript available for this meeting.';
    if (allTranscriptions.length > 0) {
      const transcript = allTranscriptions.join(' | ');
      const result = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini', max_tokens: 400, temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are a professional meeting secretary. Write a concise, formal meeting summary in English (3-5 sentences) based on the provided transcript. Focus on main topics, decisions, and action items.' },
          { role: 'user', content: `Transcript: ${transcript}` }
        ]
      });
      gptSummary = result.choices[0].message.content;
    }

    // Generate PDF
    const pdfBuffer = await generateMeetingPDF({
      startTime, endTime,
      agenda:          meetingAgenda,
      transcriptions:  allTranscriptions,
      languages:       langs,
      summary:         gptSummary,
    });

    // Send email with PDF attachment
    await getResend().emails.send({
      from: 'MeetLingo <onboarding@resend.dev>',
      to: email,
      subject: `Meeting Summary — ${dateStr}`,
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
          <div style="text-align:center;margin-bottom:28px;">
            <span style="font-size:24px;font-weight:700;color:#95C11E;">MeetLingo</span>
            <span style="font-size:13px;color:#A77F4E;margin-left:4px;">by ZIMM</span>
          </div>
          <div style="background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
            <h2 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px;">Meeting Summary</h2>
            <p style="font-size:13px;color:#888;margin:0 0 24px;">${dateStr} &nbsp;·&nbsp; ${durLabel} &nbsp;·&nbsp; ${langs.join(', ') || '—'}</p>
            ${meetingAgenda ? `<div style="border-left:3px solid #95C11E;padding:10px 14px;background:#f8fff0;border-radius:0 8px 8px 0;margin-bottom:20px;"><p style="font-size:12px;font-weight:700;color:#95C11E;margin:0 0 6px;text-transform:uppercase;">Agenda</p><p style="font-size:13px;color:#333;margin:0;white-space:pre-line;">${meetingAgenda}</p></div>` : ''}
            <p style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;margin:0 0 8px;">Summary</p>
            <p style="font-size:14px;color:#333;line-height:1.7;margin:0 0 20px;">${gptSummary}</p>
            <p style="font-size:12px;color:#aaa;margin:0;">The full meeting report is attached as a PDF.</p>
          </div>
          <p style="text-align:center;font-size:11px;color:#bbb;margin-top:20px;">ZIMM GmbH · zimm.com · MeetLingo</p>
        </div>
      `,
      attachments: [{
        filename: `MeetLingo-Summary-${new Date(startTime).toISOString().slice(0,10)}.pdf`,
        content:  pdfBuffer.toString('base64'),
      }],
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Summary] Email failed:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// Quick GPT summary for host confirmation page (no PDF, no email)
app.get('/api/generate-host-summary', async (req, res) => {
  if (allTranscriptions.length === 0) return res.json({ summary: null });
  try {
    const transcript = allTranscriptions.join(' | ');
    const result = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.3,
      messages: [
        { role: 'system', content: 'Write a concise, formal meeting summary in English (3-4 sentences). Focus on main topics and key points discussed.' },
        { role: 'user', content: `Transcript: ${transcript}` }
      ]
    });
    res.json({ summary: result.choices[0].message.content });
  } catch (err) {
    res.json({ summary: null, error: err.message });
  }
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
    peakListenerLangs.add(lang); // track all languages ever connected
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

    // Store for summary/PDF (cap at 500 entries)
    allTranscriptions.push(originalText);
    if (allTranscriptions.length > 500) allTranscriptions.shift();

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
