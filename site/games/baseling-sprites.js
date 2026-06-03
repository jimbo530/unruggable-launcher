// Baseling Sprite Renderer for MfT Arcade Games
// Loads character PNGs, applies color variant tinting, caches at multiple sizes.
// v1.0 — Pure Canvas2D, no dependencies.

(function() {
"use strict";

var SPRITE_BASE = '/api/baseling/images/';

// Color variants — ported from Baselings/game/src/sprites.js:1112-1122
var COLOR_VARIANTS = {
  normal:   null,
  rose:     'rgba(255,100,140,0.22)',
  ice:      'rgba(100,180,255,0.22)',
  gold:     'rgba(255,210,60,0.25)',
  shadow:   'rgba(60,40,80,0.20)',
  mint:     'rgba(80,230,180,0.22)',
  ember:    'rgba(255,80,30,0.20)',
  lavender: 'rgba(180,120,255,0.22)',
  rainbow:  'rainbow'
};

// Characters that never get color tints
var NO_TINT = [
  'apple-tree','pear-tree','orange-tree','plum-tree',
  'oak','earth','bear-brown','brown-bunny','beaver','groundhog','monkey'
];

// Caches
var _rawImages = {};   // charId -> Image (original loaded)
var _processed = {};   // charId -> Canvas (background removed, centered)
var _tintCache = {};   // charId+variant -> Canvas (tinted)
var _sizeCache = {};   // charId+variant+size -> Canvas (scaled)
var _loading = {};     // charId -> true (in-flight)

// ---- Background removal (simplified from sprites.js:1164-1249) ----
function processSprite(img) {
  var tc = document.createElement('canvas'); tc.width = img.width; tc.height = img.height;
  var ts = tc.getContext('2d'); ts.drawImage(img, 0, 0);
  var id = ts.getImageData(0, 0, tc.width, tc.height), d = id.data;
  var w = tc.width, h = tc.height;

  // Check if image already has transparency (skip processing if so)
  var hasAlpha = false;
  for (var ai = 0; ai < d.length; ai += 4) {
    if (d[ai + 3] < 200) { hasAlpha = true; break; }
  }
  if (hasAlpha) {
    // Already has transparency — just find bounds and center
    return centerSprite(tc, d, w, h);
  }

  // Auto-detect BG color from corner pixels
  var corners = [[0,0],[w-1,0],[0,h-1],[w-1,h-1],[1,0],[w-2,0],[0,1],[w-1,1]];
  var bgR = 0, bgG = 0, bgB = 0, cs = 0;
  for (var ci = 0; ci < corners.length; ci++) {
    var pi2 = (corners[ci][1] * w + corners[ci][0]) * 4;
    if (d[pi2 + 3] > 128) { bgR += d[pi2]; bgG += d[pi2 + 1]; bgB += d[pi2 + 2]; cs++; }
  }
  if (cs > 0) { bgR = bgR / cs; bgG = bgG / cs; bgB = bgB / cs; }

  var bgBright = Math.sqrt(bgR * bgR + bgG * bgG + bgB * bgB);
  var colorDist = bgBright < 30 ? 25 : bgBright < 80 ? 40 : 55;
  function isBgColor(idx) {
    var dr = d[idx] - bgR, dg = d[idx + 1] - bgG, db = d[idx + 2] - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db) < colorDist;
  }

  // Flood-fill from edges
  var bg = new Uint8Array(w * h);
  var queue = [];
  for (var x = 0; x < w; x++) {
    if (isBgColor(x * 4)) { bg[x] = 1; queue.push(x); }
    var bi = (h - 1) * w + x;
    if (isBgColor(bi * 4)) { bg[bi] = 1; queue.push(bi); }
  }
  for (var y = 1; y < h - 1; y++) {
    var li = y * w;
    if (isBgColor(li * 4)) { bg[li] = 1; queue.push(li); }
    var ri = y * w + w - 1;
    if (isBgColor(ri * 4)) { bg[ri] = 1; queue.push(ri); }
  }
  var qi = 0;
  while (qi < queue.length) {
    var pi = queue[qi++];
    var px = pi % w, py = (pi - px) / w;
    var nb = [[px - 1, py],[px + 1, py],[px, py - 1],[px, py + 1]];
    for (var n = 0; n < 4; n++) {
      var nx = nb[n][0], ny = nb[n][1];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      var ni = ny * w + nx;
      if (bg[ni]) continue;
      if (isBgColor(ni * 4)) { bg[ni] = 1; queue.push(ni); }
    }
  }

  // Remove BG pixels, feather edges
  for (var i = 0; i < w * h; i++) {
    if (bg[i]) { d[i * 4 + 3] = 0; continue; }
    var ix = i % w, iy = (i - ix) / w;
    var nearBg = (ix > 0 && bg[i - 1]) || (ix < w - 1 && bg[i + 1]) ||
                 (iy > 0 && bg[i - w]) || (iy < h - 1 && bg[i + w]);
    if (nearBg) {
      var dr = d[i * 4] - bgR, dg = d[i * 4 + 1] - bgG, db = d[i * 4 + 2] - bgB;
      var dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist < colorDist * 1.5) d[i * 4 + 3] = Math.round(Math.min(1, dist / colorDist) * d[i * 4 + 3]);
    }
  }
  ts.putImageData(id, 0, 0);

  // Re-read after BG removal for bounds
  id = ts.getImageData(0, 0, tc.width, tc.height); d = id.data;
  return centerSprite(tc, d, w, h);
}

// Find bounding box, center content in a square canvas with padding
function centerSprite(tc, d, w, h) {
  var minX = w, minY = h, maxX = 0, maxY = 0;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return tc; // empty image
  var SIZE = 256; // standard intermediate size
  var c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
  var s = c.getContext('2d');
  var cw = maxX - minX + 1, ch = maxY - minY + 1;
  var pad = 8, avail = SIZE - pad * 2;
  var scale = Math.min(avail / cw, avail / ch);
  var dw = Math.round(cw * scale), dh = Math.round(ch * scale);
  var dx = Math.round((SIZE - dw) / 2), dy = Math.round((SIZE - dh) / 2);
  s.drawImage(tc, minX, minY, cw, ch, dx, dy, dw, dh);
  return c;
}

// ---- Tinting (ported from render.js:570-595) ----
function applyTint(spriteCanvas, tint) {
  if (!tint || tint === 'rainbow') return spriteCanvas;
  var key = (spriteCanvas._bid || '') + tint;
  if (_tintCache[key]) return _tintCache[key];

  var c = document.createElement('canvas'); c.width = spriteCanvas.width; c.height = spriteCanvas.height;
  var s = c.getContext('2d'); s.drawImage(spriteCanvas, 0, 0);
  var m = tint.match(/rgba?\((\d+),(\d+),(\d+),([\d.]+)\)/);
  if (m) {
    var tr = +m[1], tg = +m[2], tb = +m[3], ta = +m[4];
    var id = s.getImageData(0, 0, c.width, c.height), d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) continue;
      var bright = Math.max(d[i], d[i + 1], d[i + 2]);
      if (bright < 60) continue; // preserve eyes, outlines, dark features
      var f = ta * (bright / 255);
      d[i]     = Math.round(d[i]     * (1 - f) + tr * f);
      d[i + 1] = Math.round(d[i + 1] * (1 - f) + tg * f);
      d[i + 2] = Math.round(d[i + 2] * (1 - f) + tb * f);
    }
    s.putImageData(id, 0, 0);
  }
  c._bid = (spriteCanvas._bid || '') + '_' + tint.slice(0, 10);
  _tintCache[key] = c;
  return c;
}

// Get the tint string for a variant ID
function getTint(charId, variant) {
  if (!variant || variant === 'normal') return null;
  if (NO_TINT.indexOf(charId) >= 0) return null;
  return COLOR_VARIANTS[variant] || null;
}

// ---- Scaling ----
function getScaled(source, size) {
  var key = (source._bid || 'src') + '_' + size;
  if (_sizeCache[key]) return _sizeCache[key];

  var c = document.createElement('canvas'); c.width = size; c.height = size;
  var s = c.getContext('2d');
  // Pixel-crisp for small sizes (NES aesthetic), smooth for larger
  s.imageSmoothingEnabled = size > 48;
  s.drawImage(source, 0, 0, size, size);
  c._bid = key;
  _sizeCache[key] = c;
  return c;
}

// ---- Public API ----
window.BaselingSprites = {

  // Load a baseling's sprite image, process and cache it
  load: function(charId, colorVariant, callback) {
    if (_processed[charId]) {
      if (callback) callback(charId);
      return;
    }
    if (_loading[charId]) return; // already loading
    _loading[charId] = true;

    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      _rawImages[charId] = img;
      try {
        var processed = processSprite(img);
        processed._bid = charId;
        _processed[charId] = processed;

        // Pre-apply tint if variant provided
        var tint = getTint(charId, colorVariant);
        if (tint && tint !== 'rainbow') {
          applyTint(processed, tint);
        }
      } catch (e) {
        console.warn('[baseling-sprites] process failed for ' + charId + ':', e.message);
        // Use raw image as fallback
        var fb = document.createElement('canvas'); fb.width = 256; fb.height = 256;
        var fbs = fb.getContext('2d'); fbs.drawImage(img, 0, 0, 256, 256);
        fb._bid = charId;
        _processed[charId] = fb;
      }
      delete _loading[charId];
      if (callback) callback(charId);
    };
    img.onerror = function() {
      console.warn('[baseling-sprites] failed to load image for ' + charId);
      delete _loading[charId];
      if (callback) callback(null);
    };
    img.src = SPRITE_BASE + charId + '.png';
  },

  // Get a cached canvas at requested size
  getSprite: function(charId, colorVariant, size) {
    var base = _processed[charId];
    if (!base) return null;

    var tint = getTint(charId, colorVariant);
    var source = (tint && tint !== 'rainbow') ? applyTint(base, tint) : base;
    return getScaled(source, size);
  },

  // Draw sprite onto a game context
  // x,y = center position, size = diameter (square)
  // opts: { flipX, frame (for sparkle/rainbow anim), alpha }
  draw: function(ctx, charId, colorVariant, sparkle, x, y, size, opts) {
    var base = _processed[charId];
    if (!base) return false;
    opts = opts || {};

    var tint = getTint(charId, colorVariant);
    var isRainbow = tint === 'rainbow';
    var source = (!isRainbow && tint) ? applyTint(base, tint) : base;
    var scaled = getScaled(source, Math.max(size, 8));

    ctx.save();
    ctx.translate(x, y);
    if (opts.flipX) ctx.scale(-1, 1);
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

    // Rainbow: cycle hue-rotate
    if (isRainbow) {
      var hue = ((opts.frame || 0) * 3) % 360;
      ctx.filter = 'hue-rotate(' + hue + 'deg)';
    }

    var half = size / 2;
    ctx.drawImage(scaled, -half, -half, size, size);
    ctx.filter = 'none';

    // Sparkle overlay
    if (sparkle) {
      var f = opts.frame || 0;
      var sparkCount = 5;
      for (var si = 0; si < sparkCount; si++) {
        var angle = (f * 0.05 + si * (Math.PI * 2 / sparkCount));
        var radius = half * 0.7 + Math.sin(f * 0.08 + si) * half * 0.2;
        var sx = Math.cos(angle) * radius;
        var sy = Math.sin(angle) * radius;
        var sparkSize = 1.5 + Math.sin(f * 0.1 + si * 2) * 0.8;
        ctx.globalAlpha = 0.6 + Math.sin(f * 0.12 + si) * 0.3;
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(sx, sy, sparkSize, 0, Math.PI * 2);
        ctx.fill();
        // White core
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx, sy, sparkSize * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
    return true;
  },

  // Check if a character's sprite is loaded and ready
  isLoaded: function(charId) {
    return !!_processed[charId];
  },

  // Set custom base URL (for testing or different environments)
  setBase: function(url) {
    SPRITE_BASE = url;
  }
};

})();
