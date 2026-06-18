// MeetLingo Realtime — WebSocket speech-to-speech translation client (bidirectional)
(function () {
  'use strict';

  var _ws             = null;
  var _audioCtx       = null;
  var _stream         = null;
  var _processor      = null;
  var _isMuted        = true;
  var _micStarted     = false;
  var _closing        = false;
  var _reconnectTimer = null;
  var _myId           = null;

  // AnalyserNodes for waveform visualization
  var _inputAnalyser  = null;
  var _outputAnalyser = null;

  // Gapless audio scheduling
  var _nextPlayAt         = 0;
  var _MAX_BUFFER_AHEAD   = 3.0;
  var _activeSources      = []; // scheduled-but-unfinished BufferSources (stopped on lang change)

  // ── AudioContext (lazy) ────────────────────────────────
  function _getAudioCtx() {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx   = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      _nextPlayAt = 0;
      _outputAnalyser = _audioCtx.createAnalyser();
      _outputAnalyser.fftSize = 256;
      _outputAnalyser.connect(_audioCtx.destination);
      // Mic activation (getUserMedia) reroutes audio and can knock the
      // context into 'interrupted'/'suspended' — auto-recover, otherwise
      // playback dies the moment a participant unmutes.
      _audioCtx.onstatechange = function () {
        if (_audioCtx && _audioCtx.state !== 'running' && _audioCtx.state !== 'closed') {
          _audioCtx.resume().catch(function () {});
        }
      };
    }
    return _audioCtx;
  }

  function _needsResume(ctx) {
    return ctx.state === 'suspended' || ctx.state === 'interrupted';
  }

  // ── Gapless playback ────────────────────────────────────
  function _scheduleChunk(b64) {
    var ctx = _getAudioCtx();
    try {
      var binary = atob(b64);
      var bytes  = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      // Server sends PCM16 mono 24kHz wrapped in WAV. decodeAudioData (meant for
      // compressed formats) is async + CPU-heavy per chunk → stutters on phones.
      // Build the AudioBuffer directly from the PCM samples — synchronous & cheap.
      var buf = _pcmWavToBuffer(ctx, bytes);
      if (buf) {
        var doSchedule = function () {
          try {
            if (_nextPlayAt < ctx.currentTime) _nextPlayAt = ctx.currentTime + 0.05;
            if (_nextPlayAt > ctx.currentTime + _MAX_BUFFER_AHEAD) {
              console.log('[Realtime] Buffer full, dropping chunk');
              _nextPlayAt = ctx.currentTime + 0.1;
              return;
            }
            var src  = ctx.createBufferSource();
            var gain = ctx.createGain();
            var vol  = parseFloat(localStorage.getItem('meetlingo_volume') || '50');
            if (vol > 1) vol = vol / 100;
            gain.gain.value = vol;
            src.buffer = buf;
            src.connect(gain);
            // Route through output analyser for waveform
            gain.connect(_outputAnalyser);
            src.onended = function () {
              var idx = _activeSources.indexOf(src);
              if (idx !== -1) _activeSources.splice(idx, 1);
            };
            _activeSources.push(src);
            src.start(_nextPlayAt);
            _nextPlayAt += buf.duration;
          } catch (e) { console.error('[Realtime] Schedule error:', e); }
        };
        if (_needsResume(ctx)) {
          ctx.resume().then(doSchedule).catch(function (e) {
            console.error('[Realtime] ctx.resume failed:', e);
          });
        } else {
          doSchedule();
        }
      }
    } catch (e) {
      console.error('[Realtime] Chunk decode setup error:', e);
    }
  }

  // Parse a PCM16 mono WAV (our server's fixed 44-byte-header format, 24kHz) into
  // an AudioBuffer without decodeAudioData. Falls back gracefully if the bytes
  // aren't the expected WAV layout. Buffer is created at the data's real rate
  // (24000) — the context resamples on playback if its own rate differs.
  function _pcmWavToBuffer(ctx, bytes) {
    try {
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var dataOffset = 44, sampleRate = 24000;
      // Verify RIFF/WAVE; read sampleRate + locate 'data' chunk for robustness.
      if (bytes.length > 44 &&
          bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        sampleRate = dv.getUint32(24, true) || 24000;
        // scan for 'data' subchunk (usually at 36)
        var off = 12;
        while (off + 8 <= bytes.length) {
          var id = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
          var sz = dv.getUint32(off + 4, true);
          if (id === 'data') { dataOffset = off + 8; break; }
          off += 8 + sz;
        }
      }
      var nSamples = (bytes.length - dataOffset) >> 1;
      if (nSamples <= 0) return null;
      var buf = ctx.createBuffer(1, nSamples, sampleRate);
      var ch  = buf.getChannelData(0);
      for (var i = 0; i < nSamples; i++) {
        ch[i] = dv.getInt16(dataOffset + i * 2, true) / 32768;
      }
      return buf;
    } catch (e) {
      console.error('[Realtime] PCM parse error:', e);
      return null;
    }
  }

  // Unlock audio for Safari autoplay policy
  function unlockAudio() {
    var ctx = _getAudioCtx();
    if (_needsResume(ctx)) {
      ctx.resume().then(function () {
        var buf = ctx.createBuffer(1, 1, ctx.sampleRate);
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        console.log('[Realtime] Audio unlocked, ctx state:', ctx.state);
      }).catch(function (e) {
        console.warn('[Realtime] unlock failed:', e);
      });
    }
  }

  // ── WebSocket connection ───────────────────────────────
  function connect() {
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
    _closing = false;

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url   = proto + '//' + location.host + '/ws/meeting';
    var role  = window.ML_HOST_MODE ? 'host' : 'listener';

    try {
      _ws = new WebSocket(url);
    } catch (e) {
      _fireError('WebSocket init failed: ' + e.message);
      return;
    }

    _ws.onopen = function () {
      // Read lang/name at open-time so any pre-connect UI changes (name input, lang select) are captured.
      // Host uses its own key so the spoken language never contaminates listener prefs in the same browser.
      var lang = localStorage.getItem(_langKey()) || 'English';
      var name = localStorage.getItem(_nameKey()) || '';
      var room = localStorage.getItem('meetlingo_room') || '';
      console.log('[Realtime] WS connected');
      clearTimeout(_reconnectTimer);
      var payload = { type: 'join', lang: lang, role: role, name: name, room: room };
      // Host proves its identity with the secret token issued at room creation;
      // without a matching token the server downgrades it to a listener.
      if (role === 'host') payload.hostToken = localStorage.getItem('meetlingo_host_token') || '';
      _ws.send(JSON.stringify(payload));
    };

    _ws.onmessage = function (evt) {
      try {
        var msg = JSON.parse(evt.data);

        if (msg.type === 'joined') {
          _myId = msg.id;
          if (typeof window.onMLConnected === 'function') window.onMLConnected(msg);
        }
        else if (msg.type === 'room_not_found') {
          _closing = true;                 // don't auto-reconnect into a dead room
          if (typeof window.onMLRoomNotFound === 'function') window.onMLRoomNotFound();
        }
        else if (msg.type === 'audio') {
          _scheduleChunk(msg.audio);
        }
        else if (msg.type === 'transcript') {
          if (typeof window.onMLTranscript === 'function') {
            window.onMLTranscript(msg.text, msg.speakerId, msg.name, msg.sourceLang);
          }
        }
        else if (msg.type === 'source_transcript') {
          if (typeof window.onMLSourceTranscript === 'function') {
            window.onMLSourceTranscript(msg.text, msg.name, msg.lang, msg.speakerId);
          }
        }
        else if (msg.type === 'speaker_active') {
          if (typeof window.onMLSpeakerActive === 'function') {
            window.onMLSpeakerActive(msg.id, msg.name, msg.lang);
          }
        }
        else if (msg.type === 'speaker_inactive') {
          if (typeof window.onMLSpeakerInactive === 'function') {
            window.onMLSpeakerInactive(msg.id);
          }
        }
        else if (msg.type === 'participant_list') {
          if (typeof window.onMLParticipants === 'function') {
            window.onMLParticipants(msg.participants);
          }
        }
        else if (msg.type === 'participant_left') {
          if (typeof window.onMLParticipantLeft === 'function') {
            window.onMLParticipantLeft(msg.id);
          }
        }
        else if (msg.type === 'agenda_update') {
          if (typeof window.onMLAgendaUpdate === 'function') window.onMLAgendaUpdate(msg.agenda);
        }
        else if (msg.type === 'meeting_ended') {
          if (typeof window.onMLMeetingEnded === 'function') window.onMLMeetingEnded();
        }
        else if (msg.type === 'meeting_started') {
          if (typeof window.onMLMeetingStarted === 'function') window.onMLMeetingStarted();
        }
        else if (msg.type === 'error') {
          _fireError(msg.message || 'Translation error');
        }
      } catch (e) {
        console.error('[Realtime] Message parse error:', e);
      }
    };

    _ws.onerror = function () { _fireError('WebSocket connection error'); };

    _ws.onclose = function (evt) {
      console.log('[Realtime] WS closed:', evt.code);
      if (!_closing) {
        _reconnectTimer = setTimeout(function () {
          if (!_closing) connect();
        }, 3000);
      }
    };
  }

  // ── Mic capture ─────────────────────────────────────────
  function startMic(onGranted, onDenied) {
    if (_micStarted) { if (typeof onGranted === 'function') onGranted(); return; }
    _micStarted = true;

    // Create + resume AudioContext synchronously here — still inside the user-gesture call stack.
    // Safari requires AudioContext creation/resume to happen synchronously from a user gesture.
    // If we wait until the getUserMedia .then() callback, the gesture is gone and resume() fails.
    var ctx = _getAudioCtx();
    if (_needsResume(ctx)) {
      ctx.resume().catch(function (e) { console.warn('[Realtime] resume failed:', e); });
    }

    navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function (stream) {
      _stream = stream;
      // ctx is already created and running from the synchronous call above
      ctx = _getAudioCtx();
      var source = ctx.createMediaStreamSource(stream);

      // Input analyser for waveform visualization
      _inputAnalyser = ctx.createAnalyser();
      _inputAnalyser.fftSize = 256;
      source.connect(_inputAnalyser);

      _processor = ctx.createScriptProcessor(4096, 1, 1);

      // Older browsers ignore the AudioContext sampleRate option — if the
      // context runs at e.g. 44.1/48kHz we must resample to the 24kHz the
      // server labels the PCM with, or OpenAI receives slow-motion audio.
      var _needsResample = ctx.sampleRate !== 24000;
      var _resampleRatio = ctx.sampleRate / 24000;
      if (_needsResample) console.warn('[Realtime] ctx at ' + ctx.sampleRate + 'Hz, resampling to 24kHz');

      _processor.onaudioprocess = function (e) {
        if (_isMuted) return;
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;

        var input = e.inputBuffer.getChannelData(0);
        var vol = 0;
        for (var i = 0; i < input.length; i++) { var a = Math.abs(input[i]); if (a > vol) vol = a; }

        if (vol > 0.01 && typeof window.onMLAudioActivity === 'function') {
          window.onMLAudioActivity(vol);
        }

        if (_needsResample) {
          var outLen = Math.floor(input.length / _resampleRatio);
          var resampled = new Float32Array(outLen);
          for (var k = 0; k < outLen; k++) {
            var pos  = k * _resampleRatio;
            var i0   = Math.floor(pos);
            var i1   = Math.min(i0 + 1, input.length - 1);
            var frac = pos - i0;
            resampled[k] = input[i0] * (1 - frac) + input[i1] * frac;
          }
          input = resampled;
        }

        // Float32 → PCM16 with 2x gain
        var pcm = new Int16Array(input.length);
        for (var j = 0; j < input.length; j++) {
          var s = input[j] * 2;
          s = s < -1 ? -1 : s > 1 ? 1 : s;
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        _ws.send(pcm.buffer);
      };

      source.connect(_processor);
      // Silence gate: processor must be connected to destination (Web Audio API req)
      var silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      _processor.connect(silentGain);
      silentGain.connect(ctx.destination);

      // Mic activation may have rerouted audio and stalled the context —
      // resume so playback of incoming translations keeps running
      if (_needsResume(ctx)) {
        ctx.resume().catch(function () {});
      }

      if (typeof onGranted === 'function') onGranted();
      console.log('[Realtime] Mic started');
    }).catch(function (err) {
      _micStarted = false;
      console.error('[Realtime] getUserMedia error:', err);
      if (typeof onDenied === 'function') onDenied(err);
      _fireError('Mic denied — ' + err.message);
    });
  }

  // ── Controls ────────────────────────────────────────────
  function setMuted(muted) { _isMuted = muted; }
  function isMuted()       { return _isMuted; }

  function _langKey() {
    return window.ML_HOST_MODE ? 'meetlingo_host_lang' : 'meetlingo_lang';
  }

  // Separate host vs listener name so the two roles don't overwrite each other's
  // identity when the same browser is used for both (mirrors _langKey).
  function _nameKey() {
    return window.ML_HOST_MODE ? 'meetlingo_host_name' : 'meetlingo_name';
  }

  function setLang(lang) {
    localStorage.setItem(_langKey(), lang);
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'lang_change', lang: lang }));
    }
    // Stop already-scheduled audio so the old language doesn't overlap the new one
    _activeSources.forEach(function (src) { try { src.stop(); } catch (e) {} });
    _activeSources = [];
    _nextPlayAt = 0;
  }

  function setName(name) {
    localStorage.setItem(_nameKey(), name);
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'name_change', name: name }));
    }
  }

  function endMeeting() {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'meeting_end' }));
    }
  }

  function muteParticipant(targetId) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'mute_participant', targetId: targetId }));
    }
  }

  function disconnect() {
    _closing = true;
    clearTimeout(_reconnectTimer);
    if (_processor) { try { _processor.disconnect(); } catch(e){} }
    if (_stream)    _stream.getTracks().forEach(function (t) { t.stop(); });
    if (_audioCtx)  { try { _audioCtx.close(); } catch(e){} _audioCtx = null; }
    if (_ws)        _ws.close();
    _micStarted     = false;
    _nextPlayAt     = 0;
    _activeSources  = [];
    _inputAnalyser  = null;
    _outputAnalyser = null;
  }

  function setVolume(vol) {
    var v = vol > 1 ? Math.round(vol) : Math.round(vol * 100);
    localStorage.setItem('meetlingo_volume', String(v));
  }

  function getInputAnalyser()  { return _inputAnalyser; }
  function getOutputAnalyser() {
    _getAudioCtx(); // ensure it exists
    return _outputAnalyser;
  }
  function getMyId() { return _myId; }

  function _fireError(msg) {
    console.error('[Realtime]', msg);
    if (typeof window.onMLError === 'function') window.onMLError(msg);
  }

  // ── Public API ──────────────────────────────────────────
  window.MeetLingoRealtime = {
    connect:          connect,
    startMic:         startMic,
    setMuted:         setMuted,
    isMuted:          isMuted,
    setLang:          setLang,
    setName:          setName,
    endMeeting:       endMeeting,
    muteParticipant:  muteParticipant,
    disconnect:       disconnect,
    setVolume:        setVolume,
    unlockAudio:      unlockAudio,
    getInputAnalyser: getInputAnalyser,
    getOutputAnalyser:getOutputAnalyser,
    getMyId:          getMyId
  };

  console.log('[Realtime] realtime.js loaded ✓');
})();
