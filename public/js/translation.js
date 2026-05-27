// Dynamic — reads from localStorage on every call so mid-meeting language changes work
function getTargetLanguage() {
  const lang = localStorage.getItem('meetlingo_lang') || 'Spanish';
  const map = {
    // Short codes
    'es': 'Spanish',    'fr': 'French',     'de': 'German',
    'it': 'Italian',    'tr': 'Turkish',    'en': 'English',
    'ja': 'Japanese',   'zh': 'Chinese',    'pt': 'Portuguese',
    'nl': 'Dutch',      'ko': 'Korean',     'ar': 'Arabic',
    'ru': 'Russian',    'pl': 'Polish',     'sv': 'Swedish',
    'hi': 'Hindi',      'el': 'Greek',      'uk': 'Ukrainian',
    // Full names (pass-through)
    'Spanish': 'Spanish',       'French': 'French',       'German': 'German',
    'Italian': 'Italian',       'Turkish': 'Turkish',     'English': 'English',
    'Japanese': 'Japanese',     'Chinese': 'Chinese',     'Portuguese': 'Portuguese',
    'Dutch': 'Dutch',           'Korean': 'Korean',       'Arabic': 'Arabic',
    'Russian': 'Russian',       'Polish': 'Polish',       'Swedish': 'Swedish',
    'Hindi': 'Hindi',           'Greek': 'Greek',         'Ukrainian': 'Ukrainian',
  };
  return map[lang] || lang;
}

let audioContext = null;
let mediaStream = null;
let processor = null;
let isRunning = false;
let isMuted = false;
let audioChunks = [];
let silenceTimer = null;

const SILENCE_THRESHOLD  = 0.04;   // raised — filters background noise & prevents Whisper hallucinations
const SILENCE_DURATION   = 500;   // ms — long enough for complete phrases
const MAX_CHUNK_SAMPLES  = 16000 * 6; // 6s max — prevents oversized payloads on Safari/Railway

window.muteTranslation = (muted) => {
  isMuted = muted;
  console.log('[Translation] Muted:', muted);
};

async function startTranslation() {
  try {
    audioContext = new AudioContext({ sampleRate: 16000 });

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    const source    = audioContext.createMediaStreamSource(mediaStream);
    processor       = audioContext.createScriptProcessor(2048, 1, 1);
    isRunning       = true;
    audioChunks     = [];

    processor.onaudioprocess = (e) => {
      if (!isRunning || isMuted) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const volume    = Math.max(...inputData.map(Math.abs));

      if (volume > SILENCE_THRESHOLD) {
        if (typeof window.onAudioActivity === 'function') window.onAudioActivity(volume);
        const pcm16 = floatToPCM16(inputData);
        audioChunks.push(pcm16);

        // Force-send if buffer exceeds max size (prevents oversized payloads)
        const totalSamples = audioChunks.reduce((s, c) => s + c.length, 0);
        if (totalSamples >= MAX_CHUNK_SAMPLES) {
          if (silenceTimer) clearTimeout(silenceTimer);
          processAudio();
          return;
        }

        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (audioChunks.length > 0) processAudio();
        }, SILENCE_DURATION);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    const el = document.getElementById('live-text');
    if (el) el.textContent = '🎤 Listening... speak now';

    console.log('[Translation] Started — language:', getTargetLanguage());

  } catch (err) {
    console.error('[Translation] Error:', err);
    const el = document.getElementById('live-text');
    if (el) el.textContent = '⚠️ Mic denied — allow microphone access';
    if (typeof window.onMicError === 'function') window.onMicError(err);
  }
}

async function processAudio() {
  if (audioChunks.length === 0) return;

  const chunks = [...audioChunks];
  audioChunks  = [];

  try {
    // Combine all PCM chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined    = new Int16Array(totalLength);
    let offset = 0;
    chunks.forEach(chunk => { combined.set(chunk, offset); offset += chunk.length; });

    // Build WAV and encode base64
    const wavBuffer   = createWAV(combined, 16000);
    const base64Audio = arrayBufferToBase64(wavBuffer);

    // Show indicators
    const indicator = document.getElementById('translating-indicator');
    if (indicator) indicator.style.display = 'flex';
    const liveBar = document.getElementById('live-translation-bar');
    if (liveBar) liveBar.style.display = 'block';

    // Host mode → /api/host-translate (no audio back, just transcription)
    // Listener mode → /api/translate (old single-lang flow, not used anymore)
    const endpoint = window.ML_HOST_MODE ? '/api/host-translate' : '/api/translate';
    const hostLang = (window.ML_HOST_LANG) || localStorage.getItem('meetlingo_host_lang') || 'de';
    const body = window.ML_HOST_MODE
      ? { audio: base64Audio, hostLang }
      : { audio: base64Audio, targetLanguage: getTargetLanguage() };

    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });

    if (!response.ok) {
      console.error('[Translation] HTTP', response.status, response.statusText);
      if (window.ML_HOST_MODE && typeof window.onTranslateError === 'function') {
        window.onTranslateError('HTTP ' + response.status);
      }
      return;
    }

    const result = await response.json();

    // Hide indicators
    if (indicator) indicator.style.display = 'none';
    if (liveBar) liveBar.style.display = 'none';

    if (result.success) {
      console.log('[Translation] Original:', result.original);
      if (typeof window.onTranscript === 'function') window.onTranscript(result.original);
      // Only play audio in listener mode
      if (!window.ML_HOST_MODE && result.audio) {
        addToHistory(result.original, result.translation, getTargetLanguage());
        await playBase64Audio(result.audio);
      }
    }

  } catch (err) {
    console.error('[Translation] Process error:', err);
    const liveEl = document.getElementById('live-text');
    if (liveEl) liveEl.textContent = '🎤 Listening... speak now';
    if (window.ML_HOST_MODE && typeof window.onTranslateError === 'function') {
      window.onTranslateError(err.message || 'Network error');
    }
  }
}

// ── WAV encoder ───────────────────────────────
function createWAV(pcm16Data, sampleRate) {
  const buffer = new ArrayBuffer(44 + pcm16Data.length * 2);
  const view   = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0,  'RIFF');
  view.setUint32( 4,  36 + pcm16Data.length * 2, true);
  writeString(8,  'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);  // PCM
  view.setUint16(22, 1,  true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2,  true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm16Data.length * 2, true);

  new Int16Array(buffer, 44).set(pcm16Data);
  return buffer;
}

function floatToPCM16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── Audio playback ────────────────────────────
async function playBase64Audio(base64) {
  try {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const audioBuffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    const source      = audioContext.createBufferSource();
    const gainNode    = audioContext.createGain();

    // Volume: stored as 0-100 integer or 0-1 float — normalise both
    let vol = parseFloat(localStorage.getItem('meetlingo_volume') ?? '0.5');
    if (vol > 1) vol = vol / 100;
    gainNode.gain.value = vol;

    source.buffer = audioBuffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start();

  } catch (err) {
    console.error('[Translation] Playback error:', err);
  }
}

// ── Conversation history ──────────────────────
function addToHistory(original, translated, language) {
  const history    = document.getElementById('conversation-history');
  const emptyState = document.getElementById('empty-state');
  const liveBar    = document.getElementById('live-translation-bar');

  if (!history) return;

  if (emptyState) emptyState.remove();
  if (liveBar) liveBar.style.display = 'none';

  const now  = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const messageDiv = document.createElement('div');
  messageDiv.style.cssText = 'display:flex;flex-direction:column;gap:8px;animation:fadeIn 0.3s ease;';

  const originalBubble = document.createElement('div');
  originalBubble.style.cssText = 'align-self:flex-start;max-width:85%;';
  originalBubble.innerHTML = `
    <p style="font-size:12px;color:#555555;margin:0 0 4px 6px;font-style:italic;">Speaker · ${time}</p>
    <div style="background:#A77F4E;color:white;padding:12px 16px;border-radius:16px;border-bottom-left-radius:4px;font-size:15px;line-height:1.5;">${original}</div>
  `;

  const translatedBubble = document.createElement('div');
  translatedBubble.style.cssText = 'align-self:flex-end;max-width:85%;';
  translatedBubble.innerHTML = `
    <p style="font-size:12px;color:#555555;margin:0 0 4px 6px;font-style:italic;text-align:right;">Translated · ${language}</p>
    <div style="background:#EEEEEE;color:#1A1A1A;padding:12px 16px;border-radius:16px;border-bottom-right-radius:4px;font-size:15px;line-height:1.5;">${translated}</div>
  `;

  messageDiv.appendChild(originalBubble);
  messageDiv.appendChild(translatedBubble);
  history.appendChild(messageDiv);
  history.scrollTop = history.scrollHeight;
}

function stopTranslation() {
  isRunning = false;
  if (silenceTimer) clearTimeout(silenceTimer);
  if (processor)    processor.disconnect();
  if (mediaStream)  mediaStream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();
  audioChunks = [];
  console.log('[Translation] Stopped');
}

function setVolume(vol) {
  // vol: 0–1 float OR 0–100 int — normalize both
  const normalized = vol > 1 ? vol / 100 : vol;
  localStorage.setItem('meetlingo_volume', String(Math.round(normalized * 100)));
  console.log('[Translation] Volume set to', Math.round(normalized * 100) + '%');
}

function setMuted(muted) { isMuted = muted; }
window.TranslationManager = { startTranslation, stopTranslation, setVolume, setMuted };
console.log('[Translation] translation.js (Whisper+TTS) loaded ✓');
