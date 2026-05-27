// ─────────────────────────────────────────────
//  MeetLingo — audio.js  (v2 — Safari fixed)
//  Proper audio queue scheduling + mic metering
// ─────────────────────────────────────────────

let _audioCtx   = null;
let _analyser   = null;
let _gainNode   = null;
let _micSource  = null;
let _nextPlayAt = 0;    // scheduled time for next audio chunk

// ── AudioContext ──────────────────────────────
function getAudioContext() {
    if (!_audioCtx || _audioCtx.state === 'closed') {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (_audioCtx.state === 'suspended') {
        _audioCtx.resume().then(() => console.log('[Audio] AudioContext resumed'));
    }
    return _audioCtx;
}

// ── GainNode ──────────────────────────────────
function getGainNode() {
    const ctx = getAudioContext();
    if (!_gainNode) {
        _gainNode = ctx.createGain();
        _gainNode.connect(ctx.destination);
        const saved = localStorage.getItem('meetlingo_volume');
        _gainNode.gain.value = saved ? saved / 100 : 0.5;
    }
    return _gainNode;
}

// ── connectMic(stream) ────────────────────────
function connectMic(stream) {
    const ctx = getAudioContext();
    _micSource = ctx.createMediaStreamSource(stream);
    _analyser  = ctx.createAnalyser();
    _analyser.fftSize = 256;
    _micSource.connect(_analyser);
    console.log('[Audio] Mic connected to analyser');
}

// ── getMicLevel() → 0-100 ─────────────────────
function getMicLevel() {
    if (!_analyser) return 0;
    const buf = new Uint8Array(_analyser.frequencyBinCount);
    _analyser.getByteFrequencyData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    return Math.min(100, Math.round((rms / 128) * 100));
}

// ── setVolume(0-100) ──────────────────────────
function setVolume(level) {
    const clamped = Math.max(0, Math.min(100, level));
    localStorage.setItem('meetlingo_volume', clamped);
    getGainNode().gain.setTargetAtTime(clamped / 100, getAudioContext().currentTime, 0.05);
}

// ── playPcm16Chunk(base64) ────────────────────
// Queues each incoming audio chunk at the correct scheduled time.
// Without this, Safari plays all chunks at t=0 and they cancel each other out.
function playPcm16Chunk(base64) {
    try {
        const ctx    = getAudioContext();
        const gain   = getGainNode();

        // Decode base64 → PCM16 bytes
        const binary  = atob(base64);
        const bytes   = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        // PCM16 little-endian → Float32
        const samples = new Float32Array(bytes.length / 2);
        const view    = new DataView(bytes.buffer);
        for (let i = 0; i < samples.length; i++) {
            samples[i] = view.getInt16(i * 2, true) / 32768;
        }

        // AudioContext runs at 24000 Hz (set above), OpenAI outputs at 24000 Hz ✓
        const buffer  = ctx.createBuffer(1, samples.length, 24000);
        buffer.copyToChannel(samples, 0);

        const source  = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);

        // Schedule sequentially — key fix for Safari
        const now = ctx.currentTime;
        if (_nextPlayAt < now + 0.05) {
            _nextPlayAt = now + 0.05; // small lead-in buffer (50ms)
        }
        source.start(_nextPlayAt);
        _nextPlayAt += buffer.duration;

        console.log(`[Audio] Playing chunk — ${samples.length} samples, scheduled at ${_nextPlayAt.toFixed(3)}s`);
    } catch (err) {
        console.error('[Audio] playPcm16Chunk error:', err);
    }
}

// ── playBase64Audio(base64) ───────────────────
// Plays base64-encoded MP3/WAV audio from TTS-1 (listener polling mode)
async function playBase64Audio(base64) {
    try {
        const ctx  = getAudioContext();
        // Ensure AudioContext is running (required by Safari autoplay policy)
        if (ctx.state !== 'running') await ctx.resume();
        const gain = getGainNode();

        const binary = atob(base64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        const source      = ctx.createBufferSource();
        source.buffer     = audioBuffer;
        source.connect(gain);

        // Schedule sequentially so chunks don't overlap
        const now = ctx.currentTime;
        if (_nextPlayAt < now + 0.05) _nextPlayAt = now + 0.05;
        source.start(_nextPlayAt);
        _nextPlayAt += audioBuffer.duration;

        // Return a Promise that resolves when this chunk finishes playing
        return new Promise((resolve) => { source.onended = resolve; });
    } catch (err) {
        console.error('[Audio] playBase64Audio error:', err);
    }
}

// ── Exports ───────────────────────────────────
window.AudioManager = {
    getAudioContext,
    connectMic,
    getMicLevel,
    setVolume,
    playPcm16Chunk,
    playBase64Audio,
};

console.log('[Audio] audio.js loaded ✓');
