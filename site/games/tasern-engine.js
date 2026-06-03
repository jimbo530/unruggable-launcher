/**
 * Tasern Arcade Engine v1.0
 * Shared infrastructure for all MfT Arcade games.
 * Include before your game script: <script src="tasern-engine.js"></script>
 *
 * Provides: TAS.canvas, TAS.ctx, TAS.audio, TAS.particles, TAS.input, TAS.ui, TAS.loop
 */
const TAS = (function() {
"use strict";

// ============================================================
// CANVAS
// ============================================================
const canvas = document.getElementById('gc');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, scale = 1;

/**
 * Initialize canvas with a fixed game resolution.
 * Call once. Handles DPR and responsive resize.
 * @param {number} gw - game world width in pixels
 * @param {number} gh - game world height in pixels
 * @returns {{W, H, scale}} current dimensions
 */
function initCanvas(gw, gh) {
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const sw = window.innerWidth;
    const sh = window.innerHeight - 20;
    scale = Math.min(sw / gw, sh / gh);
    W = Math.floor(gw * scale);
    H = Math.floor(gh * scale);
    canvas.width = gw * dpr;
    canvas.height = gh * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.style.marginTop = Math.max(0, Math.floor((sh - H) / 2)) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();
  return { get W() { return W; }, get H() { return H; }, get scale() { return scale; }, resize };
}

// ============================================================
// AUDIO ENGINE
// ============================================================
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, dur, type, vol, slide) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (slide) osc.frequency.linearRampToValueAtTime(slide, audioCtx.currentTime + dur);
  gain.gain.setValueAtTime(vol || 0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

function playNoise(dur, vol, freq) {
  if (!audioCtx) return;
  const bufSize = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol || 0.05, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  if (freq) {
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = freq;
    src.connect(filt);
    filt.connect(gain);
  } else {
    src.connect(gain);
  }
  gain.connect(audioCtx.destination);
  src.start();
  src.stop(audioCtx.currentTime + dur);
}

function playMelody(notes, spacing) {
  notes.forEach(function(n, i) {
    setTimeout(function() { playTone(n[0], n[1] || 0.12, n[2] || 'square', n[3] || 0.08); }, i * (spacing || 120));
  });
}

const audio = { ensureAudio, playTone, playNoise, playMelody };

// ============================================================
// PARTICLE SYSTEM
// ============================================================
let particles = [];

function spawnParticles(x, y, color, count, speed, opts) {
  opts = opts || {};
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = (speed || 2) * (0.3 + Math.random() * 0.7);
    particles.push({
      x: x, y: y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 1,
      color: color,
      size: (opts.size || 2) + Math.random() * (opts.sizeVar || 2),
      gravity: opts.gravity || 0,
      shape: opts.shape || 'circle' // 'circle' or 'rect'
    });
  }
}

function updateParticles(dt) {
  const decay = dt ? dt * 2.5 : 0.03;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const m = dt ? dt * 60 : 1;
    p.x += p.vx * m;
    p.y += p.vy * m;
    p.vy += p.gravity * m;
    p.life -= decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') {
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function clearParticles() { particles = []; }

// ============================================================
// SCREEN EFFECTS
// ============================================================
let flashAlpha = 0, flashColor = '#fff';
let shakeX = 0, shakeY = 0, shakeMag = 0, shakeDecay = 0;

function flash(color, intensity) {
  flashColor = color || '#fff';
  flashAlpha = intensity || 0.3;
}

function shake(magnitude, decay) {
  shakeMag = magnitude || 5;
  shakeDecay = decay || 0.9;
}

function updateEffects(dt) {
  const m = dt ? dt * 60 : 1;
  if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - (dt ? dt * 3 : 0.05));
  if (shakeMag > 0.1) {
    shakeX = (Math.random() - 0.5) * shakeMag * 2;
    shakeY = (Math.random() - 0.5) * shakeMag * 2;
    shakeMag *= shakeDecay;
  } else {
    shakeX = shakeY = shakeMag = 0;
  }
}

function applyShake() {
  if (shakeX || shakeY) ctx.translate(shakeX, shakeY);
}

function drawFlash(w, h) {
  if (flashAlpha > 0) {
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// INPUT
// ============================================================
const keys = {};
let isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

document.addEventListener('keydown', function(e) {
  keys[e.code] = true;
  keys[e.key] = true;
  ensureAudio();
});
document.addEventListener('keyup', function(e) {
  keys[e.code] = false;
  keys[e.key] = false;
});

// Virtual d-pad state
const touch = { left: false, right: false, up: false, down: false, a: false, b: false };
let touchZones = null; // set by initTouch

/**
 * Initialize touch controls with configurable buttons.
 * @param {object} opts - { dpadSize, btnSize, buttons: ['a','b'] }
 */
function initTouch(opts) {
  opts = opts || {};
  const dpadSize = opts.dpadSize || 110;
  const btnSize = opts.btnSize || 60;
  const buttons = opts.buttons || ['a', 'b'];
  const labels = opts.labels || { a: 'JUMP', b: 'FIRE' };

  touchZones = { dpadSize, btnSize, buttons, labels };

  function getActions(px, py, w, h) {
    const actions = [];
    const dpadX = 20 + dpadSize / 2;
    const dpadY = h - 20 - dpadSize / 2;

    // D-pad
    const dx = px - dpadX, dy = py - dpadY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < dpadSize * 0.8) {
      if (dx < -dpadSize * 0.2) actions.push('left');
      if (dx > dpadSize * 0.2) actions.push('right');
      if (dy < -dpadSize * 0.2) actions.push('up');
      if (dy > dpadSize * 0.2) actions.push('down');
    }

    // Buttons (stacked from bottom-right)
    for (let i = 0; i < buttons.length; i++) {
      const bx = w - 20 - btnSize / 2;
      const by = h - 20 - btnSize / 2 - i * (btnSize * 1.3);
      const bdx = px - bx, bdy = py - by;
      if (Math.sqrt(bdx * bdx + bdy * bdy) < btnSize * 0.7) {
        actions.push(buttons[i]);
      }
    }
    return actions;
  }

  function handleTouches(e, active) {
    // Reset
    touch.left = touch.right = touch.up = touch.down = touch.a = touch.b = false;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (window.devicePixelRatio || 1) / rect.width;
    const scaleY = canvas.height / (window.devicePixelRatio || 1) / rect.height;

    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      const px = (t.clientX - rect.left) * scaleX;
      const py = (t.clientY - rect.top) * scaleY;
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      const actions = getActions(px, py, w, h);
      for (const a of actions) touch[a] = true;
    }
  }

  canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    ensureAudio();
    handleTouches(e, true);
    if (touchCallbacks.start) touchCallbacks.start(e);
  }, { passive: false });
  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    handleTouches(e, true);
  }, { passive: false });
  canvas.addEventListener('touchend', function(e) {
    e.preventDefault();
    handleTouches(e, false);
    if (touchCallbacks.end) touchCallbacks.end(e);
  }, { passive: false });
}

const touchCallbacks = { start: null, end: null };
function onTouch(event, fn) { touchCallbacks[event] = fn; }

function drawTouchControls(w, h) {
  if (!isMobile || !touchZones) return;
  const { dpadSize, btnSize, buttons, labels } = touchZones;
  ctx.globalAlpha = 0.22;

  // D-pad
  const dpadX = 20 + dpadSize / 2;
  const dpadY = h - 20 - dpadSize / 2;
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.arc(dpadX, dpadY, dpadSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#aaa';
  // Arrows
  ctx.beginPath(); ctx.moveTo(dpadX - 30, dpadY); ctx.lineTo(dpadX - 15, dpadY - 12); ctx.lineTo(dpadX - 15, dpadY + 12); ctx.fill();
  ctx.beginPath(); ctx.moveTo(dpadX + 30, dpadY); ctx.lineTo(dpadX + 15, dpadY - 12); ctx.lineTo(dpadX + 15, dpadY + 12); ctx.fill();
  ctx.beginPath(); ctx.moveTo(dpadX, dpadY - 30); ctx.lineTo(dpadX - 12, dpadY - 15); ctx.lineTo(dpadX + 12, dpadY - 15); ctx.fill();
  ctx.beginPath(); ctx.moveTo(dpadX, dpadY + 30); ctx.lineTo(dpadX - 12, dpadY + 15); ctx.lineTo(dpadX + 12, dpadY + 15); ctx.fill();

  // Buttons
  const colors = { a: '#4488cc', b: '#aa44ff', c: '#44cc44', d: '#cc8844' };
  for (let i = 0; i < buttons.length; i++) {
    const bx = w - 20 - btnSize / 2;
    const by = h - 20 - btnSize / 2 - i * (btnSize * 1.3);
    ctx.fillStyle = colors[buttons[i]] || '#666';
    ctx.beginPath();
    ctx.arc(bx, by, btnSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.floor(btnSize * 0.28) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(labels[buttons[i]] || buttons[i].toUpperCase(), bx, by + 4);
  }
  ctx.globalAlpha = 1;
}

// ============================================================
// HIGHSCORE
// ============================================================
function loadHigh(key) {
  try { return parseInt(localStorage.getItem(key) || '0', 10); } catch(e) { return 0; }
}
function saveHigh(key, score) {
  try { localStorage.setItem(key, String(score)); } catch(e) { console.warn('[tasern-engine] save high score:', e.message || e); }
}

// ============================================================
// UI HELPERS
// ============================================================
function drawTitle(title, subtitle, w, h, opts) {
  opts = opts || {};
  const frame = opts.frame || 0;
  ctx.textAlign = 'center';

  // Title
  ctx.fillStyle = '#000';
  ctx.font = 'bold ' + Math.floor(h * 0.06) + 'px monospace';
  ctx.fillText(title, w / 2 + 2, h * 0.22 + 2);
  ctx.fillStyle = opts.titleColor || '#44dd88';
  ctx.fillText(title, w / 2, h * 0.22);

  if (subtitle) {
    ctx.fillStyle = opts.subtitleColor || '#888';
    ctx.font = Math.floor(h * 0.03) + 'px monospace';
    ctx.fillText(subtitle, w / 2, h * 0.29);
  }

  // Start prompt
  const pulse = Math.sin(frame * 0.05) * 0.3 + 0.7;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#ffdd44';
  ctx.font = 'bold ' + Math.floor(h * 0.035) + 'px monospace';
  ctx.fillText('PRESS ANY KEY TO START', w / 2, h * 0.9);
  ctx.globalAlpha = 1;
}

function drawGameOver(score, highScore, w, h, opts) {
  opts = opts || {};
  const frame = opts.frame || 0;

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold ' + Math.floor(h * 0.08) + 'px monospace';
  ctx.fillText('GAME OVER', w / 2, h * 0.3);

  ctx.fillStyle = '#ffdd44';
  ctx.font = 'bold ' + Math.floor(h * 0.045) + 'px monospace';
  ctx.fillText('Score: ' + score, w / 2, h * 0.48);

  if (score >= highScore && score > 0) {
    const pulse = Math.sin(frame * 0.06) * 0.3 + 0.7;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffdd44';
    ctx.font = 'bold ' + Math.floor(h * 0.035) + 'px monospace';
    ctx.fillText('NEW HIGH SCORE!', w / 2, h * 0.57);
    ctx.globalAlpha = 1;
  } else if (highScore > 0) {
    ctx.fillStyle = '#888';
    ctx.font = Math.floor(h * 0.03) + 'px monospace';
    ctx.fillText('Best: ' + highScore, w / 2, h * 0.57);
  }

  if (opts.extra) {
    ctx.fillStyle = '#fff';
    ctx.font = Math.floor(h * 0.03) + 'px monospace';
    ctx.fillText(opts.extra, w / 2, h * 0.67);
  }

  const pulse2 = Math.sin(frame * 0.05) * 0.3 + 0.7;
  ctx.globalAlpha = pulse2;
  ctx.fillStyle = '#88ccff';
  ctx.font = 'bold ' + Math.floor(h * 0.035) + 'px monospace';
  ctx.fillText('PRESS ANY KEY', w / 2, h * 0.85);
  ctx.globalAlpha = 1;
}

function drawHUD(score, level, lives, w, opts) {
  opts = opts || {};
  const barH = opts.barHeight || 28;
  ctx.fillStyle = 'rgba(10,5,20,0.7)';
  ctx.fillRect(0, 0, w, barH);
  ctx.font = 'bold ' + Math.floor(barH * 0.55) + 'px monospace';

  // Score
  ctx.fillStyle = '#ffdd44';
  ctx.textAlign = 'left';
  ctx.fillText((opts.scoreLabel || 'SCORE') + ': ' + score, 6, barH * 0.72);

  // Level
  if (level !== undefined) {
    ctx.fillStyle = '#88ccff';
    ctx.textAlign = 'center';
    ctx.fillText('LV ' + level, w / 2, barH * 0.72);
  }

  // Lives
  if (lives !== undefined) {
    ctx.textAlign = 'right';
    ctx.fillStyle = opts.lifeColor || '#44dd88';
    for (let i = 0; i < lives; i++) {
      ctx.beginPath();
      ctx.arc(w - 10 - i * (barH * 0.7), barH * 0.5, barH * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ============================================================
// GAME LOOP
// ============================================================
let _lastTime = 0;
let _running = false;

/**
 * Start the game loop.
 * @param {function} updateFn - called with (dt) in seconds
 * @param {function} drawFn - called after update
 */
function startLoop(updateFn, drawFn) {
  _running = true;
  _lastTime = performance.now();
  function frame(now) {
    if (!_running) return;
    const dt = Math.min((now - _lastTime) / 1000, 0.05); // cap at 50ms
    _lastTime = now;
    updateFn(dt);
    drawFn(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function stopLoop() { _running = false; }

// ============================================================
// STARFIELD (common background)
// ============================================================
function createStarfield(count, w, h) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({ x: Math.random() * w, y: Math.random() * h, speed: 0.3 + Math.random() * 1.5, size: Math.random() < 0.3 ? 2 : 1 });
  }
  return {
    stars,
    update(scrollX) {
      for (const s of stars) {
        s.x -= s.speed * (scrollX || 1);
        if (s.x < 0) { s.x = w; s.y = Math.random() * h; }
      }
    },
    draw() {
      for (const s of stars) {
        const b = Math.floor(100 + s.speed * 100);
        ctx.fillStyle = 'rgb(' + b + ',' + b + ',' + (b + 30) + ')';
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
    }
  };
}

// ============================================================
// COLLISION HELPERS
// ============================================================
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function circleOverlap(ax, ay, ar, bx, by, br) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy < (ar + br) * (ar + br);
}

function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

// ============================================================
// MATH HELPERS
// ============================================================
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function randRange(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(randRange(min, max + 1)); }
function dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }
function angle(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }

// ============================================================
// BASELING SPRITE HELPER
// ============================================================
// Draw the player's selected baseling sprite. Returns true if drawn, false = use fallback.
// Usage: if (!TAS.drawBaseling(ctx, x, y, size, opts)) { /* existing drawing */ }
function drawBaseling(drawCtx, x, y, size, opts) {
  var b = window.NftLoader && NftLoader.getStatBonuses();
  if (b && b.charId && window.BaselingSprites && BaselingSprites.isLoaded(b.charId)) {
    return BaselingSprites.draw(drawCtx, b.charId, b.colorVariant, b.sparkle, x, y, size, opts || {});
  }
  return false;
}

// ============================================================
// EXPORT
// ============================================================
return {
  canvas, ctx,
  initCanvas,
  audio,
  particles: { spawn: spawnParticles, update: updateParticles, draw: drawParticles, clear: clearParticles },
  fx: { flash, shake, updateEffects, applyShake, drawFlash },
  input: { keys, touch, isMobile, initTouch, onTouch, drawTouchControls },
  score: { load: loadHigh, save: saveHigh },
  ui: { drawTitle, drawGameOver, drawHUD },
  loop: { start: startLoop, stop: stopLoop },
  bg: { createStarfield },
  hit: { rectOverlap, circleOverlap, pointInRect },
  math: { lerp, clamp, randRange, randInt, dist, angle },
  drawBaseling
};

})();
