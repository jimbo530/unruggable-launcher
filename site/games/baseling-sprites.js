// Baseling Sprite Renderer for MfT Arcade Games
// Loads character PNGs, removes background, pixelizes (nearest-neighbor grid +
// palette quantization + 1px outline), tints color variants, generates procedural
// animation frames, and caches everything. Pure Canvas2D, no dependencies.
//
// v2.0 — pixel-art pipeline + animation frames.
//   - processSprite():   background removal + center (from v1)
//   - pixelize():        NEW. nearest-neighbor downscale to a pixel grid, quantize
//                        to ~16 colors, add 1px dark outline. Makes mushy source
//                        PNGs read as authentic pixel sprites.
//   - frame(): NEW. procedural idle/walk/jump/attack/hurt/ko frames from one static
//                        sprite, cached per (char+variant+anim+frameIndex+size).
//   - draw():            v1 signature preserved; now renders the pixelized sprite and
//                        accepts opts.anim / opts.frameIndex for animation.
//
// BACKWARDS COMPAT: load/getSprite/draw/isLoaded/setBase keep their v1 signatures.

(function() {
"use strict";

var SPRITE_BASE = '/api/baseling/images/';
var SPRITE_EXT  = '.png';

// Pixel grid the source is downscaled to before being scaled back up for display.
// Lower = chunkier pixels. 48 reads as crisp pixel art at typical 16-64px game sizes
// while keeping enough detail that 25 distinct characters stay recognizable.
var PIXEL_GRID = 48;
// Target palette size after quantization (per sprite, preserving its own colors).
var PALETTE_SIZE = 16;
// Outline color drawn 1px around the silhouette.
var OUTLINE_COLOR = [26, 26, 46]; // #1a1a2e

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

// Optional charId -> filename resolver (overrides default SPRITE_BASE + id + ext).
// Used by sprite-test.html to load local baby-*.png files.
var _resolver = null;

// Caches
var _rawImages = {};   // charId -> Image (original loaded)
var _processed = {};   // charId -> Canvas (background removed, centered, pixelized)
var _tintCache = {};   // charId+variant -> Canvas (tinted)
var _frameCache = {};  // charId+variant+anim+frameIndex+size -> Canvas (animated frame)
var _loading = {};     // charId -> [callbacks] (in-flight)
var _failed = {};      // charId -> true (load failed — don't retry, prevents per-frame spam)

// ---- Background removal (from v1 / sprites.js:1164-1249) ----
function processSprite(img) {
  var tc = document.createElement('canvas'); tc.width = img.width; tc.height = img.height;
  var ts = tc.getContext('2d'); ts.drawImage(img, 0, 0);
  var id = ts.getImageData(0, 0, tc.width, tc.height), d = id.data;
  var w = tc.width, h = tc.height;

  // Check if image already has transparency (skip BG removal if so)
  var hasAlpha = false;
  for (var ai = 0; ai < d.length; ai += 4) {
    if (d[ai + 3] < 200) { hasAlpha = true; break; }
  }
  if (hasAlpha) {
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

// Find bounding box, center content in a square canvas with padding.
// Crisp (no smoothing) so the subsequent pixelize stage gets hard edges.
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
  s.imageSmoothingEnabled = false;
  var cw = maxX - minX + 1, ch = maxY - minY + 1;
  var pad = 12, avail = SIZE - pad * 2;
  var scale = Math.min(avail / cw, avail / ch);
  var dw = Math.round(cw * scale), dh = Math.round(ch * scale);
  var dx = Math.round((SIZE - dw) / 2), dy = Math.round((SIZE - dh) / 2);
  s.drawImage(tc, minX, minY, cw, ch, dx, dy, dw, dh);
  return c;
}

// ---- Pixelization ----
// Turns a smooth processed sprite into authentic pixel art:
//  1. Nearest-neighbor downscale to a PIXEL_GRID x PIXEL_GRID grid (snap to pixels).
//  2. Quantize colors to ~PALETTE_SIZE buckets (median-cut-lite via coarse RGB
//     binning) so it reads as a limited pixel palette, preserving the sprite's hues.
//  3. Add a 1px dark outline around the silhouette.
// Output is rendered back at the intermediate 256 size (each grid cell = a block),
// so downstream scaling stays crisp.
function pixelize(src) {
  var grid = PIXEL_GRID;

  // Step 1: nearest-neighbor downscale to grid
  var small = document.createElement('canvas'); small.width = grid; small.height = grid;
  var ss = small.getContext('2d');
  ss.imageSmoothingEnabled = false;
  ss.clearRect(0, 0, grid, grid);
  ss.drawImage(src, 0, 0, src.width, src.height, 0, 0, grid, grid);

  var sid = ss.getImageData(0, 0, grid, grid), sd = sid.data;

  // Harden alpha: a pixel is either solid or empty (no semi-transparent fringe).
  // This gives clean pixel edges and a reliable silhouette for the outline pass.
  for (var p = 0; p < sd.length; p += 4) {
    sd[p + 3] = sd[p + 3] >= 110 ? 255 : 0;
  }

  // Step 2: palette quantization over the opaque pixels
  quantize(sd, PALETTE_SIZE);
  ss.putImageData(sid, 0, 0);

  // Step 3: 1px outline. Build a new grid one cell larger on each side so the
  // outline never clips, then mark empty cells adjacent to an opaque cell.
  var og = grid + 2;
  var out = document.createElement('canvas'); out.width = og; out.height = og;
  var os = out.getContext('2d');
  os.imageSmoothingEnabled = false;
  os.drawImage(small, 1, 1);

  var oid = os.getImageData(0, 0, og, og), od = oid.data;
  var solid = new Uint8Array(og * og);
  for (var q = 0; q < og * og; q++) solid[q] = od[q * 4 + 3] > 0 ? 1 : 0;

  for (var yy = 0; yy < og; yy++) {
    for (var xx = 0; xx < og; xx++) {
      var idx = yy * og + xx;
      if (solid[idx]) continue;
      var touch =
        (xx > 0 && solid[idx - 1]) ||
        (xx < og - 1 && solid[idx + 1]) ||
        (yy > 0 && solid[idx - og]) ||
        (yy < og - 1 && solid[idx + og]) ||
        (xx > 0 && yy > 0 && solid[idx - og - 1]) ||
        (xx < og - 1 && yy > 0 && solid[idx - og + 1]) ||
        (xx > 0 && yy < og - 1 && solid[idx + og - 1]) ||
        (xx < og - 1 && yy < og - 1 && solid[idx + og + 1]);
      if (touch) {
        od[idx * 4]     = OUTLINE_COLOR[0];
        od[idx * 4 + 1] = OUTLINE_COLOR[1];
        od[idx * 4 + 2] = OUTLINE_COLOR[2];
        od[idx * 4 + 3] = 255;
      }
    }
  }
  os.putImageData(oid, 0, 0);

  // Step 4: scale the (grid+2) pixel canvas back up to 256, nearest-neighbor,
  // so each grid cell becomes a clean block.
  var SIZE = 256;
  var big = document.createElement('canvas'); big.width = SIZE; big.height = SIZE;
  var bs = big.getContext('2d');
  bs.imageSmoothingEnabled = false;
  bs.drawImage(out, 0, 0, og, og, 0, 0, SIZE, SIZE);
  return big;
}

// Quantize RGBA pixel data in place to at most `maxColors` colors.
// Coarse approach: bin colors into a 4-bit-per-channel space, count populations,
// pick the most-populous bins as the palette, then snap every opaque pixel to the
// nearest chosen palette color. Cheap, deterministic, preserves the sprite's hues.
function quantize(data, maxColors) {
  var bins = {}; // key -> {r,g,b,count}
  var i;
  for (i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    // 4 bits/channel = 16 levels each
    var r = data[i] >> 4, g = data[i + 1] >> 4, b = data[i + 2] >> 4;
    var key = (r << 8) | (g << 4) | b;
    var bin = bins[key];
    if (bin) {
      bin.r += data[i]; bin.g += data[i + 1]; bin.b += data[i + 2]; bin.count++;
    } else {
      bins[key] = { r: data[i], g: data[i + 1], b: data[i + 2], count: 1 };
    }
  }

  // Build averaged colors per bin, sort by population
  var palette = [];
  for (var k in bins) {
    if (!bins.hasOwnProperty(k)) continue;
    var bn = bins[k];
    palette.push({ r: bn.r / bn.count, g: bn.g / bn.count, b: bn.b / bn.count, count: bn.count });
  }
  if (palette.length <= maxColors) return; // already within budget
  palette.sort(function(a, b2) { return b2.count - a.count; });
  palette = palette.slice(0, maxColors);

  // Snap each opaque pixel to nearest palette color
  for (i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    var pr = data[i], pg = data[i + 1], pb = data[i + 2];
    var best = 0, bestD = Infinity;
    for (var c = 0; c < palette.length; c++) {
      var dr = pr - palette[c].r, dg = pg - palette[c].g, db = pb - palette[c].b;
      var dd = dr * dr + dg * dg + db * db;
      if (dd < bestD) { bestD = dd; best = c; }
    }
    data[i]     = Math.round(palette[best].r);
    data[i + 1] = Math.round(palette[best].g);
    data[i + 2] = Math.round(palette[best].b);
  }
}

// ---- Tinting (ported from render.js:570-595) ----
function applyTint(spriteCanvas, tint) {
  if (!tint || tint === 'rainbow') return spriteCanvas;
  var key = (spriteCanvas._bid || '') + tint;
  if (_tintCache[key]) return _tintCache[key];

  var c = document.createElement('canvas'); c.width = spriteCanvas.width; c.height = spriteCanvas.height;
  var s = c.getContext('2d'); s.imageSmoothingEnabled = false; s.drawImage(spriteCanvas, 0, 0);
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

// Resolve the source canvas for a char+variant (pixelized base, tinted if needed).
function getSourceCanvas(charId, colorVariant) {
  var base = _processed[charId];
  if (!base) return null;
  var tint = getTint(charId, colorVariant);
  if (tint && tint !== 'rainbow') return applyTint(base, tint);
  return base;
}

// ---- Animation frame definitions ----
// Each anim has a frame count and a function producing a transform per frame.
// Transforms are applied to the pixelized base at draw time. Pixel art stays crisp
// because every transform is rendered with imageSmoothingEnabled = false.
//   t fields: sx, sy (scale), rot (radians), ox, oy (px offset, in display units of
//   `size`), flash (0-1 white overlay), gray (bool grayscale).
var ANIMS = {
  // 2-frame gentle vertical bob
  idle: { frames: 2, fn: function(f) {
    return { sx: 1, sy: 1, rot: 0, ox: 0, oy: f === 0 ? 0 : -0.04, flash: 0, gray: false };
  }},
  // 2-frame waddle: lean +/-5deg with a small vertical hop
  walk: { frames: 2, fn: function(f) {
    var dir = f === 0 ? 1 : -1;
    return { sx: 1, sy: 1, rot: dir * 0.0873, ox: 0, oy: -0.03, flash: 0, gray: false }; // 5deg
  }},
  // 3-frame jump: anticipate squash, launch stretch, neutral apex
  jump: { frames: 3, fn: function(f) {
    if (f === 0) return { sx: 1.2, sy: 0.85, rot: 0, ox: 0, oy: 0.05, flash: 0, gray: false };   // squash
    if (f === 1) return { sx: 0.85, sy: 1.2, rot: 0, ox: 0, oy: -0.10, flash: 0, gray: false };  // stretch up
    return { sx: 0.95, sy: 1.05, rot: 0, ox: 0, oy: -0.16, flash: 0, gray: false };              // apex
  }},
  // 2-frame attack: lunge forward 15% with a flash on the strike frame
  attack: { frames: 2, fn: function(f) {
    if (f === 0) return { sx: 1.05, sy: 0.97, rot: 0, ox: -0.06, oy: 0, flash: 0, gray: false };  // wind up
    return { sx: 1.1, sy: 0.95, rot: 0, ox: 0.15, oy: 0, flash: 0.45, gray: false };              // strike + flash
  }},
  // 2-frame hurt: white flash + horizontal shake
  hurt: { frames: 2, fn: function(f) {
    var dir = f === 0 ? 1 : -1;
    return { sx: 1, sy: 1, rot: 0, ox: dir * 0.06, oy: 0, flash: 0.7, gray: false };
  }},
  // 1-frame KO: grayscale, rotated 90deg (knocked over)
  ko: { frames: 1, fn: function() {
    return { sx: 1, sy: 1, rot: Math.PI / 2, ox: 0, oy: 0.1, flash: 0, gray: true };
  }}
};

function getAnimDef(anim) {
  return ANIMS[anim] || ANIMS.idle;
}

// Render a single animation frame to a `size` x `size` canvas (crisp pixel art).
// Returns null if the sprite isn't loaded yet.
function renderFrame(charId, colorVariant, anim, frameIndex, size, isRainbow) {
  var source = getSourceCanvas(charId, colorVariant);
  if (!source) return null;
  size = Math.max(8, Math.round(size));

  var def = getAnimDef(anim);
  var fi = ((frameIndex % def.frames) + def.frames) % def.frames;
  var t = def.fn(fi);

  var c = document.createElement('canvas'); c.width = size; c.height = size;
  var s = c.getContext('2d');
  s.imageSmoothingEnabled = false;

  s.save();
  s.translate(size / 2 + t.ox * size, size / 2 + t.oy * size);
  if (t.rot) s.rotate(t.rot);
  if (t.sx !== 1 || t.sy !== 1) s.scale(t.sx, t.sy);
  if (isRainbow) {
    var hue = ((frameIndex || 0) * 3) % 360;
    s.filter = 'hue-rotate(' + hue + 'deg)';
  }
  var half = size / 2;
  s.drawImage(source, -half, -half, size, size);
  s.filter = 'none';
  s.restore();

  // Post effects over the rendered pixels (grayscale then flash).
  if (t.gray || t.flash > 0) {
    var id = s.getImageData(0, 0, size, size), d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (t.gray) {
        var lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
        d[i] = d[i + 1] = d[i + 2] = lum;
      }
      if (t.flash > 0) {
        d[i]     = Math.round(d[i]     * (1 - t.flash) + 255 * t.flash);
        d[i + 1] = Math.round(d[i + 1] * (1 - t.flash) + 255 * t.flash);
        d[i + 2] = Math.round(d[i + 2] * (1 - t.flash) + 255 * t.flash);
      }
    }
    s.putImageData(id, 0, 0);
  }

  return c;
}

// ---- Public API ----
window.BaselingSprites = {

  // Load a baseling's sprite image, process + pixelize and cache it.
  // Signature unchanged from v1: load(charId, colorVariant, callback).
  load: function(charId, colorVariant, callback) {
    if (!charId) { if (callback) callback(null); return; }
    if (_processed[charId]) {
      if (callback) callback(charId);
      return;
    }
    if (_failed[charId]) {                   // previously failed — don't retry (no spam)
      if (callback) callback(null);
      return;
    }
    if (_loading[charId]) {                 // already loading — queue the callback
      if (callback) _loading[charId].push(callback);
      return;
    }
    _loading[charId] = callback ? [callback] : [];

    var img = new Image();
    img.crossOrigin = 'anonymous';
    var self = this;
    img.onload = function() {
      _rawImages[charId] = img;
      try {
        var processed = processSprite(img);
        var pixelized = pixelize(processed);
        pixelized._bid = charId;
        _processed[charId] = pixelized;

        // Pre-apply tint if variant provided
        var tint = getTint(charId, colorVariant);
        if (tint && tint !== 'rainbow') applyTint(pixelized, tint);
      } catch (e) {
        console.warn('[baseling-sprites] process failed for ' + charId + ':', e.message);
        // Fallback: pixelize the raw image directly so we never render mush.
        try {
          var fbProc = document.createElement('canvas'); fbProc.width = 256; fbProc.height = 256;
          var fbs = fbProc.getContext('2d'); fbs.imageSmoothingEnabled = false;
          fbs.drawImage(img, 0, 0, 256, 256);
          var fb = pixelize(fbProc);
          fb._bid = charId;
          _processed[charId] = fb;
        } catch (e2) {
          console.warn('[baseling-sprites] fallback pixelize failed for ' + charId + ':', e2.message);
        }
      }
      var cbs = _loading[charId] || [];
      delete _loading[charId];
      for (var i = 0; i < cbs.length; i++) { try { cbs[i](charId); } catch (e3) { console.warn('[baseling-sprites] load callback error:', e3.message); } }
    };
    img.onerror = function() {
      console.warn('[baseling-sprites] failed to load image for ' + charId + ' (' + img.src + ') — will not retry');
      _failed[charId] = true; // mark so load()/draw() stop retrying this charId
      var cbs = _loading[charId] || [];
      delete _loading[charId];
      for (var i = 0; i < cbs.length; i++) { try { cbs[i](null); } catch (e4) { console.warn('[baseling-sprites] load callback error:', e4.message); } }
    };
    img.src = _resolver ? _resolver(charId) : (SPRITE_BASE + charId + SPRITE_EXT);
  },

  // Get a cached static sprite canvas at requested size (idle frame 0).
  // Signature unchanged from v1.
  getSprite: function(charId, colorVariant, size) {
    if (!_processed[charId]) return null;
    return renderFrame(charId, colorVariant, 'idle', 0, size, getTint(charId, colorVariant) === 'rainbow');
  },

  // Get a cached animation frame canvas.
  // anim: 'idle' | 'walk' | 'jump' | 'attack' | 'hurt' | 'ko'
  // Returns null if the sprite isn't loaded.
  frame: function(charId, colorVariant, anim, frameIndex, size) {
    if (!_processed[charId]) return null;
    var isRainbow = getTint(charId, colorVariant) === 'rainbow';
    size = Math.max(8, Math.round(size || 32));
    frameIndex = frameIndex || 0;
    // Rainbow frames vary every index (hue cycles), so don't cache those.
    if (isRainbow) return renderFrame(charId, colorVariant, anim, frameIndex, size, true);
    var def = getAnimDef(anim);
    var fi = ((frameIndex % def.frames) + def.frames) % def.frames;
    var key = charId + '|' + (colorVariant || 'normal') + '|' + anim + '|' + fi + '|' + size;
    if (_frameCache[key]) return _frameCache[key];
    var c = renderFrame(charId, colorVariant, anim, fi, size, false);
    if (c) _frameCache[key] = c;
    return c;
  },

  // Number of frames in an animation (for stepping frameIndex).
  animFrameCount: function(anim) {
    return getAnimDef(anim).frames;
  },

  // Draw sprite onto a game context.
  // x,y = center position, size = diameter (square).
  // opts: { flipX, frame (anim clock / sparkle+rainbow phase), alpha,
  //         anim ('idle'|'walk'|'jump'|'attack'|'hurt'|'ko'), frameIndex }
  // BACKWARDS COMPAT: with no opts.anim, behaves like v1 (static idle) and still
  // honors flipX / alpha / frame (sparkle) / rainbow hue cycling.
  draw: function(ctx, charId, colorVariant, sparkle, x, y, size, opts) {
    if (!_processed[charId]) return false;
    opts = opts || {};
    size = Math.max(8, size);

    var isRainbow = getTint(charId, colorVariant) === 'rainbow';
    var anim = opts.anim || 'idle';
    // If a frameIndex isn't given, derive one from the anim clock (opts.frame).
    var frameIndex = (opts.frameIndex !== undefined)
      ? opts.frameIndex
      : Math.floor((opts.frame || 0) / 10); // ~6 anim steps/sec at 60fps

    var rendered = isRainbow
      ? renderFrame(charId, colorVariant, anim, (opts.frame || 0), size, true)
      : this.frame(charId, colorVariant, anim, frameIndex, size);
    if (!rendered) return false;

    ctx.save();
    ctx.translate(x, y);
    if (opts.flipX) ctx.scale(-1, 1);
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

    var prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false; // keep pixels crisp on the game canvas too
    var half = size / 2;
    ctx.drawImage(rendered, -half, -half, size, size);
    ctx.imageSmoothingEnabled = prevSmooth;

    // Sparkle overlay (unchanged from v1)
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

  // True if a charId's image failed to load (so callers can stop asking / show fallback).
  hasFailed: function(charId) {
    return !!_failed[charId];
  },

  // Set custom base URL (for testing or different environments)
  setBase: function(url) {
    SPRITE_BASE = url;
  },

  // Set custom file extension (default '.png')
  setExt: function(ext) {
    SPRITE_EXT = ext;
  },

  // Set a custom charId -> URL resolver. Pass null to clear.
  // Used by sprite-test.html to load local baby-*.png files.
  setResolver: function(fn) {
    _resolver = fn;
  },

  // Tunables (call before load). Mostly for the test page.
  setPixelGrid: function(n) { PIXEL_GRID = n; },
  getPixelGrid: function() { return PIXEL_GRID; },

  // List of animation names this renderer supports.
  ANIMS: ['idle', 'walk', 'jump', 'attack', 'hurt', 'ko']
};

})();
