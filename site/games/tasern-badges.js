/**
 * Tasern Cross-Game Badge System v1.0
 * Shared achievement overlay for all MfT Arcade games.
 * Include after tasern-engine.js: <script src="tasern-badges.js"></script>
 *
 * API:
 *   TasernBadges.trackPlay(gameName, genre)
 *   TasernBadges.trackScore(gameName, score)
 *   TasernBadges.trackAchievement(gameName, achievementKey)
 *   TasernBadges.showNotification(badge)
 *   TasernBadges.renderBadgeBar(container)
 *   TasernBadges.getBadges()
 *   TasernBadges.getState()
 */
const TasernBadges = (function() {
"use strict";

// ============================================================
// STORAGE
// ============================================================
const STORAGE_KEY = 'tasern_badges';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('[TasernBadges] Failed to load state:', e.message);
  }
  return {
    games_played: [],
    genres_played: [],
    scores: {},
    total_time_ms: 0,
    session_games: [],
    session_start: Date.now(),
    badges_earned: [],
    timestamps: {},
    achievements: {}
  };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[TasernBadges] Failed to save state:', e.message);
  }
}

let state = loadState();

// ============================================================
// BADGE DEFINITIONS
// ============================================================
const BADGES = [
  { id: 'first_steps',     name: 'First Steps',     desc: 'Play any 1 game',                        icon: 'boot',     color: '#4CAF50' },
  { id: 'explorer',        name: 'Explorer',         desc: 'Play 5 different games',                 icon: 'compass',  color: '#2196F3' },
  { id: 'adventurer',      name: 'Adventurer',       desc: 'Play 10 different games',                icon: 'map',      color: '#9C27B0' },
  { id: 'veteran',         name: 'Veteran',          desc: 'Play 25 different games',                icon: 'shield',   color: '#FF5722' },
  { id: 'completionist',   name: 'Completionist',   desc: 'Play all 100 games',                     icon: 'crown',    color: '#FFD700' },
  { id: 'high_scorer',     name: 'High Scorer',      desc: 'Get a high score in any game',           icon: 'star',     color: '#FFC107' },
  { id: 'combo_king',      name: 'Combo King',       desc: 'Hit 10+ combo in a combo-based game',    icon: 'bolt',     color: '#FF9800' },
  { id: 'survivor',        name: 'Survivor',         desc: 'Survive 10+ waves in a wave game',       icon: 'heart',    color: '#E91E63' },
  { id: 'speed_demon',     name: 'Speed Demon',      desc: 'Complete any racing game',               icon: 'flame',    color: '#F44336' },
  { id: 'puzzle_master',   name: 'Puzzle Master',    desc: 'Complete any puzzle game',               icon: 'gem',      color: '#00BCD4' },
  { id: 'boss_slayer',     name: 'Boss Slayer',      desc: 'Defeat a boss in any game',              icon: 'skull',    color: '#8B0000' },
  { id: 'streak',          name: 'Streak',           desc: 'Play 3 games in a row (same session)',   icon: 'fire',     color: '#FF6F00' },
  { id: 'genre_hopper',    name: 'Genre Hopper',     desc: 'Play games from 5+ different genres',    icon: 'dice',     color: '#7C4DFF' },
  { id: 'arcade_rat',      name: 'Arcade Rat',       desc: 'Spend 1 hour total in the arcade',       icon: 'clock',    color: '#607D8B' },
  { id: 'pinball_wizard',  name: 'Pinball Wizard',   desc: 'Score 100K+ in Tasern Pinball',          icon: 'ball',     color: '#CE93D8' },
  { id: 'quest_complete',  name: 'Quest Complete',   desc: 'Finish a quest in Tasern Quest',         icon: 'scroll',   color: '#A1887F' },
  { id: 'champion',        name: 'Champion',         desc: 'Win a season in Baseling Sluggers',      icon: 'trophy',   color: '#CDDC39' },
  { id: 'rhythm_master',   name: 'Rhythm Master',    desc: 'Get S rank in Rhythm Baseling',          icon: 'note',     color: '#E040FB' },
  { id: 'builder_badge',   name: 'Builder',          desc: 'Build 10+ towers in Spore Defense',      icon: 'tower',    color: '#8D6E63' },
  { id: 'legend',          name: 'Legend',            desc: 'Earn 15+ other badges',                  icon: 'dragon',   color: '#FFD700' }
];

// ============================================================
// ICON RENDERER (draws badge icons on a canvas)
// ============================================================
function drawIcon(ctx, icon, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);

  switch (icon) {
    case 'boot':
      ctx.fillStyle = color;
      ctx.fillRect(-r*0.4, -r*0.5, r*0.6, r*0.8);
      ctx.fillRect(-r*0.4, r*0.1, r*0.9, r*0.4);
      break;
    case 'compass':
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.15;
      ctx.beginPath();
      ctx.arc(0, 0, r*0.6, 0, Math.PI*2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.5);
      ctx.lineTo(r*0.15, 0);
      ctx.lineTo(0, r*0.5);
      ctx.lineTo(-r*0.15, 0);
      ctx.fill();
      break;
    case 'map':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-r*0.5, -r*0.5);
      ctx.lineTo(-r*0.15, -r*0.3);
      ctx.lineTo(r*0.2, -r*0.5);
      ctx.lineTo(r*0.5, -r*0.3);
      ctx.lineTo(r*0.5, r*0.5);
      ctx.lineTo(r*0.2, r*0.3);
      ctx.lineTo(-r*0.15, r*0.5);
      ctx.lineTo(-r*0.5, r*0.3);
      ctx.closePath();
      ctx.fill();
      break;
    case 'shield':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.6);
      ctx.lineTo(r*0.5, -r*0.3);
      ctx.lineTo(r*0.5, r*0.1);
      ctx.lineTo(0, r*0.6);
      ctx.lineTo(-r*0.5, r*0.1);
      ctx.lineTo(-r*0.5, -r*0.3);
      ctx.closePath();
      ctx.fill();
      break;
    case 'crown':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-r*0.5, r*0.3);
      ctx.lineTo(-r*0.5, -r*0.1);
      ctx.lineTo(-r*0.25, r*0.1);
      ctx.lineTo(0, -r*0.5);
      ctx.lineTo(r*0.25, r*0.1);
      ctx.lineTo(r*0.5, -r*0.1);
      ctx.lineTo(r*0.5, r*0.3);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star':
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i * 72 - 90) * Math.PI / 180;
        const inner = (i * 72 - 90 + 36) * Math.PI / 180;
        ctx.lineTo(Math.cos(angle) * r*0.55, Math.sin(angle) * r*0.55);
        ctx.lineTo(Math.cos(inner) * r*0.25, Math.sin(inner) * r*0.25);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'bolt':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(r*0.1, -r*0.6);
      ctx.lineTo(-r*0.3, r*0.05);
      ctx.lineTo(r*0.05, r*0.05);
      ctx.lineTo(-r*0.1, r*0.6);
      ctx.lineTo(r*0.3, -r*0.05);
      ctx.lineTo(-r*0.05, -r*0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'heart':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, r*0.5);
      ctx.bezierCurveTo(-r*0.6, r*0.1, -r*0.6, -r*0.4, 0, -r*0.15);
      ctx.bezierCurveTo(r*0.6, -r*0.4, r*0.6, r*0.1, 0, r*0.5);
      ctx.fill();
      break;
    case 'flame':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.6);
      ctx.quadraticCurveTo(r*0.5, -r*0.1, r*0.3, r*0.3);
      ctx.quadraticCurveTo(r*0.15, r*0.5, 0, r*0.6);
      ctx.quadraticCurveTo(-r*0.15, r*0.5, -r*0.3, r*0.3);
      ctx.quadraticCurveTo(-r*0.5, -r*0.1, 0, -r*0.6);
      ctx.fill();
      break;
    case 'gem':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.5);
      ctx.lineTo(r*0.5, -r*0.1);
      ctx.lineTo(r*0.3, r*0.5);
      ctx.lineTo(-r*0.3, r*0.5);
      ctx.lineTo(-r*0.5, -r*0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'skull':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, -r*0.1, r*0.45, 0, Math.PI*2);
      ctx.fill();
      ctx.fillRect(-r*0.2, r*0.2, r*0.4, r*0.35);
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(-r*0.15, -r*0.15, r*0.12, 0, Math.PI*2);
      ctx.arc(r*0.15, -r*0.15, r*0.12, 0, Math.PI*2);
      ctx.fill();
      break;
    case 'fire':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.6);
      ctx.quadraticCurveTo(r*0.4, 0, r*0.2, r*0.4);
      ctx.lineTo(0, r*0.2);
      ctx.lineTo(-r*0.2, r*0.4);
      ctx.quadraticCurveTo(-r*0.4, 0, 0, -r*0.6);
      ctx.fill();
      ctx.fillStyle = '#FFF176';
      ctx.beginPath();
      ctx.moveTo(0, -r*0.1);
      ctx.quadraticCurveTo(r*0.15, r*0.15, r*0.1, r*0.35);
      ctx.lineTo(-r*0.1, r*0.35);
      ctx.quadraticCurveTo(-r*0.15, r*0.15, 0, -r*0.1);
      ctx.fill();
      break;
    case 'dice':
      ctx.fillStyle = color;
      ctx.fillRect(-r*0.4, -r*0.4, r*0.8, r*0.8);
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(-r*0.2, -r*0.2, r*0.08, 0, Math.PI*2);
      ctx.arc(r*0.2, -r*0.2, r*0.08, 0, Math.PI*2);
      ctx.arc(0, 0, r*0.08, 0, Math.PI*2);
      ctx.arc(-r*0.2, r*0.2, r*0.08, 0, Math.PI*2);
      ctx.arc(r*0.2, r*0.2, r*0.08, 0, Math.PI*2);
      ctx.fill();
      break;
    case 'clock':
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.arc(0, 0, r*0.5, 0, Math.PI*2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r*0.35);
      ctx.moveTo(0, 0);
      ctx.lineTo(r*0.25, 0);
      ctx.stroke();
      break;
    case 'ball':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r*0.5, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = r*0.06;
      ctx.beginPath();
      ctx.arc(0, 0, r*0.5, -0.5, 0.5);
      ctx.stroke();
      break;
    case 'scroll':
      ctx.fillStyle = color;
      ctx.fillRect(-r*0.35, -r*0.4, r*0.7, r*0.8);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(-r*0.2, -r*0.25, r*0.4, r*0.06);
      ctx.fillRect(-r*0.2, -r*0.1, r*0.35, r*0.06);
      ctx.fillRect(-r*0.2, r*0.05, r*0.3, r*0.06);
      break;
    case 'trophy':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-r*0.3, -r*0.5);
      ctx.lineTo(r*0.3, -r*0.5);
      ctx.lineTo(r*0.2, r*0.1);
      ctx.lineTo(-r*0.2, r*0.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-r*0.1, r*0.1, r*0.2, r*0.2);
      ctx.fillRect(-r*0.25, r*0.3, r*0.5, r*0.15);
      break;
    case 'note':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(-r*0.15, r*0.25, r*0.2, r*0.15, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.fillRect(r*0.0, -r*0.5, r*0.08, r*0.75);
      ctx.fillRect(r*0.0, -r*0.5, r*0.35, r*0.1);
      break;
    case 'tower':
      ctx.fillStyle = color;
      ctx.fillRect(-r*0.2, -r*0.2, r*0.4, r*0.7);
      ctx.fillRect(-r*0.3, -r*0.5, r*0.12, r*0.3);
      ctx.fillRect(-r*0.05, -r*0.5, r*0.12, r*0.3);
      ctx.fillRect(r*0.2, -r*0.5, r*0.12, r*0.3);
      break;
    case 'dragon':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.5);
      ctx.lineTo(r*0.5, -r*0.2);
      ctx.lineTo(r*0.3, r*0.1);
      ctx.lineTo(r*0.5, r*0.5);
      ctx.lineTo(0, r*0.3);
      ctx.lineTo(-r*0.5, r*0.5);
      ctx.lineTo(-r*0.3, r*0.1);
      ctx.lineTo(-r*0.5, -r*0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFF176';
      ctx.beginPath();
      ctx.arc(-r*0.1, -r*0.1, r*0.06, 0, Math.PI*2);
      ctx.arc(r*0.1, -r*0.1, r*0.06, 0, Math.PI*2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r*0.4, 0, Math.PI*2);
      ctx.fill();
  }

  ctx.restore();
}

// ============================================================
// AUDIO (uses TAS.audio if available, else own WebAudio)
// ============================================================
let audioCtx = null;

function ensureAudio() {
  if (typeof TAS !== 'undefined' && TAS.audio) {
    TAS.audio.ensureAudio();
    return;
  }
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playBadgeSound() {
  ensureAudio();

  if (typeof TAS !== 'undefined' && TAS.audio && TAS.audio.playMelody) {
    TAS.audio.playMelody([
      [523, 0.08, 'sine', 0.12],
      [659, 0.08, 'sine', 0.12],
      [784, 0.1, 'sine', 0.15],
      [1047, 0.2, 'sine', 0.1]
    ], 90);
    return;
  }

  if (!audioCtx) return;
  const notes = [523, 659, 784, 1047];
  const now = audioCtx.currentTime;
  notes.forEach(function(freq, i) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, now + i * 0.09);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + i * 0.09);
    osc.stop(now + i * 0.09 + 0.25);
  });
}

// ============================================================
// PARTICLE BURST (DOM-based, independent of TAS particles)
// ============================================================
function spawnBurstAt(x, y, container) {
  const colors = ['#FFD700', '#FFA000', '#FFECB3', '#FF6F00', '#FFF176', '#FFFFFF'];
  const count = 20;

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const speed = 40 + Math.random() * 60;
    const size = 3 + Math.random() * 5;
    const color = colors[Math.floor(Math.random() * colors.length)];

    particle.style.cssText = [
      'position:absolute',
      'left:' + x + 'px',
      'top:' + y + 'px',
      'width:' + size + 'px',
      'height:' + size + 'px',
      'background:' + color,
      'border-radius:50%',
      'pointer-events:none',
      'z-index:100001',
      'opacity:1',
      'transition:all 0.6s cubic-bezier(0.25,0.46,0.45,0.94)'
    ].join(';');

    container.appendChild(particle);

    requestAnimationFrame(function() {
      particle.style.transform = 'translate(' +
        Math.cos(angle) * speed + 'px,' +
        Math.sin(angle) * speed + 'px) scale(0)';
      particle.style.opacity = '0';
    });

    setTimeout(function() {
      if (particle.parentNode) particle.parentNode.removeChild(particle);
    }, 700);
  }
}

// ============================================================
// NOTIFICATION OVERLAY
// ============================================================
let notifContainer = null;

function getNotifContainer() {
  if (notifContainer && notifContainer.parentNode) return notifContainer;
  notifContainer = document.createElement('div');
  notifContainer.id = 'tasern-badge-notifs';
  notifContainer.style.cssText = [
    'position:fixed',
    'top:12px',
    'right:12px',
    'z-index:100000',
    'pointer-events:none',
    'display:flex',
    'flex-direction:column',
    'gap:8px',
    'font-family:"Segoe UI",Arial,sans-serif'
  ].join(';');
  document.body.appendChild(notifContainer);
  return notifContainer;
}

function showNotification(badge) {
  const container = getNotifContainer();

  const el = document.createElement('div');
  el.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:10px 16px',
    'background:linear-gradient(135deg,#1a1a2e,#16213e)',
    'border:2px solid #FFD700',
    'border-radius:10px',
    'box-shadow:0 4px 20px rgba(255,215,0,0.3),inset 0 0 20px rgba(255,215,0,0.05)',
    'transform:translateX(120%)',
    'transition:transform 0.4s cubic-bezier(0.175,0.885,0.32,1.275),opacity 0.3s',
    'opacity:0',
    'pointer-events:auto',
    'min-width:220px'
  ].join(';');

  // Badge icon canvas
  const iconCanvas = document.createElement('canvas');
  iconCanvas.width = 40;
  iconCanvas.height = 40;
  iconCanvas.style.cssText = 'width:40px;height:40px;flex-shrink:0';
  const iconCtx = iconCanvas.getContext('2d');

  // Draw circular background
  iconCtx.fillStyle = '#2a2a4a';
  iconCtx.beginPath();
  iconCtx.arc(20, 20, 18, 0, Math.PI * 2);
  iconCtx.fill();
  iconCtx.strokeStyle = badge.color;
  iconCtx.lineWidth = 2;
  iconCtx.stroke();

  // Draw icon
  drawIcon(iconCtx, badge.icon, 20, 20, 18, badge.color);

  // Text section
  const textDiv = document.createElement('div');
  textDiv.innerHTML = '<div style="color:#FFD700;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">Badge Unlocked!</div>' +
    '<div style="color:#fff;font-size:14px;font-weight:bold;margin-top:2px">' + badge.name + '</div>' +
    '<div style="color:#aaa;font-size:11px;margin-top:1px">' + badge.desc + '</div>';

  el.appendChild(iconCanvas);
  el.appendChild(textDiv);
  container.appendChild(el);

  // Animate in
  requestAnimationFrame(function() {
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  });

  // Particle burst after slide-in
  setTimeout(function() {
    const rect = iconCanvas.getBoundingClientRect();
    spawnBurstAt(rect.left + 20, rect.top + 20, document.body);
    playBadgeSound();
  }, 400);

  // Fade out after 3s
  setTimeout(function() {
    el.style.transform = 'translateX(120%)';
    el.style.opacity = '0';
    setTimeout(function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 400);
  }, 3500);
}

// ============================================================
// BADGE BAR (toggleable overlay)
// ============================================================
let badgeBar = null;
let badgeGrid = null;
let barExpanded = false;

function renderBadgeBar(container) {
  if (!container) {
    container = document.body;
  }

  // Remove old bar if re-rendered
  if (badgeBar && badgeBar.parentNode) {
    badgeBar.parentNode.removeChild(badgeBar);
  }

  badgeBar = document.createElement('div');
  badgeBar.id = 'tasern-badge-bar';
  badgeBar.style.cssText = [
    'position:fixed',
    'bottom:12px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'gap:4px',
    'padding:6px 12px',
    'background:rgba(26,26,46,0.92)',
    'border:1px solid rgba(255,215,0,0.3)',
    'border-radius:24px',
    'backdrop-filter:blur(8px)',
    'cursor:pointer',
    'transition:all 0.3s ease',
    'font-family:"Segoe UI",Arial,sans-serif'
  ].join(';');

  // Render small badge circles
  const earned = state.badges_earned;
  BADGES.forEach(function(badge) {
    const dot = document.createElement('canvas');
    dot.width = 24;
    dot.height = 24;
    dot.style.cssText = 'width:24px;height:24px;border-radius:50%;';
    const dCtx = dot.getContext('2d');
    const isEarned = earned.indexOf(badge.id) !== -1;

    dCtx.fillStyle = isEarned ? '#2a2a4a' : '#1a1a2e';
    dCtx.beginPath();
    dCtx.arc(12, 12, 11, 0, Math.PI * 2);
    dCtx.fill();

    dCtx.strokeStyle = isEarned ? badge.color : '#444';
    dCtx.lineWidth = 1.5;
    dCtx.beginPath();
    dCtx.arc(12, 12, 11, 0, Math.PI * 2);
    dCtx.stroke();

    if (isEarned) {
      drawIcon(dCtx, badge.icon, 12, 12, 10, badge.color);
    } else {
      dCtx.fillStyle = '#333';
      dCtx.beginPath();
      dCtx.arc(12, 12, 4, 0, Math.PI * 2);
      dCtx.fill();
    }

    dot.title = badge.name + (isEarned ? ' (earned)' : ' (locked)');
    badgeBar.appendChild(dot);
  });

  // Counter label
  const counter = document.createElement('span');
  counter.style.cssText = 'color:#FFD700;font-size:11px;font-weight:bold;margin-left:6px;white-space:nowrap';
  counter.textContent = earned.length + '/' + BADGES.length;
  badgeBar.appendChild(counter);

  // Click to expand
  badgeBar.addEventListener('click', function() {
    toggleBadgeGrid();
  });

  container.appendChild(badgeBar);
}

function toggleBadgeGrid() {
  if (barExpanded && badgeGrid && badgeGrid.parentNode) {
    badgeGrid.style.opacity = '0';
    badgeGrid.style.transform = 'translate(-50%, 20px)';
    setTimeout(function() {
      if (badgeGrid && badgeGrid.parentNode) badgeGrid.parentNode.removeChild(badgeGrid);
      badgeGrid = null;
    }, 300);
    barExpanded = false;
    return;
  }

  barExpanded = true;
  badgeGrid = document.createElement('div');
  badgeGrid.style.cssText = [
    'position:fixed',
    'bottom:60px',
    'left:50%',
    'transform:translate(-50%, 20px)',
    'z-index:99998',
    'display:grid',
    'grid-template-columns:repeat(5,1fr)',
    'gap:8px',
    'padding:16px',
    'background:rgba(26,26,46,0.96)',
    'border:1px solid rgba(255,215,0,0.4)',
    'border-radius:12px',
    'backdrop-filter:blur(12px)',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    'max-width:420px',
    'width:90vw',
    'opacity:0',
    'transition:opacity 0.3s ease,transform 0.3s ease',
    'font-family:"Segoe UI",Arial,sans-serif'
  ].join(';');

  const earned = state.badges_earned;

  BADGES.forEach(function(badge) {
    const cell = document.createElement('div');
    const isEarned = earned.indexOf(badge.id) !== -1;
    cell.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'gap:4px',
      'padding:8px 4px',
      'border-radius:8px',
      'background:' + (isEarned ? 'rgba(255,215,0,0.08)' : 'transparent'),
      'transition:background 0.2s'
    ].join(';');

    const iconCanvas = document.createElement('canvas');
    iconCanvas.width = 40;
    iconCanvas.height = 40;
    iconCanvas.style.cssText = 'width:40px;height:40px';
    const iconCtx = iconCanvas.getContext('2d');

    iconCtx.fillStyle = isEarned ? '#2a2a4a' : '#1a1a2e';
    iconCtx.beginPath();
    iconCtx.arc(20, 20, 18, 0, Math.PI * 2);
    iconCtx.fill();

    iconCtx.strokeStyle = isEarned ? badge.color : '#333';
    iconCtx.lineWidth = 2;
    iconCtx.beginPath();
    iconCtx.arc(20, 20, 18, 0, Math.PI * 2);
    iconCtx.stroke();

    if (isEarned) {
      drawIcon(iconCtx, badge.icon, 20, 20, 16, badge.color);
    } else {
      iconCtx.fillStyle = '#222';
      iconCtx.font = 'bold 14px sans-serif';
      iconCtx.textAlign = 'center';
      iconCtx.textBaseline = 'middle';
      iconCtx.fillText('?', 20, 21);
    }

    const label = document.createElement('div');
    label.style.cssText = 'color:' + (isEarned ? '#fff' : '#555') + ';font-size:9px;text-align:center;line-height:1.2';
    label.textContent = isEarned ? badge.name : '???';

    cell.appendChild(iconCanvas);
    cell.appendChild(label);

    if (isEarned) {
      const time = state.timestamps[badge.id];
      if (time) {
        const date = document.createElement('div');
        date.style.cssText = 'color:#666;font-size:8px';
        date.textContent = new Date(time).toLocaleDateString();
        cell.appendChild(date);
      }
    }

    badgeGrid.appendChild(cell);
  });

  document.body.appendChild(badgeGrid);

  requestAnimationFrame(function() {
    badgeGrid.style.opacity = '1';
    badgeGrid.style.transform = 'translate(-50%, 0)';
  });
}

// ============================================================
// BADGE EVALUATION ENGINE
// ============================================================
function evaluateBadges() {
  const newBadges = [];

  function award(id) {
    if (state.badges_earned.indexOf(id) === -1) {
      state.badges_earned.push(id);
      state.timestamps[id] = Date.now();
      newBadges.push(id);
    }
  }

  const gamesCount = state.games_played.length;
  const genresCount = state.genres_played.length;
  const totalTime = state.total_time_ms;

  // 1. First Steps
  if (gamesCount >= 1) award('first_steps');

  // 2. Explorer
  if (gamesCount >= 5) award('explorer');

  // 3. Adventurer
  if (gamesCount >= 10) award('adventurer');

  // 4. Veteran
  if (gamesCount >= 25) award('veteran');

  // 5. Completionist
  if (gamesCount >= 100) award('completionist');

  // 6. High Scorer
  const scores = state.scores;
  let hasHighScore = false;
  Object.keys(scores).forEach(function(game) {
    if (scores[game] > 0) hasHighScore = true;
  });
  if (hasHighScore) award('high_scorer');

  // 7. Combo King
  if (state.achievements['combo_10']) award('combo_king');

  // 8. Survivor
  if (state.achievements['survive_10_waves']) award('survivor');

  // 9. Speed Demon
  if (state.achievements['racing_complete']) award('speed_demon');

  // 10. Puzzle Master
  if (state.achievements['puzzle_complete']) award('puzzle_master');

  // 11. Boss Slayer
  if (state.achievements['boss_defeated']) award('boss_slayer');

  // 12. Streak
  if (state.session_games.length >= 3) award('streak');

  // 13. Genre Hopper
  if (genresCount >= 5) award('genre_hopper');

  // 14. Arcade Rat (1 hour = 3,600,000 ms)
  if (totalTime >= 3600000) award('arcade_rat');

  // 15. Pinball Wizard
  if (state.achievements['pinball_100k']) award('pinball_wizard');

  // 16. Quest Complete
  if (state.achievements['quest_finished']) award('quest_complete');

  // 17. Champion
  if (state.achievements['season_won']) award('champion');

  // 18. Rhythm Master
  if (state.achievements['rhythm_s_rank']) award('rhythm_master');

  // 19. Builder
  if (state.achievements['towers_10']) award('builder_badge');

  // 20. Legend (15+ other badges, not counting legend itself)
  const otherBadges = state.badges_earned.filter(function(b) { return b !== 'legend'; });
  if (otherBadges.length >= 15) award('legend');

  // Save and notify
  if (newBadges.length > 0) {
    saveState(state);

    // Show notifications with staggered delay
    newBadges.forEach(function(badgeId, idx) {
      const badge = BADGES.find(function(b) { return b.id === badgeId; });
      if (badge) {
        setTimeout(function() { showNotification(badge); }, idx * 500);
      }
    });

    // Re-render badge bar if it exists
    if (badgeBar && badgeBar.parentNode) {
      const parent = badgeBar.parentNode;
      renderBadgeBar(parent);
    }
  }

  return newBadges;
}

// ============================================================
// TIME TRACKING
// ============================================================
let timeTrackInterval = null;

function startTimeTracking() {
  if (timeTrackInterval) return;
  const startMs = Date.now();
  timeTrackInterval = setInterval(function() {
    state.total_time_ms += 1000;
    // Check arcade_rat every 10s
    if (state.total_time_ms % 10000 === 0) {
      evaluateBadges();
      saveState(state);
    }
  }, 1000);

  // Save on page hide
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      saveState(state);
    }
  });

  window.addEventListener('beforeunload', function() {
    saveState(state);
  });
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Track that a game was played. Call once per game session start.
 * @param {string} gameName - unique game identifier (e.g., 'tasern-pinball')
 * @param {string} [genre] - genre category (e.g., 'puzzle', 'racing', 'shooter')
 */
function trackPlay(gameName, genre) {
  if (!gameName) return;

  gameName = gameName.toLowerCase().trim();

  // Add to unique games played
  if (state.games_played.indexOf(gameName) === -1) {
    state.games_played.push(gameName);
  }

  // Track genre
  if (genre) {
    genre = genre.toLowerCase().trim();
    if (state.genres_played.indexOf(genre) === -1) {
      state.genres_played.push(genre);
    }
  }

  // Track session streak
  if (!state.session_start || (Date.now() - state.session_start > 3600000)) {
    // New session if more than 1 hour gap
    state.session_games = [];
    state.session_start = Date.now();
  }
  if (state.session_games.indexOf(gameName) === -1) {
    state.session_games.push(gameName);
  }

  saveState(state);
  evaluateBadges();
}

/**
 * Track a score for a game.
 * @param {string} gameName
 * @param {number} score
 */
function trackScore(gameName, score) {
  if (!gameName || typeof score !== 'number') return;
  gameName = gameName.toLowerCase().trim();

  if (!state.scores[gameName] || score > state.scores[gameName]) {
    state.scores[gameName] = score;
  }

  // Check specific game thresholds
  if (gameName === 'tasern-pinball' && score >= 100000) {
    state.achievements['pinball_100k'] = true;
  }

  saveState(state);
  evaluateBadges();
}

/**
 * Track a specific achievement. Games call this for custom milestones.
 * @param {string} gameName
 * @param {string} achievementKey - one of:
 *   'combo_10', 'survive_10_waves', 'racing_complete', 'puzzle_complete',
 *   'boss_defeated', 'pinball_100k', 'quest_finished', 'season_won',
 *   'rhythm_s_rank', 'towers_10'
 */
function trackAchievement(gameName, achievementKey) {
  if (!achievementKey) return;
  achievementKey = achievementKey.toLowerCase().trim();

  state.achievements[achievementKey] = true;

  saveState(state);
  evaluateBadges();
}

/**
 * Get all badge definitions with earned status.
 * @returns {Array} badges with isEarned boolean
 */
function getBadges() {
  return BADGES.map(function(badge) {
    return {
      id: badge.id,
      name: badge.name,
      desc: badge.desc,
      icon: badge.icon,
      color: badge.color,
      isEarned: state.badges_earned.indexOf(badge.id) !== -1,
      earnedAt: state.timestamps[badge.id] || null
    };
  });
}

/**
 * Get raw state (for debugging/display).
 */
function getState() {
  return JSON.parse(JSON.stringify(state));
}

// ============================================================
// AUTO-INITIALIZATION
// ============================================================
function detectCurrentGame() {
  // Try URL path first
  const path = window.location.pathname;
  const match = path.match(/games\/([^/]+)/);
  if (match) return match[1].replace(/\.html$/, '').replace(/[_\s]+/g, '-');

  // Try page title
  const title = document.title;
  if (title) return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return 'unknown-game';
}

function autoInit() {
  startTimeTracking();

  // Auto-track current game play
  const currentGame = detectCurrentGame();
  if (currentGame && currentGame !== 'unknown-game') {
    // Detect genre from meta tag if present
    let genre = null;
    const metaGenre = document.querySelector('meta[name="game-genre"]');
    if (metaGenre) {
      genre = metaGenre.getAttribute('content');
    }
    trackPlay(currentGame, genre);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}

// ============================================================
// EXPORT
// ============================================================
return {
  trackPlay: trackPlay,
  trackScore: trackScore,
  trackAchievement: trackAchievement,
  showNotification: showNotification,
  renderBadgeBar: renderBadgeBar,
  getBadges: getBadges,
  getState: getState,
  BADGES: BADGES
};

})();
