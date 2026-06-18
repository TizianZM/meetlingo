// MeetLingo Waveform — animated bar visualizer using AnalyserNode
(function () {
  'use strict';

  var _rafHandles = {}; // canvas id → requestAnimationFrame handle

  function start(canvas, analyser, color) {
    if (!canvas || !analyser) return;
    var id = canvas.id || ('wf_' + Math.random().toString(36).slice(2));
    if (!canvas.id) canvas.id = id;

    stop(canvas);

    var ctx    = canvas.getContext('2d');
    var data   = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      _rafHandles[id] = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);

      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      var barCount = 32;
      var barW     = Math.floor(w / barCount) - 1;
      var step     = Math.floor(data.length / barCount);

      for (var i = 0; i < barCount; i++) {
        var value  = data[i * step] / 255;
        var barH   = Math.max(2, value * h);
        var x      = i * (barW + 1);
        var y      = (h - barH) / 2;

        var alpha = 0.4 + value * 0.6;
        ctx.fillStyle = hexToRgba(color, alpha);
        ctx.beginPath();
        roundRect(ctx, x, y, barW, barH, 2);
        ctx.fill();
      }
    }

    draw();
  }

  function stop(canvas) {
    if (!canvas || !canvas.id) return;
    var id = canvas.id;
    if (_rafHandles[id]) {
      cancelAnimationFrame(_rafHandles[id]);
      delete _rafHandles[id];
    }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Stop animating and draw a flat, dim baseline — the "muted / no signal"
  // state, so a muted mic doesn't keep visually bouncing with the live input.
  function flatline(canvas, color) {
    if (!canvas) return;
    stop(canvas);
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var barCount = 32;
    var barW = Math.floor(w / barCount) - 1;
    for (var i = 0; i < barCount; i++) {
      var x = i * (barW + 1);
      var y = (h - 2) / 2;
      ctx.fillStyle = hexToRgba(color || '#B8B8B8', 0.45);
      ctx.beginPath();
      roundRect(ctx, x, y, barW, 2, 1);
      ctx.fill();
    }
  }

  function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function(c){ return c+c; }).join('');
    var r = parseInt(hex.slice(0,2),16);
    var g = parseInt(hex.slice(2,4),16);
    var b = parseInt(hex.slice(4,6),16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(2) + ')';
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (w < 2*r) r = w/2;
    if (h < 2*r) r = h/2;
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y,   x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x,   y+h, r);
    ctx.arcTo(x,   y+h, x,   y,   r);
    ctx.arcTo(x,   y,   x+w, y,   r);
    ctx.closePath();
  }

  window.MeetLingoWaveform = { start: start, stop: stop, flatline: flatline };
  console.log('[Waveform] waveform.js loaded ✓');
})();
