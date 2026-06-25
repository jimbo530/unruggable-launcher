// @ts-check
/**
 * header.js — persistent in-game GOLD HUD, injected on EVERY game page.
 * Shows the player's gold (the one in-game currency) + a "Buy Gold" exchange
 * (USDC -> Money -> GOLD at market). Include once per page:
 *   <script type="module" src="../shared/header.js"></script>
 * Self-loads ethers if the page didn't already. Non-intrusive fixed top-right HUD.
 */
import * as Gold from './gold.js';

const ETHERS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.2/ethers.umd.min.js';
function ensureEthers() {
  if (window.ethers) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = ETHERS_CDN; s.onload = () => res(); s.onerror = () => rej(new Error('ethers load failed'));
    document.head.appendChild(s);
  });
}

const BAR_H = 46;
const CSS = `
  #goldhud{position:fixed;top:0;left:0;right:0;height:${BAR_H}px;z-index:9999;display:flex;gap:8px;align-items:center;justify-content:flex-end;
    padding:0 14px;font-family:"Segoe UI",system-ui,sans-serif;
    background:linear-gradient(180deg,#14100a,rgba(20,16,10,.90));border-bottom:1px solid #4a3a22;
    -webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);box-shadow:0 2px 12px rgba(0,0,0,.45)}
  #goldhud .brand{margin-right:auto;color:#caa45a;font-size:13px;letter-spacing:1px;font-weight:700;text-transform:uppercase;opacity:.9}
  #goldhud .pill{background:linear-gradient(#211810,#14100a);border:1px solid #4a3a22;border-radius:999px;padding:6px 13px;color:#e6b422;font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px}
  #goldhud button{cursor:pointer;border-radius:999px;border:1px solid #2ecc71;background:#2a5a2f;color:#eafff0;font-size:12px;font-weight:700;padding:6px 13px}
  #goldhud button:hover{background:#357039}
  #goldhud .ghost{background:#241a10;border-color:#4a3a22;color:#caa45a}
  #goldmodal{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;background:rgba(6,9,12,.72)}
  #goldmodal .box{background:linear-gradient(#1d160d,#120c06);border:1px solid #4a3a22;border-radius:16px;padding:20px;width:320px;color:#f3ead7;font-family:"Segoe UI",system-ui,sans-serif}
  #goldmodal h3{margin:0 0 4px;color:#e6b422;letter-spacing:1px}
  #goldmodal p{margin:0 0 12px;color:#b6a584;font-size:12px;line-height:1.5}
  #goldmodal input{width:100%;box-sizing:border-box;padding:10px;border-radius:9px;border:1px solid #4a3a22;background:#0e0a05;color:#f3ead7;font-size:16px}
  #goldmodal .est{color:#e6b422;font-size:13px;margin:8px 0 14px;min-height:18px}
  #goldmodal .act{display:flex;gap:8px}
  #goldmodal .act button{flex:1;cursor:pointer;border-radius:9px;padding:10px;font-weight:700;font-size:13px}
  #goldmodal .buy{background:#2a5a2f;border:1px solid #2ecc71;color:#eafff0}
  #goldmodal .cancel{background:#241a10;border:1px solid #4a3a22;color:#caa45a}
  #goldmodal .status{margin-top:10px;font-size:12px;color:#b6a584;min-height:16px}
`;

let hud, modal, estEl, statusEl, inputEl, balEl;

function injectUI() {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  hud = document.createElement('div'); hud.id = 'goldhud';
  hud.innerHTML = `<span class="brand">🏴‍☠️ Seize the Seas</span>
    <div class="pill">🪙 <span id="goldbal">—</span></div>
    <button id="goldbuy">Buy Gold</button>`;
  document.body.appendChild(hud);
  balEl = hud.querySelector('#goldbal');

  // push page content below the fixed bar (keep each page's own top padding)
  const cur = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  document.body.style.paddingTop = (cur + BAR_H) + 'px';

  modal = document.createElement('div'); modal.id = 'goldmodal';
  modal.innerHTML = `<div class="box">
    <h3>🪙 Buy Gold</h3>
    <p>Top up with USDC at market price. Routes USDC → Money → Gold on Base.</p>
    <input id="goldusdc" type="number" min="0" step="0.5" placeholder="USDC amount" />
    <div class="est" id="goldest"></div>
    <div class="act"><button class="cancel" id="goldcancel">Cancel</button><button class="buy" id="goldgo">Buy</button></div>
    <div class="status" id="goldstatus"></div>
  </div>`;
  document.body.appendChild(modal);
  estEl = modal.querySelector('#goldest'); statusEl = modal.querySelector('#goldstatus'); inputEl = modal.querySelector('#goldusdc');

  hud.querySelector('#goldbuy').addEventListener('click', openModal);
  modal.querySelector('#goldcancel').addEventListener('click', () => { modal.style.display = 'none'; });
  modal.querySelector('#goldgo').addEventListener('click', doBuy);
  let t; inputEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(updateEst, 350); });
}

async function refreshBal() {
  try {
    if (!Gold.isConnected()) { balEl.textContent = 'connect'; return; }
    const b = await Gold.balances();
    balEl.textContent = Math.floor(b.gold).toLocaleString();
  } catch (_) { balEl.textContent = '—'; }
}

async function openModal() {
  modal.style.display = 'flex'; statusEl.textContent = ''; estEl.textContent = '';
  if (!Gold.isConnected()) {
    try { statusEl.textContent = 'Connecting…'; await Gold.connect(); statusEl.textContent = ''; refreshBal(); }
    catch (e) { statusEl.textContent = e.message; }
  }
}

async function updateEst() {
  const v = parseFloat(inputEl.value);
  if (!v || v <= 0) { estEl.textContent = ''; return; }
  try { const g = await Gold.quoteGoldForUsdc(v); estEl.textContent = `≈ ${Math.floor(g).toLocaleString()} gold`; }
  catch (e) { estEl.textContent = '(price unavailable)'; }
}

async function doBuy() {
  const v = parseFloat(inputEl.value);
  if (!v || v <= 0) { statusEl.textContent = 'Enter a USDC amount.'; return; }
  try {
    statusEl.textContent = 'Confirm in your wallet…';
    const r = await Gold.buyGold(v);
    statusEl.textContent = `Bought ~${Math.floor(r.goldOut).toLocaleString()} gold ✓`;
    await refreshBal();
    setTimeout(() => { modal.style.display = 'none'; }, 1400);
  } catch (e) { statusEl.textContent = e.message || 'Buy failed.'; }
}

(async function init() {
  try { await ensureEthers(); } catch (_) { /* HUD still renders, buy will prompt */ }
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r));
  injectUI();
  // best-effort silent reconnect if a wallet is already authorized
  if (window.ethereum && window.ethereum.selectedAddress) { try { await Gold.connect(); } catch (_) {} }
  refreshBal();
})();
