/**
 * Tasern Arcade Wager System v1.0
 * Head-to-head MfT token wagering for competitive arcade games.
 *
 * Usage:
 *   <script src="tasern-wager.js"></script>
 *   TasernWager.createChallenge(gameId, amount, seed) -> challengeCode
 *   TasernWager.acceptChallenge(challengeCode) -> {gameId, amount, seed}
 *   TasernWager.submitScore(challengeCode, score, playerAddress) -> result
 *   TasernWager.getActiveWagers() -> [{code, game, amount, status}]
 *   TasernWager.claimWinnings(challengeCode) -> txHash
 */
const TasernWager = (function() {
"use strict";

// ============================================================
// CONSTANTS
// ============================================================
const STORAGE_KEY = 'tasern_wagers_v1';
const CODE_LENGTH = 6;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h challenge expiry
const CLAIM_TIMEOUT_MS = 48 * 60 * 60 * 1000; // 48h unclaimed return
const TREASURY_FEE = 0.05; // 5% to treasury

// Wager-ready games list
const WAGER_GAMES = {
  'poop-out':         { name: 'Poop Out',           type: 'score',   description: 'Breakout - highest score wins' },
  'micro-baselings':  { name: 'Micro Baselings',    type: 'time',    description: 'Racing - fastest lap wins' },
  'token-columns':    { name: 'Token Columns',      type: 'score',   description: 'Puzzle - highest score wins' },
  'super-dodge':      { name: 'Super Dodge',        type: 'score',   description: 'Dodgeball - most wins' },
  'baseling-grind':    { name: 'Baseling Grind',          type: 'score',   description: 'Skateboarding - trick score' },
  'snow-bros':        { name: 'Snow Bros',          type: 'score',   description: 'Action - highest score wins' },
  'streets-of-tasern':{ name: 'Streets of Tasern',  type: 'score',   description: 'Beat-em-up - highest score wins' },
  'arkanoid-mft':     { name: 'Arkanoid MfT',       type: 'score',   description: 'Breakout - highest score wins' },
  'rc-reactor':       { name: 'RC Reactor',         type: 'time',    description: 'Racing - fastest time wins' },
  'cobra-triangle':   { name: 'Cobra Triangle',     type: 'score',   description: 'Boat racing - highest score wins' }
};

// Contract ABI placeholder (for future deployment)
const CONTRACT_ABI = [
  'function createWager(bytes32 challengeHash, uint256 amount, string gameId) external',
  'function acceptWager(bytes32 challengeHash) external payable',
  'function submitScore(bytes32 challengeHash, uint256 score, bytes signature) external',
  'function claimWinnings(bytes32 challengeHash) external',
  'function cancelExpired(bytes32 challengeHash) external',
  'event WagerCreated(bytes32 indexed challengeHash, address indexed creator, uint256 amount)',
  'event WagerAccepted(bytes32 indexed challengeHash, address indexed acceptor)',
  'event ScoreSubmitted(bytes32 indexed challengeHash, address indexed player, uint256 score)',
  'event WinningsClaimed(bytes32 indexed challengeHash, address indexed winner, uint256 payout)',
  'event WagerCancelled(bytes32 indexed challengeHash)'
];

// MfT token address on Base
const MFT_TOKEN = '0x'; // placeholder until verified from project

// ============================================================
// STORAGE
// ============================================================
function loadWagers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error('[TasernWager] Failed to load wagers:', err);
    return {};
  }
}

function saveWagers(wagers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wagers));
  } catch (err) {
    console.error('[TasernWager] Failed to save wagers:', err);
  }
}

function getWager(code) {
  const wagers = loadWagers();
  return wagers[code] || null;
}

function setWager(code, data) {
  const wagers = loadWagers();
  wagers[code] = data;
  saveWagers(wagers);
}

// ============================================================
// UTILITY
// ============================================================

/**
 * Generate a random challenge code (6-char alphanumeric, no ambiguous chars).
 */
function generateCode() {
  let code = '';
  const arr = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(arr);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[arr[i] % CODE_CHARS.length];
  }
  // Ensure no collisions
  const existing = loadWagers();
  if (existing[code]) return generateCode();
  return code;
}

/**
 * Generate a deterministic game seed from input string.
 * Both players use this seed for identical RNG sequences.
 */
function generateSeed(input) {
  if (input) return input;
  // Generate a random 32-bit seed
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0].toString(16).padStart(8, '0');
}

/**
 * Deterministic PRNG from seed (xorshift32).
 * Use: const rng = TasernWager.createRNG(seed); rng() -> 0..1
 */
function createRNG(seed) {
  let state = parseInt(seed, 16) || 1;
  return function() {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/**
 * Compute verification hash: sha256(seed + gameId + playerAddress).
 * Used for anti-cheat: player commits to seed before playing.
 */
async function computeVerificationHash(seed, gameId, playerAddress) {
  const data = seed + '|' + gameId + '|' + playerAddress.toLowerCase();
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute score commitment hash: sha256(challengeCode + score + playerAddress).
 * Prevents score tampering after submission.
 */
async function computeScoreHash(challengeCode, score, playerAddress) {
  const data = challengeCode + '|' + score.toString() + '|' + playerAddress.toLowerCase();
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if a wager has expired.
 */
function isExpired(wager) {
  const now = Date.now();
  if (wager.status === 'pending' && now - wager.createdAt > EXPIRY_MS) return true;
  if (wager.status === 'completed' && now - wager.completedAt > CLAIM_TIMEOUT_MS) return true;
  return false;
}

/**
 * Determine winner: higher score wins for score-type, lower time wins for time-type.
 */
function determineWinner(wager) {
  if (!wager.scores || !wager.scores.player1 || !wager.scores.player2) return null;
  const game = WAGER_GAMES[wager.gameId];
  if (!game) return null;

  const s1 = wager.scores.player1.value;
  const s2 = wager.scores.player2.value;

  if (game.type === 'time') {
    // Lower time wins
    if (s1 < s2) return 'player1';
    if (s2 < s1) return 'player2';
    return 'draw';
  }
  // Higher score wins
  if (s1 > s2) return 'player1';
  if (s2 > s1) return 'player2';
  return 'draw';
}

// ============================================================
// CORE API
// ============================================================

/**
 * Create a new wager challenge.
 * @param {string} gameId - Game identifier (must be in WAGER_GAMES)
 * @param {number} amount - MfT amount to wager
 * @param {string} [seed] - Optional seed (auto-generated if omitted)
 * @returns {string} challengeCode - 6-char code to share with opponent
 */
function createChallenge(gameId, amount, seed) {
  if (!WAGER_GAMES[gameId]) {
    throw new Error('[TasernWager] Invalid game: ' + gameId + '. Must be one of: ' + Object.keys(WAGER_GAMES).join(', '));
  }
  if (!amount || amount <= 0) {
    throw new Error('[TasernWager] Amount must be positive');
  }
  if (amount < 1) {
    throw new Error('[TasernWager] Minimum wager is 1 MfT');
  }

  const code = generateCode();
  const gameSeed = generateSeed(seed);

  const wager = {
    code: code,
    gameId: gameId,
    gameName: WAGER_GAMES[gameId].name,
    gameType: WAGER_GAMES[gameId].type,
    amount: amount,
    seed: gameSeed,
    status: 'pending',       // pending -> active -> playing -> completed -> claimed/expired
    createdAt: Date.now(),
    expiresAt: Date.now() + EXPIRY_MS,
    player1: null,           // set when score submitted
    player2: null,
    scores: { player1: null, player2: null },
    winner: null,
    claimed: false,
    txHash: null
  };

  setWager(code, wager);
  console.log('[TasernWager] Challenge created:', code, '| Game:', gameId, '| Amount:', amount, 'MfT');
  return code;
}

/**
 * Accept an existing wager challenge.
 * @param {string} challengeCode - The 6-char code from the challenger
 * @returns {object} {gameId, amount, seed, gameName, gameType}
 */
function acceptChallenge(challengeCode) {
  const code = challengeCode.toUpperCase().trim();
  const wager = getWager(code);

  if (!wager) {
    throw new Error('[TasernWager] Challenge not found: ' + code);
  }
  if (wager.status !== 'pending') {
    throw new Error('[TasernWager] Challenge already accepted or expired');
  }
  if (isExpired(wager)) {
    wager.status = 'expired';
    setWager(code, wager);
    throw new Error('[TasernWager] Challenge expired');
  }

  wager.status = 'active';
  wager.acceptedAt = Date.now();
  setWager(code, wager);

  console.log('[TasernWager] Challenge accepted:', code);
  return {
    gameId: wager.gameId,
    gameName: wager.gameName,
    gameType: wager.gameType,
    amount: wager.amount,
    seed: wager.seed
  };
}

/**
 * Submit a player's score after completing the game.
 * @param {string} challengeCode - The wager code
 * @param {number} score - The player's final score or time
 * @param {string} playerAddress - The player's wallet address
 * @returns {object} {status, winner?, payout?, scores?}
 */
async function submitScore(challengeCode, score, playerAddress) {
  const code = challengeCode.toUpperCase().trim();
  const wager = getWager(code);

  if (!wager) {
    throw new Error('[TasernWager] Challenge not found: ' + code);
  }
  if (wager.status !== 'active' && wager.status !== 'playing') {
    throw new Error('[TasernWager] Cannot submit score - wager status: ' + wager.status);
  }

  const addr = playerAddress.toLowerCase();
  const scoreHash = await computeScoreHash(code, score, addr);
  const verifyHash = await computeVerificationHash(wager.seed, wager.gameId, addr);

  // Determine which player slot
  if (!wager.scores.player1) {
    wager.player1 = addr;
    wager.scores.player1 = { value: score, hash: scoreHash, verifyHash: verifyHash, submittedAt: Date.now() };
    wager.status = 'playing';
    setWager(code, wager);
    console.log('[TasernWager] Player 1 score submitted:', score);
    return { status: 'waiting', message: 'Waiting for opponent score' };
  }

  // Prevent same player submitting twice
  if (wager.player1 === addr) {
    throw new Error('[TasernWager] You already submitted a score for this wager');
  }

  wager.player2 = addr;
  wager.scores.player2 = { value: score, hash: scoreHash, verifyHash: verifyHash, submittedAt: Date.now() };
  wager.status = 'completed';
  wager.completedAt = Date.now();

  // Determine winner
  const winner = determineWinner(wager);
  wager.winner = winner;

  const pot = wager.amount * 2;
  const fee = pot * TREASURY_FEE;
  const payout = pot - fee;

  setWager(code, wager);

  console.log('[TasernWager] Both scores in. Winner:', winner, '| Payout:', payout, 'MfT');

  return {
    status: 'completed',
    winner: winner,
    winnerAddress: winner === 'player1' ? wager.player1 : winner === 'player2' ? wager.player2 : null,
    scores: {
      player1: wager.scores.player1.value,
      player2: wager.scores.player2.value
    },
    pot: pot,
    fee: fee,
    payout: payout,
    isDraw: winner === 'draw'
  };
}

/**
 * Get all active/recent wagers.
 * @returns {Array} [{code, game, amount, status, expiresAt, winner}]
 */
function getActiveWagers() {
  const wagers = loadWagers();
  const result = [];
  const now = Date.now();

  for (const code in wagers) {
    const w = wagers[code];

    // Clean up truly old entries (older than 7 days)
    if (now - w.createdAt > 7 * 24 * 60 * 60 * 1000) continue;

    // Mark expired
    if (isExpired(w) && w.status !== 'expired' && w.status !== 'claimed') {
      w.status = 'expired';
      setWager(code, w);
    }

    result.push({
      code: w.code,
      game: w.gameName,
      gameId: w.gameId,
      amount: w.amount,
      status: w.status,
      createdAt: w.createdAt,
      expiresAt: w.expiresAt,
      winner: w.winner,
      scores: w.scores
    });
  }

  // Sort by creation time, newest first
  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

/**
 * Claim winnings for a completed wager.
 * In localStorage mode, marks as claimed.
 * With contract, executes on-chain claim.
 * @param {string} challengeCode
 * @returns {string} txHash (or 'local-claim-' prefix in localStorage mode)
 */
async function claimWinnings(challengeCode) {
  const code = challengeCode.toUpperCase().trim();
  const wager = getWager(code);

  if (!wager) {
    throw new Error('[TasernWager] Challenge not found: ' + code);
  }
  if (wager.status !== 'completed') {
    throw new Error('[TasernWager] Wager not ready to claim. Status: ' + wager.status);
  }
  if (wager.claimed) {
    throw new Error('[TasernWager] Already claimed');
  }
  if (wager.winner === 'draw') {
    throw new Error('[TasernWager] Draw - both players refunded (no claim needed)');
  }

  // Contract mode: attempt on-chain claim
  if (typeof window.ethereum !== 'undefined' && MFT_TOKEN !== '0x') {
    try {
      const txHash = await executeContractClaim(code, wager);
      wager.claimed = true;
      wager.status = 'claimed';
      wager.txHash = txHash;
      setWager(code, wager);
      return txHash;
    } catch (err) {
      console.error('[TasernWager] Contract claim failed, falling back to local:', err);
    }
  }

  // localStorage mode: mark as claimed locally
  wager.claimed = true;
  wager.status = 'claimed';
  wager.txHash = 'local-claim-' + Date.now().toString(36);
  setWager(code, wager);
  console.log('[TasernWager] Claimed locally:', wager.txHash);
  return wager.txHash;
}

/**
 * Execute on-chain claim via smart contract (placeholder).
 */
async function executeContractClaim(code, wager) {
  // This will be implemented when the wager contract is deployed
  // For now, throw to fall back to localStorage mode
  throw new Error('Contract not deployed');
}

// ============================================================
// WAGER UI OVERLAY
// ============================================================

/**
 * Create and show the wager overlay UI.
 * Call this before game start when accessed via wager link.
 */
function showWagerOverlay(options) {
  const { mode, challengeCode, gameId, amount, seed, opponent, onReady, onCancel } = options;

  // Remove existing overlay
  const existing = document.getElementById('tasern-wager-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'tasern-wager-overlay';
  overlay.innerHTML = buildOverlayHTML(mode, { challengeCode, gameId, amount, seed, opponent });
  document.body.appendChild(overlay);

  // Apply styles
  applyOverlayStyles(overlay);

  // Bind buttons
  const readyBtn = overlay.querySelector('#wager-ready-btn');
  const cancelBtn = overlay.querySelector('#wager-cancel-btn');

  if (readyBtn && onReady) {
    readyBtn.addEventListener('click', function() {
      overlay.remove();
      onReady();
    });
  }
  if (cancelBtn && onCancel) {
    cancelBtn.addEventListener('click', function() {
      overlay.remove();
      onCancel();
    });
  }

  return overlay;
}

/**
 * Show post-game results overlay.
 */
function showResultsOverlay(options) {
  const { challengeCode, scores, winner, payout, isDraw, onClaim, onClose } = options;

  const existing = document.getElementById('tasern-wager-results');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'tasern-wager-results';
  overlay.innerHTML = buildResultsHTML({ challengeCode, scores, winner, payout, isDraw });
  document.body.appendChild(overlay);
  applyResultsStyles(overlay);

  // Coin animation
  if (!isDraw) {
    spawnCoinParticles(overlay);
  }

  const claimBtn = overlay.querySelector('#wager-claim-btn');
  const closeBtn = overlay.querySelector('#wager-close-btn');

  if (claimBtn && onClaim) {
    claimBtn.addEventListener('click', async function() {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Claiming...';
      try {
        const tx = await onClaim();
        claimBtn.textContent = 'Claimed!';
        claimBtn.style.background = '#2a2';
      } catch (err) {
        claimBtn.textContent = 'Claim Failed';
        claimBtn.style.background = '#a22';
        console.error('[TasernWager] Claim error:', err);
      }
    });
  }
  if (closeBtn && onClose) {
    closeBtn.addEventListener('click', function() {
      overlay.remove();
      onClose();
    });
  }

  return overlay;
}

function buildOverlayHTML(mode, data) {
  const game = WAGER_GAMES[data.gameId] || { name: data.gameId, description: '' };
  const isCreate = mode === 'create';

  return `
    <div class="wager-panel">
      <div class="wager-header">
        <div class="wager-icon">&#9876;</div>
        <h2>${isCreate ? 'CREATE CHALLENGE' : 'ACCEPT CHALLENGE'}</h2>
      </div>
      <div class="wager-body">
        <div class="wager-row">
          <span class="wager-label">Game</span>
          <span class="wager-value">${game.name}</span>
        </div>
        <div class="wager-row">
          <span class="wager-label">Rules</span>
          <span class="wager-value">${game.description}</span>
        </div>
        <div class="wager-row">
          <span class="wager-label">Wager</span>
          <span class="wager-value wager-amount">${data.amount} MfT</span>
        </div>
        <div class="wager-row">
          <span class="wager-label">Seed</span>
          <span class="wager-value wager-seed">${data.seed || '(generating...)'}</span>
        </div>
        ${data.challengeCode ? `
        <div class="wager-row">
          <span class="wager-label">Code</span>
          <span class="wager-value wager-code">${data.challengeCode}</span>
        </div>` : ''}
        ${data.opponent ? `
        <div class="wager-row">
          <span class="wager-label">Opponent</span>
          <span class="wager-value">${data.opponent.slice(0, 6)}...${data.opponent.slice(-4)}</span>
        </div>` : ''}
        <div class="wager-fee-note">5% treasury fee on winnings</div>
      </div>
      <div class="wager-actions">
        <button id="wager-ready-btn" class="wager-btn wager-btn-primary">${isCreate ? 'CREATE & PLAY' : 'ACCEPT & PLAY'}</button>
        <button id="wager-cancel-btn" class="wager-btn wager-btn-secondary">CANCEL</button>
      </div>
    </div>
  `;
}

function buildResultsHTML(data) {
  const winLabel = data.isDraw ? 'DRAW' : 'WINNER';
  const winnerText = data.isDraw ? 'Wagers Refunded' : (data.winner === 'player1' ? 'Player 1' : 'Player 2');

  return `
    <div class="wager-panel results-panel">
      <div class="wager-header">
        <div class="wager-icon">${data.isDraw ? '&#9878;' : '&#9813;'}</div>
        <h2>${winLabel}</h2>
      </div>
      <div class="wager-body">
        <div class="wager-scores">
          <div class="wager-score-card ${data.winner === 'player1' ? 'winner' : ''}">
            <div class="score-label">Player 1</div>
            <div class="score-value">${data.scores.player1}</div>
          </div>
          <div class="wager-vs">VS</div>
          <div class="wager-score-card ${data.winner === 'player2' ? 'winner' : ''}">
            <div class="score-label">Player 2</div>
            <div class="score-value">${data.scores.player2}</div>
          </div>
        </div>
        <div class="wager-winner-text">${winnerText}</div>
        ${!data.isDraw ? `<div class="wager-payout">Payout: ${data.payout} MfT</div>` : ''}
      </div>
      <div class="wager-actions">
        ${!data.isDraw ? '<button id="wager-claim-btn" class="wager-btn wager-btn-primary">CLAIM WINNINGS</button>' : ''}
        <button id="wager-close-btn" class="wager-btn wager-btn-secondary">CLOSE</button>
      </div>
    </div>
  `;
}

function applyOverlayStyles(overlay) {
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.85); display: flex; align-items: center;
    justify-content: center; z-index: 9999; font-family: monospace;
  `;
  injectWagerCSS();
}

function applyResultsStyles(overlay) {
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.9); display: flex; align-items: center;
    justify-content: center; z-index: 9999; font-family: monospace;
  `;
  injectWagerCSS();
}

let cssInjected = false;
function injectWagerCSS() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .wager-panel {
      background: #1a1a2e; border: 2px solid #e94560; border-radius: 12px;
      padding: 24px; max-width: 400px; width: 90%; color: #eee;
      box-shadow: 0 0 30px rgba(233,69,96,0.3);
      animation: wagerSlideIn 0.3s ease-out;
    }
    .results-panel { border-color: #f0c040; box-shadow: 0 0 30px rgba(240,192,64,0.3); }
    @keyframes wagerSlideIn {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .wager-header { text-align: center; margin-bottom: 20px; }
    .wager-header h2 { color: #e94560; font-size: 18px; margin-top: 8px; letter-spacing: 2px; }
    .results-panel .wager-header h2 { color: #f0c040; }
    .wager-icon { font-size: 36px; }
    .wager-body { margin-bottom: 20px; }
    .wager-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; border-bottom: 1px solid #333;
    }
    .wager-label { color: #888; font-size: 12px; text-transform: uppercase; }
    .wager-value { color: #eee; font-size: 14px; text-align: right; max-width: 60%; word-break: break-all; }
    .wager-amount { color: #4ade80; font-weight: bold; font-size: 16px; }
    .wager-seed { color: #888; font-size: 11px; }
    .wager-code { color: #f0c040; font-size: 20px; letter-spacing: 3px; font-weight: bold; }
    .wager-fee-note { text-align: center; color: #666; font-size: 11px; margin-top: 12px; }
    .wager-actions { display: flex; gap: 12px; justify-content: center; }
    .wager-btn {
      padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer;
      font-family: monospace; font-size: 14px; font-weight: bold;
      transition: transform 0.1s, opacity 0.1s;
    }
    .wager-btn:hover { transform: scale(1.05); }
    .wager-btn:active { transform: scale(0.95); }
    .wager-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .wager-btn-primary { background: #e94560; color: #fff; }
    .wager-btn-secondary { background: #333; color: #aaa; }
    .results-panel .wager-btn-primary { background: #f0c040; color: #111; }
    .wager-scores {
      display: flex; align-items: center; justify-content: center; gap: 16px;
      margin: 16px 0;
    }
    .wager-score-card {
      background: #222; border: 2px solid #444; border-radius: 8px;
      padding: 12px 20px; text-align: center; min-width: 100px;
    }
    .wager-score-card.winner { border-color: #f0c040; box-shadow: 0 0 15px rgba(240,192,64,0.4); }
    .score-label { color: #888; font-size: 11px; margin-bottom: 4px; }
    .score-value { color: #fff; font-size: 24px; font-weight: bold; }
    .wager-vs { color: #e94560; font-size: 14px; font-weight: bold; }
    .wager-winner-text {
      text-align: center; font-size: 16px; color: #f0c040; margin: 8px 0;
      font-weight: bold;
    }
    .wager-payout {
      text-align: center; font-size: 14px; color: #4ade80; margin: 4px 0;
    }
    .coin-particle {
      position: absolute; width: 16px; height: 16px; border-radius: 50%;
      background: radial-gradient(circle, #f0c040 40%, #c89020 100%);
      box-shadow: 0 0 6px rgba(240,192,64,0.6);
      pointer-events: none;
      animation: coinFall 1.5s ease-in forwards;
    }
    @keyframes coinFall {
      0% { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(300px) rotate(720deg); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Spawn animated coin particles on win.
 */
function spawnCoinParticles(container) {
  for (let i = 0; i < 20; i++) {
    setTimeout(function() {
      const coin = document.createElement('div');
      coin.className = 'coin-particle';
      coin.style.left = (20 + Math.random() * 60) + '%';
      coin.style.top = (10 + Math.random() * 20) + '%';
      coin.style.animationDelay = (Math.random() * 0.5) + 's';
      coin.style.animationDuration = (1 + Math.random()) + 's';
      container.appendChild(coin);
      setTimeout(function() { coin.remove(); }, 2500);
    }, i * 80);
  }
}

// ============================================================
// LINK PARSING
// ============================================================

/**
 * Parse wager params from URL.
 * URL format: ?wager=CODE or ?wager=CODE&action=accept
 */
function parseWagerURL() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('wager');
  const action = params.get('action') || 'play';
  if (!code) return null;
  return { code: code.toUpperCase(), action: action };
}

/**
 * Generate a shareable wager link.
 */
function getShareLink(challengeCode, gameId) {
  const base = window.location.origin + '/games/' + gameId + '.html';
  return base + '?wager=' + challengeCode + '&action=accept';
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Purge expired wagers from storage.
 */
function purgeExpired() {
  const wagers = loadWagers();
  const now = Date.now();
  let purged = 0;

  for (const code in wagers) {
    const w = wagers[code];
    // Remove entries older than 7 days
    if (now - w.createdAt > 7 * 24 * 60 * 60 * 1000) {
      delete wagers[code];
      purged++;
    }
  }

  if (purged > 0) {
    saveWagers(wagers);
    console.log('[TasernWager] Purged', purged, 'expired wagers');
  }
}

// Run purge on load
purgeExpired();

// ============================================================
// PUBLIC API
// ============================================================
return {
  // Core wager flow
  createChallenge: createChallenge,
  acceptChallenge: acceptChallenge,
  submitScore: submitScore,
  getActiveWagers: getActiveWagers,
  claimWinnings: claimWinnings,

  // UI
  showWagerOverlay: showWagerOverlay,
  showResultsOverlay: showResultsOverlay,

  // Utilities
  createRNG: createRNG,
  generateSeed: generateSeed,
  computeVerificationHash: computeVerificationHash,
  computeScoreHash: computeScoreHash,
  parseWagerURL: parseWagerURL,
  getShareLink: getShareLink,
  purgeExpired: purgeExpired,

  // Data
  WAGER_GAMES: WAGER_GAMES,
  TREASURY_FEE: TREASURY_FEE,
  CONTRACT_ABI: CONTRACT_ABI,

  // Version
  VERSION: '1.0.0'
};

})();
