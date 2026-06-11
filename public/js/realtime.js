// MeetLingo Realtime — WebSocket speech-to-speech translation client
// Replaces translation.js (REST/Whisper approach)
(function () {
  'use strict';

  var _ws          = null;
  var _audioCtx    = null;
  var _stream      = null;
  var _processor   = null;
  var _isMuted     = true;   // default: muted
  var _micStarted  = false;
  var _closing     = false;
  var _reconnectTimer = null;

  // ── Audio playback queue (sequential, no overlap) ──────
  var _playQueue   = [];
  var _isPlaying   = false;

  function _playNext() {
    if (_isPlaying || _playQueue.length === 0) return;
    var b64 = _playQueue.shift();
    _isPlaying = true;
    _decodeAndPlay(b64, function () {
      _isPlaying = false;
      _playNext();
    });
  }

  function _decodeAndPlay(b64, onDone) {
    try {
      var ctx = _getAudioCtx();
      var binary = atob(b64);
      var bytes  = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      ctx.decodeAudioData(bytes.buffer.slice(0), function (buf) {
        var src  = ctx.createBufferSource();
        var gain = ctx.createGain();
        var vol  = parseFloat(localStorage.getItem('meetlingo_volume') || '50');
        if (vol > 1) vol = vol / 100;
        gain.gain.value = vol;
        src.buffer = buf;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.onended = onDone;
        src.start(0);
      }, function (err) {
        console.error('[Realtime] decodeAudioData error:', err);
        onDone();
      });
    } catch (e) {
      console.error('[Realtime] Playback error:', e);
      onDone();
    }
  }

  // ── AudioContext (lazy, 16 kHz for mic; handles WAV playback via resample) ──
  function _getAudioCtx() {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }

  // ── WebSocket connection ───────────────────────────────
  function connect() {
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
    _closing = false;

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url   = proto + '//' + location.host + '/ws/meeting';
    var lang  = localStorage.getItem('meetlingo_lang') || 'English';
    var role  = window.ML_HOST_MODE ? 'host' : 'listener';

    try {
      _ws = new WebSocket(url);
    } catch (e) {
      _fireError('WebSocket init failed: ' + e.message);
      return;
    }

    _ws.onopen = function () {
      console.log('[Realtime] WS connected');
      clearTimeout(_reconnectTimer);
      _ws.send(JSON.stringify({ type: 'join', lang: lang, role: role }));
    };

    _ws.onmessage = function (evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'joined') {
          if (typeof window.onMLConnected === 'function') window.onMLConnected(msg);
        }
        else if (msg.type === 'audio') {
          _playQueue.push(msg.audio);
          _playNext();
          if (msg.transcript && typeof window.onMLTranscript === 'function') {
            window.onMLTranscript(msg.transcript);
          }
        }
        else if (msg.type === 'meeting_ended') {
          if (typeof window.onMLMeetingEnded === 'function') window.onMLMeetingEnded();
        }
        else if (msg.type === 'error') {
          _fireError(msg.message || 'Translation error');
        }
      } catch (e) {
        console.error('[Realtime] Message parse error:', e);
      }
    };

    _ws.onerror = function () {
      _fireError('WebSocket connection error');
    };

    _ws.onclose = function (evt) {
      console.log('[Realtime] WS closed:', evt.code);
      if (!_closing) {
        // Auto-reconnect after 3 s
        _reconnectTimer = setTimeout(function () {
          if (!_closing) connect();
        }, 3000);
      }
    };
  }

  // ── Mic capture ────────────────────────────────────────
  function startMic(onGranted, onDenied) {
    if (_micStarted) return;
    _micStarted = true;

    navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }).then(function (stream) {
      _stream = stream;
      var ctx    = _getAudioCtx();
      var source = ctx.createMediaStreamSource(stream);
      _processor  = ctx.createScriptProcessor(4096, 1, 1);

      _processor.onaudioprocess = function (e) {
        if (_isMuted) return;
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;

        var input = e.inputBuffer.getChannelData(0);
        var vol   = 0;
        for (var i = 0; i < input.length; i++) { var a = Math.abs(input[i]); if (a > vol) vol = a; }
        if (vol < 0.01) return; // skip silence frames

        if (typeof window.onMLAudioActivity === 'function') window.onMLAudioActivity(vol);

        // Float32 → PCM16
        var pcm = new Int16Array(input.length);
        for (var j = 0; j < input.length; j++) {
          var s = input[j] < -1 ? -1 : input[j] > 1 ? 1 : input[j];
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        _ws.send(pcm.buffer);
      };

      source.connect(_processor);
      _processor.connect(ctx.destination);
      if (typeof onGranted === 'function') onGranted();
      console.log('[Realtime] Mic started');
    }).catch(function (err) {
      _micStarted = false;
      console.error('[Realtime] getUserMedia error:', err);
      if (typeof onDenied === 'function') onDenied(err);
      _fireError('Mic denied — ' + err.message);
    });
  }

  // ── Controls ───────────────────────────────────────────
  function setMuted(muted) {
    _isMuted = muted;
  }

  function setLang(lang) {
    localStorage.setItem('meetlingo_lang', lang);
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'lang_change', lang: lang }));
    }
  }

  function endMeeting() {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'meeting_end' }));
    }
  }

  function disconnect() {
    _closing = true;
    clearTimeout(_reconnectTimer);
    if (_processor)  { try { _processor.disconnect(); } catch(e){} }
    if (_stream)     _stream.getTracks().forEach(function (t) { t.stop(); });
    if (_audioCtx)   { try { _audioCtx.close(); } catch(e){} }
    if (_ws)         _ws.close();
    _micStarted = false;
  }

  function setVolume(vol) {
    var v = vol > 1 ? Math.round(vol) : Math.round(vol * 100);
    localStorage.setItem('meetlingo_volume', String(v));
  }

  function isMuted() { return _isMuted; }

  function _fireError(msg) {
    console.error('[Realtime]', msg);
    if (typeof window.onMLError === 'function') window.onMLError(msg);
  }

  // ── Public API ─────────────────────────────────────────
  window.MeetLingoRealtime = {
    connect:     connect,
    startMic:    startMic,
    setMuted:    setMuted,
    setLang:     setLang,
    endMeeting:  endMeeting,
    disconnect:  disconnect,
    setVolume:   setVolume,
    isMuted:     isMuted
  };

  console.log('[Realtime] realtime.js loaded ✓');
})();
