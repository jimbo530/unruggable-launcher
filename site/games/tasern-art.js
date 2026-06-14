// tasern-art.js — High-res art overlay system for Tasern Arcade
// Loads ToT + Baseling art for title screens, boss splashes, portraits, backgrounds
(function() {
  'use strict';

  var ART_BASE = 'art/';
  var cache = {};     // path -> Image
  var loading = {};   // path -> [callbacks]
  var ready = {};     // path -> true

  // ── Asset manifest ──────────────────────────────────────────
  var BASELINGS = [
    'apple-tree','bear-brown','beaver','brown-bunny','bull','bunny-white',
    'cat-white','cow','earth','floof-cat','frog-green','groundhog','hamster',
    'highland','leaf','longhorn','longhorn-b','monkey','mouse','oak',
    'orange-tree','pear-tree','plum-tree','rabbit','redpanda'
  ];

  var ENEMIES = [
    'goblin','wolf','bog-wight','myconid','root-witch','rot-walker',
    'shroom-knight','slime-mold','spriggan','troll','will-o-wisp','wyrm','skeleton'
  ];

  var BACKGROUNDS = [
    'bg-desert-1','bg-desert-2','bg-desert-3','bg-desert-4',
    'bg-plains-1','bg-plains-2','bg-plains-3','bg-plains-4',
    'adventure-level1','tavern-bg',
    'bg-fungal-forest','bg-mire-swamp','bg-toadstool-grove','bg-compost-cavern',
    'bg-fae-court','bg-barrow-crypt','bg-mushroom-village'
  ];

  var MAPS = ['world-map','kardovs-gate-map','londa-map','manlan-map'];

  var ITEMS = ['salad','rice','burger','berry','orange','backpack','sprout','farmer','bloom-eth','bloom-btc'];

  // ── Loader ──────────────────────────────────────────────────
  function load(path, cb) {
    if (ready[path]) { if (cb) cb(cache[path]); return cache[path]; }
    if (loading[path]) { if (cb) loading[path].push(cb); return null; }
    loading[path] = cb ? [cb] : [];
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      cache[path] = img;
      ready[path] = true;
      var cbs = loading[path];
      delete loading[path];
      for (var i = 0; i < cbs.length; i++) cbs[i](img);
    };
    img.onerror = function() {
      delete loading[path];
    };
    img.src = path;
    return null;
  }

  function getImg(path) { return ready[path] ? cache[path] : null; }

  // Convenience loaders by category
  function loadBaseling(name, cb) {
    return load(ART_BASE + 'baselings/baby-' + name + '.png', cb);
  }
  function loadEnemy(name, cb) {
    return load(ART_BASE + 'enemies/enemy-' + name + '.jpg', cb);
  }
  function loadBg(name, cb) {
    var ext = name.indexOf('bg-') === 0 || name === 'adventure-level1' || name === 'tavern-bg' ? '.webp' : '.jpg';
    return load(ART_BASE + 'backgrounds/' + name + ext, cb);
  }
  function loadMap(name, cb) {
    return load(ART_BASE + 'maps/' + name + '.jpg', cb);
  }
  function loadItem(name, cb) {
    return load(ART_BASE + 'items/' + name + '.png', cb);
  }
  function loadEgg(name, cb) {
    return load(ART_BASE + 'eggs/' + name + '.png', cb);
  }

  // Preload a full category
  function preloadCategory(cat) {
    var list = cat === 'baselings' ? BASELINGS : cat === 'enemies' ? ENEMIES :
               cat === 'backgrounds' ? BACKGROUNDS : cat === 'maps' ? MAPS :
               cat === 'items' ? ITEMS : [];
    var loader = cat === 'baselings' ? loadBaseling : cat === 'enemies' ? loadEnemy :
                 cat === 'backgrounds' ? loadBg : cat === 'maps' ? loadMap :
                 cat === 'items' ? loadItem : null;
    if (!loader) return;
    for (var i = 0; i < list.length; i++) loader(list[i]);
  }

  // ── Drawing helpers ─────────────────────────────────────────

  // Draw image covering full canvas (crop to fill, centered)
  function drawCover(ctx, img, alpha) {
    if (!img) return false;
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var scale = Math.max(cw / iw, ch / ih);
    var sw = cw / scale, sh = ch / scale;
    var sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    var prevAlpha = ctx.globalAlpha;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    ctx.globalAlpha = prevAlpha;
    return true;
  }

  // Draw image contained within a box (letterbox, centered)
  function drawContain(ctx, img, x, y, w, h) {
    if (!img) return false;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var scale = Math.min(w / iw, h / ih);
    var dw = iw * scale, dh = ih * scale;
    var dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    return true;
  }

  // Draw a circular portrait (baseling/enemy) with optional border
  function drawPortrait(ctx, img, cx, cy, radius, borderColor) {
    if (!img) return false;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var scale = Math.max(radius * 2 / iw, radius * 2 / ih);
    var sw = radius * 2 / scale, sh = radius * 2 / scale;
    var sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
    if (borderColor) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = Math.max(2, radius * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    return true;
  }

  // ── Title Screen ────────────────────────────────────────────
  // Full-screen title with background art, darkened overlay, game title, and baseling portrait
  function drawTitleScreen(ctx, opts) {
    opts = opts || {};
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var bgName = opts.bg || 'tavern-bg';
    var title = opts.title || 'Tasern Arcade';
    var subtitle = opts.subtitle || '';
    var baselingName = opts.baseling || null;
    var enemyName = opts.enemy || null;
    var prompt = opts.prompt !== false ? 'PRESS ANY KEY TO START' : '';

    // Background
    var bgImg = getImg(ART_BASE + 'backgrounds/' + bgName + (bgName.indexOf('bg-') === 0 || bgName === 'adventure-level1' || bgName === 'tavern-bg' ? '.webp' : '.jpg'));
    if (!bgImg) bgImg = getImg(ART_BASE + 'maps/' + bgName + '.jpg');

    if (bgImg) {
      drawCover(ctx, bgImg);
      // Dark overlay
      ctx.fillStyle = 'rgba(0,0,0,' + (opts.darken || 0.55) + ')';
      ctx.fillRect(0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(0, 0, cw, ch);
    }

    // Scanline effect
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (var sl = 0; sl < ch; sl += 3) {
      ctx.fillRect(0, sl, cw, 1);
    }

    // Title text
    var titleSize = Math.min(cw * 0.08, 48);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = '#000';
    ctx.font = 'bold ' + titleSize + 'px monospace';
    ctx.fillText(title, cw / 2 + 2, ch * 0.22 + 2);
    // Main
    ctx.fillStyle = opts.titleColor || '#f4b41b';
    ctx.fillText(title, cw / 2, ch * 0.22);

    // Subtitle
    if (subtitle) {
      ctx.fillStyle = '#cfc6b8';
      ctx.font = Math.floor(titleSize * 0.45) + 'px monospace';
      ctx.fillText(subtitle, cw / 2, ch * 0.22 + titleSize * 0.8);
    }

    // Character portraits
    var portraitY = ch * 0.55;
    var portraitR = Math.min(cw * 0.12, 64);

    if (baselingName && enemyName) {
      // VS layout
      var bImg = getImg(ART_BASE + 'baselings/baby-' + baselingName + '.png');
      var eImg = getImg(ART_BASE + 'enemies/enemy-' + enemyName + '.jpg');
      drawPortrait(ctx, bImg, cw * 0.3, portraitY, portraitR, '#38d973');
      drawPortrait(ctx, eImg, cw * 0.7, portraitY, portraitR, '#e6482e');
      ctx.fillStyle = '#f4b41b';
      ctx.font = 'bold ' + Math.floor(portraitR * 0.7) + 'px monospace';
      ctx.fillText('VS', cw / 2, portraitY);
    } else if (baselingName) {
      var bImg2 = getImg(ART_BASE + 'baselings/baby-' + baselingName + '.png');
      drawPortrait(ctx, bImg2, cw / 2, portraitY, portraitR * 1.2, '#a855f7');
    } else if (enemyName) {
      var eImg2 = getImg(ART_BASE + 'enemies/enemy-' + enemyName + '.jpg');
      drawPortrait(ctx, eImg2, cw / 2, portraitY, portraitR * 1.2, '#e6482e');
    }

    // Press to start
    if (prompt) {
      var blink = Math.sin(Date.now() * 0.004) > 0;
      if (blink) {
        ctx.fillStyle = '#cfc6b8';
        ctx.font = Math.floor(titleSize * 0.35) + 'px monospace';
        ctx.fillText(prompt, cw / 2, ch * 0.88);
      }
    }

    return true;
  }

  // ── Boss Splash ─────────────────────────────────────────────
  // Full-screen boss encounter reveal with dramatic presentation
  function drawBossSplash(ctx, opts) {
    opts = opts || {};
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var enemyName = opts.enemy || 'goblin';
    var bossName = opts.name || 'BOSS';
    var bgName = opts.bg || null;
    var progress = Math.min(1, opts.progress || 1); // 0-1 animation

    // Background
    var bgImg = bgName ? getImg(ART_BASE + 'backgrounds/' + bgName + '.webp') : null;
    if (bgImg) {
      drawCover(ctx, bgImg);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#0a0a15';
      ctx.fillRect(0, 0, cw, ch);
    }

    // Red danger vignette
    var grd = ctx.createRadialGradient(cw/2, ch/2, cw*0.1, cw/2, ch/2, cw*0.7);
    grd.addColorStop(0, 'rgba(230,72,46,0)');
    grd.addColorStop(1, 'rgba(230,72,46,' + (0.3 * progress) + ')');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, cw, ch);

    // Enemy portrait slides in from right
    var eImg = getImg(ART_BASE + 'enemies/enemy-' + enemyName + '.jpg');
    if (eImg) {
      var portraitSize = Math.min(cw * 0.45, ch * 0.55);
      var slideX = cw * 0.55 + (1 - progress) * cw * 0.5;
      ctx.globalAlpha = progress;
      drawContain(ctx, eImg, slideX - portraitSize/2, ch*0.15, portraitSize, portraitSize);
      ctx.globalAlpha = 1;
    }

    // "WARNING" / boss name
    var warningSize = Math.min(cw * 0.06, 36);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (progress > 0.3) {
      ctx.fillStyle = '#e6482e';
      ctx.font = 'bold ' + warningSize + 'px monospace';
      ctx.fillText('!! WARNING !!', cw / 2, ch * 0.12);
    }

    if (progress > 0.6) {
      var nameSize = Math.min(cw * 0.1, 56);
      ctx.fillStyle = '#000';
      ctx.font = 'bold ' + nameSize + 'px monospace';
      ctx.fillText(bossName, cw * 0.32 + 2, ch * 0.5 + 2);
      ctx.fillStyle = '#f4b41b';
      ctx.fillText(bossName, cw * 0.32, ch * 0.5);

      ctx.fillStyle = '#cfc6b8';
      ctx.font = Math.floor(nameSize * 0.35) + 'px monospace';
      ctx.fillText('has appeared!', cw * 0.32, ch * 0.5 + nameSize * 0.7);
    }

    return true;
  }

  // ── Victory Screen ──────────────────────────────────────────
  function drawVictoryScreen(ctx, opts) {
    opts = opts || {};
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var baselingName = opts.baseling || null;
    var score = opts.score || 0;
    var title = opts.title || 'VICTORY!';

    // Gold gradient background
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, 0, cw, ch);
    var grd = ctx.createRadialGradient(cw/2, ch*0.4, 0, cw/2, ch*0.4, cw*0.6);
    grd.addColorStop(0, 'rgba(244,180,27,0.25)');
    grd.addColorStop(1, 'rgba(26,28,44,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, cw, ch);

    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (var sl = 0; sl < ch; sl += 3) ctx.fillRect(0, sl, cw, 1);

    var titleSize = Math.min(cw * 0.1, 56);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.fillStyle = '#000';
    ctx.font = 'bold ' + titleSize + 'px monospace';
    ctx.fillText(title, cw/2 + 2, ch * 0.18 + 2);
    ctx.fillStyle = '#f4b41b';
    ctx.fillText(title, cw/2, ch * 0.18);

    // Baseling celebration
    if (baselingName) {
      var bImg = getImg(ART_BASE + 'baselings/baby-' + baselingName + '.png');
      if (bImg) {
        var size = Math.min(cw * 0.35, ch * 0.35);
        var bounce = Math.sin(Date.now() * 0.005) * 8;
        drawContain(ctx, bImg, cw/2 - size/2, ch * 0.3 + bounce, size, size);
      }
    }

    // Score
    if (score) {
      ctx.fillStyle = '#cfc6b8';
      ctx.font = Math.floor(titleSize * 0.5) + 'px monospace';
      ctx.fillText('SCORE: ' + score, cw/2, ch * 0.75);
    }

    return true;
  }

  // ── Game Over Screen ────────────────────────────────────────
  function drawGameOverScreen(ctx, opts) {
    opts = opts || {};
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var enemyName = opts.enemy || null;
    var score = opts.score || 0;

    ctx.fillStyle = '#0a0a15';
    ctx.fillRect(0, 0, cw, ch);

    // Red vignette
    var grd = ctx.createRadialGradient(cw/2, ch/2, 0, cw/2, ch/2, cw*0.6);
    grd.addColorStop(0, 'rgba(180,30,30,0.15)');
    grd.addColorStop(1, 'rgba(10,10,21,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, cw, ch);

    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (var sl = 0; sl < ch; sl += 3) ctx.fillRect(0, sl, cw, 1);

    // Enemy looming
    if (enemyName) {
      var eImg = getImg(ART_BASE + 'enemies/enemy-' + enemyName + '.jpg');
      if (eImg) {
        ctx.globalAlpha = 0.35;
        drawCover(ctx, eImg);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, cw, ch);
      }
    }

    var titleSize = Math.min(cw * 0.1, 56);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#000';
    ctx.font = 'bold ' + titleSize + 'px monospace';
    ctx.fillText('GAME OVER', cw/2 + 2, ch * 0.35 + 2);
    ctx.fillStyle = '#e6482e';
    ctx.fillText('GAME OVER', cw/2, ch * 0.35);

    if (score) {
      ctx.fillStyle = '#cfc6b8';
      ctx.font = Math.floor(titleSize * 0.45) + 'px monospace';
      ctx.fillText('SCORE: ' + score, cw/2, ch * 0.5);
    }

    ctx.fillStyle = '#888';
    ctx.font = Math.floor(titleSize * 0.3) + 'px monospace';
    var blink = Math.sin(Date.now() * 0.004) > 0;
    if (blink) ctx.fillText('PRESS ANY KEY TO CONTINUE', cw/2, ch * 0.75);

    return true;
  }

  // ── HUD Portrait ────────────────────────────────────────────
  // Small baseling portrait for in-game HUD (top-left corner typically)
  function drawHudPortrait(ctx, baselingName, x, y, size) {
    var img = getImg(ART_BASE + 'baselings/baby-' + baselingName + '.png');
    if (!img) return false;
    var r = size / 2;
    drawPortrait(ctx, img, x + r, y + r, r, '#a855f7');
    return true;
  }

  // ── Random Pickers ──────────────────────────────────────────
  function randomBaseling() { return BASELINGS[Math.floor(Math.random() * BASELINGS.length)]; }
  function randomEnemy() { return ENEMIES[Math.floor(Math.random() * ENEMIES.length)]; }
  function randomBg() { return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)]; }

  // ── Public API ──────────────────────────────────────────────
  window.TasernArt = {
    load: load,
    getImg: getImg,
    loadBaseling: loadBaseling,
    loadEnemy: loadEnemy,
    loadBg: loadBg,
    loadMap: loadMap,
    loadItem: loadItem,
    loadEgg: loadEgg,
    preload: preloadCategory,

    drawCover: drawCover,
    drawContain: drawContain,
    drawPortrait: drawPortrait,

    drawTitleScreen: drawTitleScreen,
    drawBossSplash: drawBossSplash,
    drawVictoryScreen: drawVictoryScreen,
    drawGameOverScreen: drawGameOverScreen,
    drawHudPortrait: drawHudPortrait,

    randomBaseling: randomBaseling,
    randomEnemy: randomEnemy,
    randomBg: randomBg,

    BASELINGS: BASELINGS,
    ENEMIES: ENEMIES,
    BACKGROUNDS: BACKGROUNDS,
    MAPS: MAPS,
    ITEMS: ITEMS
  };

  // Also attach to TAS if available
  if (window.TAS) TAS.art = window.TasernArt;

  // ── Auto-preload on script load ─────────────────────────────
  // Deterministic picks per game (from page title hash)
  var seed = 0;
  try { var t = document.title || ''; for (var si = 0; si < t.length; si++) seed = ((seed << 5) - seed + t.charCodeAt(si)) | 0; } catch(e) {}
  var abs = Math.abs(seed);
  var autoBg = BACKGROUNDS[abs % BACKGROUNDS.length];
  var autoBaseling = BASELINGS[(abs >> 4) % BASELINGS.length];
  var autoEnemy = ENEMIES[(abs >> 8) % ENEMIES.length];
  loadBg(autoBg);
  loadBaseling(autoBaseling);
  loadEnemy(autoEnemy);

  // Expose auto-picks for engine integration
  window.TasernArt._auto = { bg: autoBg, baseling: autoBaseling, enemy: autoEnemy };
})();
