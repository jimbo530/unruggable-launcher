// NFT Character Loader for MfT Arcade Games
// Checks wallet for ToT heroes and Baselings, returns owned characters
// v3.0 — Real baseling sprites via arcade-roster API + BaselingSprites renderer

const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base.publicnode.com"
];
const BASE_CHAIN_ID = 8453;

// Hero NFTs on Base (from GAME_NFTS) — each hero boosts specific stats
const HERO_NFTS = [
  { name: "Tales of Tasern Character", addr: "0x9de88faa0dbcfc75534d1b4fd277dadffcc4fd30", color: "#c9a84c", icon: "sword",   stats: { str: 2, dex: 1, con: 1, int: 1, wis: 1, cha: 2 } },
  { name: "Dreadmane Ravager",         addr: "0xfaf9a6b6409b3e69f7d3b38099b41c45bbc29ba5", color: "#8b0000", icon: "beast",   stats: { str: 4, dex: 2, con: 3, int: 0, wis: 0, cha: 0 } },
  { name: "Sir Garrick Lionheart",     addr: "0xea39112525f9169038435cF22f82e5436e0BCC4F", color: "#ffd700", icon: "shield",  stats: { str: 2, dex: 1, con: 3, int: 0, wis: 1, cha: 2 } },
  { name: "Captain Brinebeak",         addr: "0x691e4bEF9A83C00f8A35ed601090E42A8b953c77", color: "#1e90ff", icon: "anchor",  stats: { str: 1, dex: 3, con: 1, int: 2, wis: 2, cha: 0 } },
  { name: "Bunrick",                   addr: "0x63a9c72C90860eaa64A39A31E1A4B00305aA3974", color: "#90ee90", icon: "rabbit",  stats: { str: 0, dex: 4, con: 1, int: 1, wis: 1, cha: 2 } },
  { name: "Vaelrith",                  addr: "0x4A35B948F49A169976FCCC96220676692c987A57", color: "#9370db", icon: "crown",   stats: { str: 1, dex: 1, con: 1, int: 3, wis: 2, cha: 3 } },
  { name: "Kira Emberstep",            addr: "0x26CE8466eC418b7D42d8789476642cdFbB5e8aab", color: "#ff6347", icon: "fire",    stats: { str: 3, dex: 3, con: 0, int: 1, wis: 0, cha: 2 } },
  { name: "Tharion Rootkeeper",        addr: "0x76D50Fbc46a31aC21855b2b8218F4F642991c25e", color: "#228b22", icon: "tree",    stats: { str: 1, dex: 0, con: 3, int: 2, wis: 4, cha: 0 } },
  { name: "Rook Highbranch",           addr: "0xB9c37Ce29A0966f83B29c905c434905301435D9d", color: "#8fbc8f", icon: "leaf",    stats: { str: 0, dex: 2, con: 2, int: 2, wis: 3, cha: 1 } },
  { name: "Captain Blackfeather",      addr: "0x716AdcbEd9Ef58CCf11434Aa7962b0f200A030af", color: "#2f2f2f", icon: "feather", stats: { str: 3, dex: 2, con: 1, int: 1, wis: 0, cha: 3 } },
  { name: "Mason Ironhorn",            addr: "0x412495cde08733715C2478c6EE00876ABF5e6CE8", color: "#708090", icon: "hammer",  stats: { str: 4, dex: 0, con: 4, int: 0, wis: 1, cha: 0 } },
];

// Baseling NFT on Base (ERC721)
const BASELING_NFT = "0xFCb825491490284189C75fD330Fd08Df5E9217b9";

// Arcade roster API
const ROSTER_API = '/api/baseling/arcade-roster';

// Rarity colors for display
const RARITY_COLORS = {
  common: '#aaa', uncommon: '#5b5', rare: '#55f', epic: '#a5f', legendary: '#fa5', mythic: '#f55'
};

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

// Fetch individual baseling data from arcade-roster API
async function fetchBaselingRoster(wallet) {
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 3000);
    var res = await fetch(ROSTER_API + '?wallet=' + encodeURIComponent(wallet), {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return data.baselings || [];
  } catch (e) {
    console.warn('[nft-loader] arcade-roster fetch failed:', e.message);
    return null; // null = fallback to generic
  }
}

// Main export: connect wallet and check NFTs
window.NftLoader = {
  wallet: null,
  ownedCharacters: [],
  selectedCharacter: null,
  _lastError: null,
  _selectFrame: 0,
  // Baseling stat totals (D&D style, 1-20 scale)
  stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },

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

    var baselingBalance = 0;

    try {
      const balances = await batchBalanceOf(allContracts, this.wallet);
      balances.forEach((bal, i) => {
        if (bal > 0) {
          const c = allContracts[i];
          const isBaseling = c.addr === BASELING_NFT;
          if (isBaseling) {
            baselingBalance = bal;
            // Don't push generic entry yet — try roster API first
          } else {
            this.ownedCharacters.push({
              type: "hero",
              name: c.meta.name,
              color: c.meta.color,
              icon: c.meta.icon,
              count: bal,
              contract: c.addr,
              heroStats: c.meta.stats || null
            });
          }
        }
      });
    } catch (e) {
      this._lastError = e.message;
      console.error("NFT check failed:", e);
    }

    // Fetch individual baseling data if any owned
    if (baselingBalance > 0) {
      var roster = await fetchBaselingRoster(this.wallet);
      if (roster && roster.length > 0) {
        // Got individual baseling data — push each as separate entry
        for (var ri = 0; ri < roster.length; ri++) {
          var b = roster[ri];
          this.ownedCharacters.push({
            type: "baseling",
            name: (b.charName || b.charId || 'Baseling') + ' #' + b.tokenId,
            color: RARITY_COLORS[b.rarity] || '#a855f7',
            icon: "egg",
            count: 1,
            contract: BASELING_NFT,
            heroStats: null,
            // Sprite data
            charId: b.charId,
            charName: b.charName || b.charId,
            colorVariant: b.colorVariant || null,
            sparkle: b.sparkle || false,
            isGiant: b.isGiant || false,
            rarity: b.rarity || 'common',
            tokenId: b.tokenId,
            stage: b.stage || 0
          });
          // Pre-load sprite
          if (window.BaselingSprites && b.charId) {
            BaselingSprites.load(b.charId, b.colorVariant);
          }
        }
      } else {
        // Roster API failed or no save — fallback to generic entry
        this.ownedCharacters.push({
          type: "baseling",
          name: "Baseling",
          color: "#a855f7",
          icon: "egg",
          count: baselingBalance,
          contract: BASELING_NFT,
          heroStats: null,
          charId: null,
          colorVariant: null,
          sparkle: false
        });
      }
    }

    // Calculate combined stats from all owned NFTs
    this._calculateStats();

    return this.ownedCharacters;
  },

  // Calculate D&D-style stats (1-20) from owned NFTs
  _calculateStats() {
    var s = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
    var totalBaselings = 0;

    for (var i = 0; i < this.ownedCharacters.length; i++) {
      var c = this.ownedCharacters[i];
      if (c.type === "baseling") {
        totalBaselings += c.count;
      } else if (c.heroStats) {
        var heroMult = Math.min(c.count, 2);
        s.str += (c.heroStats.str || 0) * heroMult;
        s.dex += (c.heroStats.dex || 0) * heroMult;
        s.con += (c.heroStats.con || 0) * heroMult;
        s.int += (c.heroStats.int || 0) * heroMult;
        s.wis += (c.heroStats.wis || 0) * heroMult;
        s.cha += (c.heroStats.cha || 0) * heroMult;
      }
    }

    // Each baseling adds +1 to all stats (up to 5 counted)
    var baselingBonus = Math.min(totalBaselings, 5);
    s.str += baselingBonus;
    s.dex += baselingBonus;
    s.con += baselingBonus;
    s.int += baselingBonus;
    s.wis += baselingBonus;
    s.cha += baselingBonus;

    // Clamp all stats to 1-20 range (minimum 1 if they own anything)
    var hasAny = this.ownedCharacters.length > 0;
    var keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    for (var k = 0; k < keys.length; k++) {
      s[keys[k]] = Math.min(20, Math.max(hasAny ? 1 : 0, s[keys[k]]));
    }

    this.stats = s;
  },

  // Get gameplay bonuses scaled from stats (the main API games should use)
  getStatBonuses() {
    var s = this.stats;
    var hasChar = this.selectedCharacter != null;
    if (!hasChar) {
      return {
        str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
        damage: 1.0, speed: 1.0, lives: 0, hpMult: 1.0,
        scoreMult: 1.0, cooldown: 1.0, luck: 1.0,
        color: null, name: null, icon: null, level: 0,
        charId: null, colorVariant: null, sparkle: false
      };
    }
    var c = this.selectedCharacter;
    var level = Math.floor((s.str + s.dex + s.con + s.int + s.wis + s.cha) / 6);
    return {
      // Raw stats (1-20 each)
      str: s.str, dex: s.dex, con: s.con, int: s.int, wis: s.wis, cha: s.cha,
      // Derived gameplay bonuses
      damage: 1.0 + (s.str / 20),
      speed: 1.0 + (s.dex / 40),
      lives: Math.floor(s.con / 5),
      hpMult: 1.0 + (s.con / 40),
      scoreMult: 1.0 + (s.int / 20),
      cooldown: Math.max(0.5, 1.0 - (s.wis / 60)),
      luck: 1.0 + (s.cha / 20),
      // Character info for display
      color: c.color,
      name: c.name,
      icon: c.icon,
      level: level,
      // Baseling sprite data (null for heroes)
      charId: c.charId || null,
      colorVariant: c.colorVariant || null,
      sparkle: c.sparkle || false
    };
  },

  // Legacy getBonuses for backward compatibility
  getBonuses() {
    return this.getStatBonuses();
  },

  // Draw NES-style stat bar on title screen
  drawStatBar(ctx, x, y, w) {
    var b = this.getStatBonuses();
    if (b.level === 0) return;

    var barH = 6;
    var gap = 10;
    var labelW = 28;
    var barW = w - labelW - 4;
    var statNames = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var statColors = ['#ff4444', '#44ff44', '#ffaa00', '#4488ff', '#aa44ff', '#ff44aa'];

    // Header — show baseling name if available
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(b.name || 'BASELING', x, y - 4);
    ctx.fillStyle = '#888';
    ctx.font = '7px monospace';
    ctx.fillText('LV' + b.level, x + w - 20, y - 4);

    for (var i = 0; i < 6; i++) {
      var sy = y + i * gap;
      var val = b[statKeys[i]];
      var pct = val / 20;

      ctx.fillStyle = statColors[i];
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(statNames[i], x, sy + barH);

      ctx.fillStyle = '#222';
      ctx.fillRect(x + labelW, sy, barW, barH);

      ctx.fillStyle = statColors[i];
      ctx.fillRect(x + labelW, sy, barW * pct, barH);

      ctx.fillStyle = '#000';
      for (var p = 5; p < 20; p += 5) {
        var px = x + labelW + (barW * p / 20);
        ctx.fillRect(px, sy, 1, barH);
      }

      ctx.fillStyle = '#fff';
      ctx.font = '6px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), x + w, sy + barH);
    }

    ctx.textAlign = 'left';
  },

  // Draw character select overlay on a canvas context
  drawCharacterSelect(ctx, w, h, onSelect) {
    var chars = this.ownedCharacters;
    if (!chars.length) return false;
    this._selectFrame = (this._selectFrame || 0) + 1;

    // Overlay
    ctx.fillStyle = "rgba(0,0,0,0.88)";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SELECT YOUR CHARACTER", w / 2, 36);

    ctx.font = "10px monospace";
    ctx.fillStyle = "#888";
    ctx.fillText("Your NFTs grant special powers", w / 2, 52);

    var cols = Math.min(chars.length, 4);
    var boxW = 90;
    var boxH = 110;
    var gap = 12;
    var totalW = cols * boxW + (cols - 1) * gap;
    var startX = (w - totalW) / 2;
    var startY = 66;

    // Store clickable regions
    this._selectRegions = [];

    var iconMap = { sword: "\u2694", beast: "\uD83D\uDC09", shield: "\uD83D\uDEE1", anchor: "\u2693", rabbit: "\uD83D\uDC30", crown: "\uD83D\uDC51", fire: "\uD83D\uDD25", tree: "\uD83C\uDF33", leaf: "\uD83C\uDF43", feather: "\uD83E\uDEB6", hammer: "\uD83D\uDD28", egg: "\uD83E\uDD5A" };

    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      var col = i % cols;
      var row = Math.floor(i / cols);
      var bx = startX + col * (boxW + gap);
      var by = startY + row * (boxH + gap);

      // Box with rounded corners
      var isSelected = this.selectedCharacter === c;
      ctx.fillStyle = (isSelected ? c.color + '40' : c.color + '20');
      ctx.strokeStyle = isSelected ? '#fff' : c.color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      // Character visual — baseling sprite or hero icon
      var spriteDrawn = false;
      if (c.type === 'baseling' && c.charId && window.BaselingSprites) {
        spriteDrawn = BaselingSprites.draw(ctx, c.charId, c.colorVariant, c.sparkle,
          bx + boxW / 2, by + 38, 48, { frame: this._selectFrame });
      }
      if (!spriteDrawn) {
        // Fallback: emoji icon
        ctx.font = "28px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = c.color;
        ctx.fillText(iconMap[c.icon] || "\uD83E\uDD5A", bx + boxW / 2, by + 42);
      }

      // Name
      ctx.font = "bold 7px monospace";
      ctx.fillStyle = "#fff";
      var displayName = c.charName || c.name;
      var shortName = displayName.length > 13 ? displayName.slice(0, 12) + "\u2026" : displayName;
      ctx.fillText(shortName, bx + boxW / 2, by + 70);

      // Rarity / type badge
      ctx.font = "6px monospace";
      ctx.fillStyle = c.color;
      if (c.rarity) {
        ctx.fillText(c.rarity.toUpperCase(), bx + boxW / 2, by + 82);
      } else if (c.type === 'hero') {
        ctx.fillText('HERO' + (c.count > 1 ? ' x' + c.count : ''), bx + boxW / 2, by + 82);
      }

      // Stat preview
      if (c.heroStats) {
        var sorted = Object.entries(c.heroStats).sort(function(a, b) { return b[1] - a[1]; });
        var top = sorted.filter(function(s) { return s[1] > 0; }).slice(0, 2);
        ctx.font = "6px monospace";
        ctx.fillStyle = "#aaa";
        ctx.fillText(top.map(function(s) { return "+" + s[1] + " " + s[0].toUpperCase(); }).join("  "), bx + boxW / 2, by + 94);
      } else if (c.type === 'baseling' && !c.charId) {
        ctx.font = "6px monospace";
        ctx.fillStyle = "#aaa";
        ctx.fillText("+1 ALL per baseling", bx + boxW / 2, by + 94);
      }

      this._selectRegions.push({ x: bx, y: by, w: boxW, h: boxH, char: c });
    }

    return true;
  },

  // Check if a click hits a character
  handleClick(cx, cy) {
    if (!this._selectRegions) return null;
    for (var i = 0; i < this._selectRegions.length; i++) {
      var r = this._selectRegions[i];
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        this.selectedCharacter = r.char;
        return r.char;
      }
    }
    return null;
  },

  // Token gate - blocks game until user connects wallet with qualifying NFT
  gate(onSuccess) {
    var overlay = document.createElement('div');
    overlay.id = 'nft-gate';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#0a0a0f;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;';

    var title = document.createElement('div');
    title.textContent = 'NFT REQUIRED';
    title.style.cssText = 'color:#c9a84c;font-size:1.4rem;font-weight:900;letter-spacing:0.2em;margin-bottom:8px;';
    overlay.appendChild(title);

    var sub = document.createElement('div');
    sub.textContent = 'Connect a wallet with a Tales of Tasern or Baseling NFT';
    sub.style.cssText = 'color:#666;font-size:0.7rem;letter-spacing:0.1em;margin-bottom:24px;text-align:center;max-width:300px;';
    overlay.appendChild(sub);

    var btn = document.createElement('button');
    btn.textContent = 'CONNECT WALLET';
    btn.style.cssText = 'padding:14px 32px;border-radius:12px;border:2px solid #c9a84c;background:rgba(201,168,76,0.1);color:#c9a84c;font-size:0.85rem;font-weight:900;letter-spacing:0.15em;cursor:pointer;font-family:monospace;transition:all 0.15s;';
    btn.onmouseenter = function() { btn.style.background = 'rgba(201,168,76,0.2)'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(201,168,76,0.1)'; };

    var statusEl = document.createElement('div');
    statusEl.style.cssText = 'color:#555;font-size:0.7rem;margin-top:16px;text-align:center;max-width:300px;';

    var nftIcons = document.createElement('div');
    nftIcons.style.cssText = 'display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;justify-content:center;max-width:350px;';

    // Character select container (shown after NFT check if 2+ chars)
    var selectContainer = document.createElement('div');
    selectContainer.style.cssText = 'display:none;margin-top:16px;width:100%;max-width:460px;';

    var self = this;
    btn.onclick = async function() {
      btn.textContent = 'CONNECTING...';
      btn.style.opacity = '0.5';
      btn.style.pointerEvents = 'none';

      if (!window.ethereum) {
        statusEl.textContent = 'No wallet detected. Install MetaMask or a Web3 wallet.';
        statusEl.style.color = '#ef4444';
        btn.textContent = 'CONNECT WALLET';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        return;
      }

      var addr = await self.connectWallet();
      if (!addr) {
        statusEl.textContent = 'Wallet connection denied.';
        statusEl.style.color = '#ef4444';
        btn.textContent = 'CONNECT WALLET';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        return;
      }

      statusEl.textContent = 'Checking NFTs for ' + addr.slice(0,6) + '...' + addr.slice(-4) + '...';
      statusEl.style.color = '#888';
      var owned = await self.checkNFTs();

      if (owned.length > 0) {
        nftIcons.innerHTML = '';
        var iconMap = { sword: "\u2694\uFE0F", beast: "\uD83D\uDC09", shield: "\uD83D\uDEE1\uFE0F", anchor: "\u2693", rabbit: "\uD83D\uDC30", crown: "\uD83D\uDC51", fire: "\uD83D\uDD25", tree: "\uD83C\uDF33", leaf: "\uD83C\uDF43", feather: "\uD83E\uDEB6", hammer: "\uD83D\uDD28", egg: "\uD83E\uDD5A" };

        if (owned.length === 1) {
          // Single character — auto-select and dismiss
          self.selectedCharacter = owned[0];
          statusEl.textContent = 'Access granted!';
          statusEl.style.color = '#22c55e';

          // Show the character briefly
          var chip = document.createElement('span');
          chip.style.cssText = 'padding:6px 12px;border-radius:8px;font-size:0.7rem;font-weight:700;border:1px solid ' + owned[0].color + '40;background:' + owned[0].color + '15;color:' + owned[0].color + ';';
          chip.textContent = (iconMap[owned[0].icon] || '') + ' ' + owned[0].name;
          nftIcons.appendChild(chip);

          setTimeout(function() {
            overlay.style.transition = 'opacity 0.3s';
            overlay.style.opacity = '0';
            setTimeout(function() { overlay.remove(); if (onSuccess) onSuccess(); }, 300);
          }, 800);
        } else {
          // Multiple characters — show character select
          statusEl.textContent = 'Choose your character:';
          statusEl.style.color = '#22c55e';
          btn.style.display = 'none';

          // Build select grid in DOM
          selectContainer.style.display = 'block';
          selectContainer.innerHTML = '';

          var grid = document.createElement('div');
          grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:8px;';

          for (var oi = 0; oi < owned.length; oi++) {
            (function(charObj, idx) {
              var card = document.createElement('div');
              card.style.cssText = 'width:90px;padding:8px 4px;border-radius:10px;border:2px solid ' + charObj.color + '40;background:' + charObj.color + '10;cursor:pointer;text-align:center;transition:all 0.15s;';

              // Sprite or icon
              var visual = document.createElement('div');
              visual.style.cssText = 'width:56px;height:56px;margin:0 auto 4px;';

              if (charObj.charId && window.BaselingSprites) {
                // Draw baseling sprite on a mini canvas
                var miniCanvas = document.createElement('canvas');
                miniCanvas.width = 56; miniCanvas.height = 56;
                miniCanvas.style.cssText = 'width:56px;height:56px;image-rendering:pixelated;';
                var mc = miniCanvas.getContext('2d');
                // Try to draw immediately, or draw after load
                function drawMini() {
                  mc.clearRect(0, 0, 56, 56);
                  BaselingSprites.draw(mc, charObj.charId, charObj.colorVariant, charObj.sparkle, 28, 28, 48, { frame: 0 });
                }
                if (BaselingSprites.isLoaded(charObj.charId)) {
                  drawMini();
                } else {
                  BaselingSprites.load(charObj.charId, charObj.colorVariant, drawMini);
                }
                visual.appendChild(miniCanvas);
              } else {
                visual.style.fontSize = '32px';
                visual.style.lineHeight = '56px';
                visual.textContent = iconMap[charObj.icon] || '\uD83E\uDD5A';
              }
              card.appendChild(visual);

              var nameEl = document.createElement('div');
              nameEl.style.cssText = 'font-size:0.6rem;color:#fff;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
              nameEl.textContent = charObj.charName || charObj.name;
              card.appendChild(nameEl);

              if (charObj.rarity) {
                var rarEl = document.createElement('div');
                rarEl.style.cssText = 'font-size:0.5rem;color:' + (RARITY_COLORS[charObj.rarity] || '#aaa') + ';margin-top:2px;';
                rarEl.textContent = charObj.rarity.toUpperCase();
                card.appendChild(rarEl);
              }

              card.onmouseenter = function() { card.style.borderColor = '#fff'; card.style.transform = 'scale(1.05)'; };
              card.onmouseleave = function() { card.style.borderColor = charObj.color + '40'; card.style.transform = 'scale(1)'; };
              card.onclick = function() {
                self.selectedCharacter = charObj;
                statusEl.textContent = 'Selected: ' + (charObj.charName || charObj.name);
                setTimeout(function() {
                  overlay.style.transition = 'opacity 0.3s';
                  overlay.style.opacity = '0';
                  setTimeout(function() { overlay.remove(); if (onSuccess) onSuccess(); }, 300);
                }, 400);
              };

              grid.appendChild(card);
            })(owned[oi], oi);
          }
          selectContainer.appendChild(grid);
        }
      } else {
        var errMsg = 'No qualifying NFTs found.';
        if (self._lastError) {
          errMsg += ' (RPC error: ' + self._lastError + ')';
        }
        statusEl.innerHTML = errMsg + '<br><span style="color:#888;font-size:0.6rem;">Wallet: ' + addr.slice(0,6) + '...' + addr.slice(-4) + ' on Base chain.<br>You need a Tales of Tasern hero or Baseling NFT.</span>';
        statusEl.style.color = '#ef4444';
        btn.textContent = 'TRY AGAIN';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }
    };

    overlay.appendChild(btn);
    overlay.appendChild(statusEl);
    overlay.appendChild(nftIcons);
    overlay.appendChild(selectContainer);

    var getLink = document.createElement('a');
    getLink.href = '../marketplace/index.html';
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
