/**
 * Tasern Theme Engine v1.0
 * Loads sprite sheet themes, provides tile/sprite drawing for MfT Arcade games.
 * Include after tasern-engine.js: <script src="tasern-theme.js"></script>
 *
 * Usage:
 *   TasernTheme.load('themes/dungeon.json', function(ok) { ... });
 *   TasernTheme.tile(ctx, 'ground', x, y);
 *   TasernTheme.sprite(ctx, 'enemy', x, y, { frame: f, flipX: true });
 */
(function() {
"use strict";

var _theme = null;
var _sheet = null;
var _monoSheet = null;
var _tintedSheet = null;
var _tileCache = {};
var _ready = false;
var _loading = false;
var _onReady = [];

// ============================================================
// THEME LOADING
// ============================================================

function loadTheme(url, callback) {
  _ready = false;
  _loading = true;
  _tileCache = {};
  _sheet = null;
  _monoSheet = null;
  _tintedSheet = null;

  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.onload = function() {
    if (xhr.status !== 200) {
      console.warn('[tasern-theme] failed to load theme:', url, xhr.status);
      _loading = false;
      if (callback) callback(false);
      return;
    }
    try {
      _theme = JSON.parse(xhr.responseText);
    } catch(e) {
      console.warn('[tasern-theme] bad JSON:', e.message);
      _loading = false;
      if (callback) callback(false);
      return;
    }

    var pending = 1;
    function done() {
      pending--;
      if (pending <= 0) {
        _ready = true;
        _loading = false;
        // Build tinted sheet if mono + palette provided
        if (_monoSheet && _theme.tint) {
          _tintedSheet = _buildTinted(_monoSheet, _theme.tint);
        }
        if (callback) callback(true);
        for (var i = 0; i < _onReady.length; i++) _onReady[i]();
        _onReady = [];
      }
    }

    // Load main sheet
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() { _sheet = img; done(); };
    img.onerror = function() {
      console.warn('[tasern-theme] sheet load failed:', _theme.sheet);
      _loading = false;
      if (callback) callback(false);
    };
    img.src = _theme.sheet;

    // Load mono sheet if specified
    if (_theme.monoSheet) {
      pending++;
      var mono = new Image();
      mono.crossOrigin = 'anonymous';
      mono.onload = function() { _monoSheet = mono; done(); };
      mono.onerror = function() { done(); }; // non-fatal
      mono.src = _theme.monoSheet;
    }
  };
  xhr.onerror = function() {
    console.warn('[tasern-theme] network error loading:', url);
    _loading = false;
    if (callback) callback(false);
  };
  xhr.send();
}

// ============================================================
// TINTING (palette swap monochrome sheet)
// ============================================================

function _buildTinted(monoImg, color) {
  var c = document.createElement('canvas');
  c.width = monoImg.width;
  c.height = monoImg.height;
  var ctx = c.getContext('2d');
  ctx.drawImage(monoImg, 0, 0);

  // Multiply: tint white pixels to target color
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

// ============================================================
// TILE EXTRACTION
// ============================================================

function _srcSheet() {
  // Use tinted mono if available, else colored sheet
  return _tintedSheet || _sheet;
}

function _getTile(tileId) {
  if (_tileCache[tileId]) return _tileCache[tileId];
  var src = _srcSheet();
  if (!src || !_theme) return null;

  var cols = _theme.cols || 49;
  var tw = _theme.tileW || 16;
  var th = _theme.tileH || 16;
  var sp = _theme.spacing !== undefined ? _theme.spacing : 1;

  var col = tileId % cols;
  var row = Math.floor(tileId / cols);
  var sx = col * (tw + sp);
  var sy = row * (th + sp);

  var c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  var ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, sx, sy, tw, th, 0, 0, tw, th);

  _tileCache[tileId] = c;
  return c;
}

// ============================================================
// DRAWING — TILES
// ============================================================

// Draw a named tile category at x,y. Scale = multiplier (1 = native 16px).
// Position-based hash gives consistent variety per location.
function tile(ctx, category, x, y, scale) {
  if (!_ready || !_theme) return false;
  var tiles = _theme.tiles && _theme.tiles[category];
  if (!tiles || tiles.length === 0) return false;

  var idx = tiles.length === 1 ? 0 :
    Math.abs(((x * 7 + y * 13) | 0)) % tiles.length;
  var src = _getTile(tiles[idx]);
  if (!src) return false;

  var s = scale || 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, x, y, (_theme.tileW || 16) * s, (_theme.tileH || 16) * s);
  return true;
}

// Draw a specific tile by ID
function tileAt(ctx, tileId, x, y, scale) {
  if (!_ready) return false;
  var src = _getTile(tileId);
  if (!src) return false;

  var s = scale || 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, x, y, (_theme.tileW || 16) * s, (_theme.tileH || 16) * s);
  return true;
}

// Fill an area with tiles from a category
function fill(ctx, category, x, y, cols, rows, scale) {
  if (!_ready) return false;
  var s = scale || 1;
  var tw = (_theme.tileW || 16) * s;
  var th = (_theme.tileH || 16) * s;

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      tile(ctx, category, x + c * tw, y + r * th, s);
    }
  }
  return true;
}

// Draw a 3-part platform: left edge, repeated middle, right edge
function platform(ctx, x, y, widthTiles, scale) {
  if (!_ready) return false;
  var s = scale || 1;
  var tw = (_theme.tileW || 16) * s;

  if (widthTiles <= 0) return false;
  if (widthTiles === 1) return tile(ctx, 'platform_mid', x, y, s);

  tile(ctx, 'platform_left', x, y, s);
  for (var i = 1; i < widthTiles - 1; i++) {
    tile(ctx, 'platform_mid', x + i * tw, y, s);
  }
  tile(ctx, 'platform_right', x + (widthTiles - 1) * tw, y, s);
  return true;
}

// Draw a wall column: top, repeated middle, base
function wallColumn(ctx, x, y, heightTiles, scale) {
  if (!_ready) return false;
  var s = scale || 1;
  var th = (_theme.tileH || 16) * s;

  if (heightTiles <= 0) return false;
  if (heightTiles === 1) return tile(ctx, 'wall_mid', x, y, s);

  tile(ctx, 'wall_top', x, y, s);
  for (var i = 1; i < heightTiles - 1; i++) {
    tile(ctx, 'wall_mid', x, y + i * th, s);
  }
  tile(ctx, 'wall_base', x, y + (heightTiles - 1) * th, s);
  return true;
}

// ============================================================
// DRAWING — SPRITES (animated characters, enemies, items)
// ============================================================

function sprite(ctx, name, x, y, scale, opts) {
  if (!_ready || !_theme) return false;
  var def = _theme.sprites && _theme.sprites[name];
  if (!def) return false;

  opts = opts || {};
  var tileId;

  if (def.frames && def.frames.length > 0) {
    var frameIdx = Math.floor(opts.frame || 0) % def.frames.length;
    tileId = def.frames[frameIdx];
  } else if (typeof def === 'number') {
    tileId = def;
  } else {
    tileId = def.id;
  }

  var src = _getTile(tileId);
  if (!src) return false;

  var s = scale || 1;
  var tw = (_theme.tileW || 16) * s;
  var th = (_theme.tileH || 16) * s;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

  if (opts.flipX) {
    ctx.translate(x + tw, y);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0, tw, th);
  } else {
    ctx.drawImage(src, x, y, tw, th);
  }
  ctx.restore();
  return true;
}

// Draw a sprite centered at x,y (useful for characters)
function spriteCenter(ctx, name, cx, cy, scale, opts) {
  var s = scale || 1;
  var tw = (_theme.tileW || 16) * s;
  var th = (_theme.tileH || 16) * s;
  return sprite(ctx, name, cx - tw / 2, cy - th / 2, s, opts);
}

// ============================================================
// BACKGROUND RENDERING
// ============================================================

// Draw a parallax-style tiled background row
function bgRow(ctx, category, y, scrollX, width, scale) {
  if (!_ready) return false;
  var s = scale || 1;
  var tw = (_theme.tileW || 16) * s;
  var offset = scrollX ? ((-scrollX % tw) + tw) % tw : 0;
  var count = Math.ceil(width / tw) + 1;

  for (var i = 0; i < count; i++) {
    tile(ctx, category, -offset + i * tw, y, s);
  }
  return true;
}

// ============================================================
// PALETTE & THEME UTILS
// ============================================================

function isReady() { return _ready; }
function isLoading() { return _loading; }
function getTheme() { return _theme; }
function getName() { return _theme ? _theme.name : null; }

function getPalette() {
  return _theme && _theme.palette ? _theme.palette : null;
}

// Get a palette color by name
function color(name) {
  if (!_theme || !_theme.palette) return null;
  return _theme.palette[name] || null;
}

// Called when ready (if already ready, fires immediately)
function onReady(fn) {
  if (_ready) { fn(); return; }
  _onReady.push(fn);
}

// List available tile categories
function categories() {
  return _theme && _theme.tiles ? Object.keys(_theme.tiles) : [];
}

// List available sprite names
function spriteNames() {
  return _theme && _theme.sprites ? Object.keys(_theme.sprites) : [];
}

// Get tile size (scaled)
function tileSize(scale) {
  var s = scale || 1;
  return {
    w: (_theme ? _theme.tileW || 16 : 16) * s,
    h: (_theme ? _theme.tileH || 16 : 16) * s
  };
}

// ============================================================
// AUTO-LOAD from data attribute
// ============================================================
// <canvas id="gc" data-theme="themes/dungeon.json"></canvas>
(function autoLoad() {
  var gc = document.getElementById('gc');
  if (gc && gc.dataset.theme) {
    loadTheme(gc.dataset.theme);
  }
})();

// ============================================================
// EXPORT
// ============================================================
var api = {
  load: loadTheme,
  tile: tile,
  tileAt: tileAt,
  fill: fill,
  platform: platform,
  wallColumn: wallColumn,
  sprite: sprite,
  spriteCenter: spriteCenter,
  bgRow: bgRow,
  isReady: isReady,
  isLoading: isLoading,
  getTheme: getTheme,
  getName: getName,
  getPalette: getPalette,
  color: color,
  onReady: onReady,
  categories: categories,
  spriteNames: spriteNames,
  tileSize: tileSize
};

window.TasernTheme = api;
if (window.TAS) TAS.theme = api;

})();
