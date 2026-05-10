// NFT Character Loader for MfT Arcade Games
// Checks wallet for ToT heroes and Baselings, returns owned characters

const BASE_RPCS = [
  "https://base-mainnet.g.alchemy.com/v2/bwii0dH70pKYTKnqj3aNU",
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];
const BASE_CHAIN_ID = 8453;

// Hero NFTs on Base (from GAME_NFTS)
const HERO_NFTS = [
  { name: "Tales of Tasern Character", addr: "0x9de88faa0dbcfc75534d1b4fd277dadffcc4fd30", color: "#c9a84c", icon: "sword" },
  { name: "Dreadmane Ravager",         addr: "0xfaf9a6b6409b3e69f7d3b38099b41c45bbc29ba5", color: "#8b0000", icon: "beast" },
  { name: "Sir Garrick Lionheart",     addr: "0xea39112525f9169038435cF22f82e5436e0BCC4F", color: "#ffd700", icon: "shield" },
  { name: "Captain Brinebeak",         addr: "0x691e4bEF9A83C00f8A35ed601090E42A8b953c77", color: "#1e90ff", icon: "anchor" },
  { name: "Bunrick",                   addr: "0x63a9c72C90860eaa64A39A31E1A4B00305aA3974", color: "#90ee90", icon: "rabbit" },
  { name: "Vaelrith",                  addr: "0x4A35B948F49A169976FCCC96220676692c987A57", color: "#9370db", icon: "crown" },
  { name: "Kira Emberstep",            addr: "0x26CE8466eC418b7D42d8789476642cdFbB5e8aab", color: "#ff6347", icon: "fire" },
  { name: "Tharion Rootkeeper",        addr: "0x76D50Fbc46a31aC21855b2b8218F4F642991c25e", color: "#228b22", icon: "tree" },
  { name: "Rook Highbranch",           addr: "0xB9c37Ce29A0966f83B29c905c434905301435D9d", color: "#8fbc8f", icon: "leaf" },
  { name: "Captain Blackfeather",      addr: "0x716AdcbEd9Ef58CCf11434Aa7962b0f200A030af", color: "#2f2f2f", icon: "feather" },
  { name: "Mason Ironhorn",            addr: "0x412495cde08733715C2478c6EE00876ABF5e6CE8", color: "#708090", icon: "hammer" },
];

// Baseling NFT on Base (ERC721 — NOT the ERC1155 state contract)
const BASELING_NFT = "0xFCb825491490284189C75fD330Fd08Df5E9217b9";

// ERC721 balanceOf(address) = 0x70a08231
const BALANCE_OF_SIG = "0x70a08231";

async function rpcCall(to, data) {
  let lastErr = null;
  for (const rpc of BASE_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to, data }, "latest"]
        })
      });
      const json = await res.json();
      if (json.error) {
        lastErr = json.error.message || JSON.stringify(json.error);
        console.warn("RPC error from", rpc, ":", lastErr);
        continue;
      }
      return json.result || "0x0";
    } catch (e) {
      lastErr = e.message;
      console.warn("RPC fetch failed:", rpc, e.message);
      continue;
    }
  }
  throw new Error("All RPCs failed: " + lastErr);
}

// Batch multiple balanceOf calls in a single RPC batch request
async function batchBalanceOf(contracts, wallet) {
  const callData = BALANCE_OF_SIG + wallet.slice(2).toLowerCase().padStart(64, "0");
  const batch = contracts.map((c, i) => ({
    jsonrpc: "2.0", id: i + 1, method: "eth_call",
    params: [{ to: c.addr || c, data: callData }, "latest"]
  }));

  for (const rpc of BASE_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch)
      });
      const results = await res.json();
      if (Array.isArray(results)) {
        return results.sort((a, b) => a.id - b.id).map(r => {
          if (r.error) return 0;
          return parseInt(r.result, 16) || 0;
        });
      }
      console.warn("Non-array batch response from", rpc);
    } catch (e) {
      console.warn("Batch RPC failed:", rpc, e.message);
    }
  }
  // Fallback: individual calls
  console.warn("Batch failed on all RPCs, trying individual calls");
  const results = [];
  for (const c of contracts) {
    try {
      const result = await rpcCall(c.addr || c, callData);
      results.push(parseInt(result, 16) || 0);
    } catch (e) {
      results.push(0);
    }
  }
  return results;
}

function encodeBalanceOf(address) {
  return BALANCE_OF_SIG + address.slice(2).toLowerCase().padStart(64, "0");
}

function decodeUint(hex) {
  return parseInt(hex, 16) || 0;
}

// Main export: connect wallet and check NFTs
window.NftLoader = {
  wallet: null,
  ownedCharacters: [],
  selectedCharacter: null,
  _lastError: null,

  async connectWallet() {
    if (!window.ethereum) return null;
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts || !accounts.length) return null;
      this.wallet = accounts[0];

      // Switch to Base if needed
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + BASE_CHAIN_ID.toString(16) }]
        });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x" + BASE_CHAIN_ID.toString(16),
              chainName: "Base",
              rpcUrls: ["https://mainnet.base.org"],
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              blockExplorerUrls: ["https://basescan.org"]
            }]
          });
        } else {
          console.warn("Chain switch failed:", e);
        }
      }

      return this.wallet;
    } catch (e) {
      console.warn("Wallet connect failed:", e);
      return null;
    }
  },

  async checkNFTs() {
    if (!this.wallet) return [];
    this.ownedCharacters = [];
    this._lastError = null;

    // Build list of all contracts to check in one batch
    const allContracts = [
      ...HERO_NFTS.map(n => ({ addr: n.addr, meta: n })),
      { addr: BASELING_NFT, meta: { name: "Baseling", color: "#a855f7", icon: "egg" } }
    ];

    try {
      const balances = await batchBalanceOf(allContracts, this.wallet);
      balances.forEach((bal, i) => {
        if (bal > 0) {
          const c = allContracts[i];
          const isBaseling = c.addr === BASELING_NFT;
          this.ownedCharacters.push({
            type: isBaseling ? "baseling" : "hero",
            name: c.meta.name,
            color: c.meta.color,
            icon: c.meta.icon,
            count: bal,
            contract: c.addr
          });
        }
      });
    } catch (e) {
      this._lastError = e.message;
      console.error("NFT check failed:", e);
    }

    return this.ownedCharacters;
  },

  // Draw character select overlay on a canvas context
  drawCharacterSelect(ctx, w, h, onSelect) {
    const chars = this.ownedCharacters;
    if (!chars.length) return false;

    // Overlay
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SELECT YOUR CHARACTER", w / 2, 40);

    ctx.font = "10px monospace";
    ctx.fillStyle = "#888";
    ctx.fillText("Your NFTs grant special powers", w / 2, 58);

    const cols = Math.min(chars.length, 4);
    const boxW = 90;
    const boxH = 100;
    const gap = 15;
    const totalW = cols * boxW + (cols - 1) * gap;
    const startX = (w - totalW) / 2;
    const startY = 80;

    // Store clickable regions
    this._selectRegions = [];

    chars.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (boxW + gap);
      const y = startY + row * (boxH + gap);

      // Box
      ctx.fillStyle = c.color + "30";
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      // Icon
      ctx.font = "24px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = c.color;
      const icons = { sword: "\u2694", beast: "\uD83D\uDC09", shield: "\uD83D\uDEE1", anchor: "\u2693", rabbit: "\uD83D\uDC30", crown: "\uD83D\uDC51", fire: "\uD83D\uDD25", tree: "\uD83C\uDF33", leaf: "\uD83C\uDF43", feather: "\uD83E\uDEB6", hammer: "\uD83D\uDD28", egg: "\uD83E\uDD5A" };
      ctx.fillText(icons[c.icon] || "?", x + boxW / 2, y + 35);

      // Name
      ctx.font = "bold 8px monospace";
      ctx.fillStyle = "#fff";
      const shortName = c.name.length > 12 ? c.name.slice(0, 11) + "\u2026" : c.name;
      ctx.fillText(shortName, x + boxW / 2, y + 55);

      // Type badge
      ctx.font = "7px monospace";
      ctx.fillStyle = c.color;
      ctx.fillText(c.type.toUpperCase(), x + boxW / 2, y + 68);

      // Bonus text
      ctx.font = "6px monospace";
      ctx.fillStyle = "#aaa";
      ctx.fillText("+1 Life, 1.5x Score", x + boxW / 2, y + 82);

      this._selectRegions.push({ x, y, w: boxW, h: boxH, char: c });
    });

    return true;
  },

  // Check if a click hits a character
  handleClick(cx, cy) {
    if (!this._selectRegions) return null;
    for (const r of this._selectRegions) {
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        this.selectedCharacter = r.char;
        return r.char;
      }
    }
    return null;
  },

  // Get gameplay bonuses for selected character
  getBonuses() {
    if (!this.selectedCharacter) return { lives: 0, scoreMultiplier: 1, color: null };
    return {
      lives: 1,              // +1 extra life
      scoreMultiplier: 1.5,  // 1.5x score
      color: this.selectedCharacter.color,
      name: this.selectedCharacter.name,
      icon: this.selectedCharacter.icon
    };
  },

  // Token gate - blocks game until user connects wallet with qualifying NFT
  gate(onSuccess) {
    const overlay = document.createElement('div');
    overlay.id = 'nft-gate';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#0a0a0f;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;';

    const title = document.createElement('div');
    title.textContent = 'NFT REQUIRED';
    title.style.cssText = 'color:#c9a84c;font-size:1.4rem;font-weight:900;letter-spacing:0.2em;margin-bottom:8px;';
    overlay.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent = 'Connect a wallet with a Tales of Tasern or Baseling NFT';
    sub.style.cssText = 'color:#666;font-size:0.7rem;letter-spacing:0.1em;margin-bottom:24px;text-align:center;max-width:300px;';
    overlay.appendChild(sub);

    const btn = document.createElement('button');
    btn.textContent = 'CONNECT WALLET';
    btn.style.cssText = 'padding:14px 32px;border-radius:12px;border:2px solid #c9a84c;background:rgba(201,168,76,0.1);color:#c9a84c;font-size:0.85rem;font-weight:900;letter-spacing:0.15em;cursor:pointer;font-family:monospace;transition:all 0.15s;';
    btn.onmouseenter = function() { btn.style.background = 'rgba(201,168,76,0.2)'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(201,168,76,0.1)'; };

    const status = document.createElement('div');
    status.style.cssText = 'color:#555;font-size:0.7rem;margin-top:16px;text-align:center;max-width:300px;';

    const nftIcons = document.createElement('div');
    nftIcons.style.cssText = 'display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;justify-content:center;max-width:350px;';

    const self = this;
    btn.onclick = async function() {
      btn.textContent = 'CONNECTING...';
      btn.style.opacity = '0.5';
      btn.style.pointerEvents = 'none';

      if (!window.ethereum) {
        status.textContent = 'No wallet detected. Install MetaMask or a Web3 wallet.';
        status.style.color = '#ef4444';
        btn.textContent = 'CONNECT WALLET';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        return;
      }

      var addr = await self.connectWallet();
      if (!addr) {
        status.textContent = 'Wallet connection denied.';
        status.style.color = '#ef4444';
        btn.textContent = 'CONNECT WALLET';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        return;
      }

      status.textContent = 'Checking NFTs for ' + addr.slice(0,6) + '...' + addr.slice(-4) + '...';
      status.style.color = '#888';
      var owned = await self.checkNFTs();

      if (owned.length > 0) {
        status.textContent = 'Access granted!';
        status.style.color = '#22c55e';
        nftIcons.innerHTML = '';
        var iconMap = { sword: "\u2694\uFE0F", beast: "\uD83D\uDC09", shield: "\uD83D\uDEE1\uFE0F", anchor: "\u2693", rabbit: "\uD83D\uDC30", crown: "\uD83D\uDC51", fire: "\uD83D\uDD25", tree: "\uD83C\uDF33", leaf: "\uD83C\uDF43", feather: "\uD83E\uDEB6", hammer: "\uD83D\uDD28", egg: "\uD83E\uDD5A" };
        owned.forEach(function(c) {
          var chip = document.createElement('span');
          chip.style.cssText = 'padding:6px 12px;border-radius:8px;font-size:0.7rem;font-weight:700;border:1px solid ' + c.color + '40;background:' + c.color + '15;color:' + c.color + ';';
          chip.textContent = (iconMap[c.icon] || '') + ' ' + c.name;
          nftIcons.appendChild(chip);
        });
        self.selectedCharacter = owned[0];
        setTimeout(function() {
          overlay.style.transition = 'opacity 0.3s';
          overlay.style.opacity = '0';
          setTimeout(function() { overlay.remove(); if (onSuccess) onSuccess(); }, 300);
        }, 800);
      } else {
        var errMsg = 'No qualifying NFTs found.';
        if (self._lastError) {
          errMsg += ' (RPC error: ' + self._lastError + ')';
        }
        status.innerHTML = errMsg + '<br><span style="color:#888;font-size:0.6rem;">Wallet: ' + addr.slice(0,6) + '...' + addr.slice(-4) + ' on Base chain.<br>You need a Tales of Tasern hero or Baseling NFT.</span>';
        status.style.color = '#ef4444';
        btn.textContent = 'TRY AGAIN';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }
    };

    overlay.appendChild(btn);
    overlay.appendChild(status);
    overlay.appendChild(nftIcons);

    var getLink = document.createElement('a');
    getLink.href = '/baselings';
    getLink.textContent = 'Get a Baseling for $0.10 \u2192 unlimited arcade access';
    getLink.style.cssText = 'color:#a855f7;font-size:0.65rem;margin-top:24px;text-decoration:none;letter-spacing:0.06em;border:1px solid rgba(168,85,247,0.2);padding:8px 16px;border-radius:8px;background:rgba(168,85,247,0.06);';
    getLink.onmouseenter = function() { getLink.style.color = '#c084fc'; };
    getLink.onmouseleave = function() { getLink.style.color = '#a855f7'; };
    overlay.appendChild(getLink);

    // Block keyboard events while gate is shown
    function blockKeys(e) { e.stopPropagation(); e.preventDefault(); }
    document.addEventListener('keydown', blockKeys, true);
    document.addEventListener('keyup', blockKeys, true);

    // Store cleanup for when gate is passed
    var origRemove = overlay.remove.bind(overlay);
    overlay.remove = function() {
      document.removeEventListener('keydown', blockKeys, true);
      document.removeEventListener('keyup', blockKeys, true);
      origRemove();
    };

    document.body.appendChild(overlay);
  }
};
