window.RyanBeachdayFx = (function () {
  var PIXEL = 3;
  var canvas, ctx, flash, container;
  var running = false;
  var explosions = [];

  var HOT_CORE = [255, 255, 225];
  var HOT_MID = [255, 165, 30];
  var HOT_RIM = [235, 55, 10];
  var EMBER_COLOR = [235, 90, 15];
  var ASH_COLOR = [205, 202, 195];
  var SMOKE_COLOR = [120, 115, 110];

  var GROW_FRAMES = 5;
  var GROW_RADIUS_FRAC = [0.16, 0.34, 0.54, 0.76, 1.0];
  var BLOOM_FRAME = GROW_FRAMES + 1;
  var SMOKE_FRAME_COUNT = 6;
  var FRAME_COUNT = BLOOM_FRAME + SMOKE_FRAME_COUNT;

  var FRAME_DURATION = 130;
  var ONION_SKIN_COUNT = 2;
  var ONION_SKIN_ALPHA = [0.32, 0.14];

  var COVER_MS = 200;
  var HOLD_MS = 120;
  var DISSIPATE_MS = 750;
  var OVERSCAN = 0.12;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function mixColor(c1, c2, t) {
    return 'rgb(' +
      Math.round(lerp(c1[0], c2[0], t)) + ',' +
      Math.round(lerp(c1[1], c2[1], t)) + ',' +
      Math.round(lerp(c1[2], c2[2], t)) + ')';
  }

  function ensureLayers(targetContainer) {
    container = targetContainer;
    if (canvas) return;

    var overscanPct = (OVERSCAN * 100) + '%';
    var spanPct = (100 + OVERSCAN * 200) + '%';

    flash = document.createElement('div');
    flash.style.position = 'absolute';
    flash.style.top = '-' + overscanPct;
    flash.style.left = '-' + overscanPct;
    flash.style.width = spanPct;
    flash.style.height = spanPct;
    flash.style.zIndex = '9998';
    flash.style.background =
      'radial-gradient(circle, #fff4cc 0%, #ffb347 30%, #a83c10 65%, #1a0800 100%)';
    flash.style.opacity = '0';
    flash.style.pointerEvents = 'none';
    container.appendChild(flash);

    canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '-' + overscanPct;
    canvas.style.left = '-' + overscanPct;
    canvas.style.width = spanPct;
    canvas.style.height = spanPct;
    canvas.style.zIndex = '9999';
    canvas.style.pointerEvents = 'none';
    canvas.style.imageRendering = 'pixelated';
    container.appendChild(canvas);

    ctx = canvas.getContext('2d');
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
  }

  function sizeCanvas() {
    if (!container) return;
    var rect = container.getBoundingClientRect();
    var w = rect.width * (1 + OVERSCAN * 2);
    var h = rect.height * (1 + OVERSCAN * 2);
    canvas.width = Math.max(1, Math.ceil(w / PIXEL));
    canvas.height = Math.max(1, Math.ceil(h / PIXEL));
    ctx.imageSmoothingEnabled = false;
  }

  function spawnFireball(xCss, yCss, scale) {
    var x = xCss / PIXEL;
    var y = yCss / PIXEL;
    var maxRadius = 9 * scale;
    var cellCount = Math.round(110 * Math.max(scale, 0.55));
    var cells = [];

    for (var i = 0; i < cellCount; i++) {
      var angle = Math.random() * Math.PI * 2;
      var distNorm = Math.pow(Math.random(), 0.55);
      var dist = distNorm * maxRadius;
      var driftAngle = angle + (Math.random() - 0.5) * 0.6;
      cells.push({
        ox: x + Math.cos(angle) * dist,
        oy: y + Math.sin(angle) * dist,
        distNorm: distNorm,
        size: Math.max(1, Math.round((1.3 + Math.random() * 1.5) * scale)),
        driftX: Math.cos(driftAngle) * scale,
        driftY: Math.sin(driftAngle) * scale - 0.15 * scale,
        surviveBloom: Math.random(),
        surviveRand: Math.random(),
        fate: Math.random() < 0.62 ? EMBER_COLOR : (Math.random() < 0.5 ? ASH_COLOR : SMOKE_COLOR)
      });
    }

    explosions.push({ cells: cells, start: performance.now() });

    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  }

  function cellState(c, frame) {
    if (frame < 1 || frame > FRAME_COUNT) return null;

    if (frame <= GROW_FRAMES) {
      if (c.distNorm > GROW_RADIUS_FRAC[frame - 1]) return null;
      var growColor = mixColor(mixColor(HOT_CORE, HOT_MID, Math.min(1, c.distNorm * 1.6)), HOT_RIM, c.distNorm);
      return { px: c.ox, py: c.oy, size: c.size, alpha: 1, color: growColor };
    }

    if (frame === BLOOM_FRAME) {
      if (c.surviveBloom < 0.06) return null;
      var bloomColor = mixColor(HOT_MID, HOT_RIM, c.distNorm * 0.7);
      return { px: c.ox, py: c.oy, size: c.size, alpha: 1, color: bloomColor };
    }

    var smokeIdx = frame - BLOOM_FRAME;
    if (c.surviveRand < smokeIdx * 0.08) return null;

    var driftMag = smokeIdx * smokeIdx * 0.55;
    var px = c.ox + c.driftX * driftMag;
    var py = c.oy + c.driftY * driftMag;
    var size = smokeIdx <= 2 ? Math.max(c.size, 2) : Math.max(1, c.size - 1);
    var fadeRate = (c.fate === EMBER_COLOR ? 0.6 : 1) / SMOKE_FRAME_COUNT;
    var alpha = Math.max(0, 1 - (smokeIdx - 1) * fadeRate);
    var color = 'rgb(' + c.fate.join(',') + ')';
    return { px: px, py: py, size: size, alpha: alpha, color: color };
  }

  function drawFrame(ex, frame, alphaMul) {
    ex.cells.forEach(function (c) {
      var st = cellState(c, frame);
      if (!st) return;
      ctx.fillStyle = st.color;
      ctx.globalAlpha = st.alpha * alphaMul;
      ctx.fillRect(Math.round(st.px), Math.round(st.py), st.size, st.size);
    });
  }

  function tick() {
    var now = performance.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (var i = explosions.length - 1; i >= 0; i--) {
      var ex = explosions[i];
      var frame = Math.floor((now - ex.start) / FRAME_DURATION) + 1;
      if (frame > FRAME_COUNT + ONION_SKIN_COUNT) { explosions.splice(i, 1); continue; }

      for (var k = ONION_SKIN_COUNT; k >= 1; k--) {
        drawFrame(ex, frame - k, ONION_SKIN_ALPHA[k - 1]);
      }
      drawFrame(ex, frame, 1);
    }

    ctx.globalAlpha = 1;

    if (explosions.length > 0) {
      requestAnimationFrame(tick);
    } else {
      running = false;
    }
  }

  /**
   * Plays an explosion transition confined to `targetContainer`: flashes it
   * to a solid fiery cover, invokes `callback` while fully covered (so a
   * content swap happens hidden behind it), then dissipates back to reveal
   * whatever is now underneath, with embers drifting on top as it clears.
   */
  function burst(targetContainer, callback) {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      if (callback) callback();
      return;
    }

    ensureLayers(targetContainer);
    sizeCanvas();

    var rect = targetContainer.getBoundingClientRect();
    spawnFireball(rect.width * (OVERSCAN + 0.5), rect.height * (OVERSCAN + 0.5), 8);

    targetContainer.classList.add('shake');
    setTimeout(function () {
      targetContainer.classList.remove('shake');
    }, 400);

    flash.style.transition = 'opacity ' + COVER_MS + 'ms ease';
    requestAnimationFrame(function () {
      flash.style.opacity = '1';
    });

    setTimeout(function () {
      if (callback) callback();
      flash.style.transition = 'opacity ' + DISSIPATE_MS + 'ms ease';
      flash.style.opacity = '0';
    }, COVER_MS + HOLD_MS);
  }

  return { burst: burst };
})();
