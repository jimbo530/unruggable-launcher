/**
 * chain-data.js — Live on-chain data for MfT/Unruggable marketing content
 * Fetches reactor status, burns, launches, prices, TVL
 */

const { ethers } = require("ethers");

const RPC = "https://mainnet.base.org";
const BURN = "0xfd780B0aE569e15e514B819ecFDF46f804953a4B";

const SUPABASE_URL = "https://hhniimufxjjgmessjtbc.supabase.co";
const SUPABASE_ANON = "sb_publishable_F471ZS8yTS8qiXU0ZLEqvQ_I-O3av-l";

const MFT = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Only tokens verifiable at the burn address
const TOKENS = [
  { symbol: "MfT",     addr: MFT, decimals: 18 },
  { symbol: "CHAR",    addr: "0x20b048fA035D5763685D695e66aDF62c5D9F5055", decimals: 18 },
  { symbol: "BB",      addr: "0xf967bf3dccF8b6826F82de1781C98E61Bda3b106", decimals: 18 },
  { symbol: "EB",      addr: "0x17a176Ab2379b86F1E65D79b03bD8c75981244D8", decimals: 18 },
];

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

// Known reactors that can fire
const FIREABLE_REACTORS = [
  { name: "HUB",        addr: "0xf5b9fc40080aacc262f078ece374a2268dcdb045", pools: 5 },
  { name: "NFS",        addr: "0x71c28e76e3cd6d457e7639314b114760246cdead", pools: 7 },
  { name: "NMB",        addr: "0x745babd96010a1459edadc0760c936501fcc95db", pools: 6 },
  { name: "MTEST",      addr: "0xab2d882d0cbc9065425210f49073ea5daeda58eb", pools: 6 },
  { name: "MR-CHAR",    addr: "0x15fff1286807fa96b4cac8b9bc262a492494c6d8", pools: 3 },
  { name: "MTEST-CHAR", addr: "0x237efd82070f7ae71ba1950b10b16f0ea02ca8e9", pools: 3 },
];

async function fetchChainData() {
  const provider = new ethers.JsonRpcProvider(RPC);

  // 1. Burns
  const burns = {};
  for (const t of TOKENS) {
    try {
      const c = new ethers.Contract(t.addr, ERC20_ABI, provider);
      const bal = await c.balanceOf(BURN);
      burns[t.symbol] = Number(ethers.formatUnits(bal, t.decimals));
    } catch (err) { console.error(`[!] ${t.symbol} burn fetch failed:`, err.message); burns[t.symbol] = 0; }
  }

  // 2. Reactor status
  const reactorStatus = [];
  for (const r of FIREABLE_REACTORS) {
    try {
      const timeData = await provider.call({
        to: r.addr.toLowerCase(), data: "0xd46cd1c9", gas: "0x1C9C380"
      });
      let timeLeft = 0;
      if (timeData && timeData.length >= 66) {
        timeLeft = Number(BigInt(timeData.slice(0, 66)));
      }
      const ready = timeLeft === 0;

      // Check MfT balance at reactor via raw call (avoids checksum issues)
      let mftBal = 0;
      try {
        const balData = await provider.call({
          to: MFT.toLowerCase(),
          data: "0x70a08231" + ethers.zeroPadValue(r.addr, 32).slice(2),
          gas: "0x1C9C380"
        });
        if (balData && balData.length >= 66) {
          mftBal = Number(ethers.formatEther(BigInt(balData.slice(0, 66))));
        }
      } catch (err) { console.error(`[!] MfT balance at ${r.name} failed:`, err.message); }

      reactorStatus.push({
        name: r.name, addr: r.addr, pools: r.pools,
        ready, cooldownMin: Math.round(timeLeft / 60),
        mftBalance: mftBal,
      });
    } catch (e) {
      reactorStatus.push({ name: r.name, addr: r.addr, pools: r.pools, ready: false, cooldownMin: 0, mftBalance: 0, error: e.message?.slice(0, 60) });
    }
  }

  // 3. Launched tokens from Supabase
  let launches = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/launched_tokens?select=symbol,token_address,reactor_address,seed,launched_at&order=launched_at.desc&limit=50`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    launches = await res.json();
  } catch (err) { console.error('[!] Supabase launches failed:', err.message); }

  // 4. Total pool count across all reactors
  const totalPools = FIREABLE_REACTORS.reduce((s, r) => s + r.pools, 0);
  const readyCount = reactorStatus.filter(r => r.ready).length;

  // 5. MfT price estimate from WETH pool
  let mftPriceUsd = 0;
  try {
    // Read slot0 from MfT/WETH pool to get sqrtPriceX96
    const v3Factory = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
    const getPoolData = await provider.call({
      to: v3Factory.toLowerCase(),
      data: ethers.id("getPool(address,address,uint24)").slice(0, 10) +
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24"], [MFT, WETH, 10000]).slice(2),
      gas: "0x1C9C380"
    });
    const poolAddr = "0x" + getPoolData.slice(26, 66);
    if (poolAddr !== ethers.ZeroAddress) {
      const slot0Data = await provider.call({
        to: poolAddr, data: ethers.id("slot0()").slice(0, 10), gas: "0x1C9C380"
      });
      const sqrtPriceX96 = BigInt("0x" + slot0Data.slice(2, 66));
      const price = Number(sqrtPriceX96) ** 2 / (2 ** 192);
      // price is token1/token0 ratio — need to figure out order
      const mftLower = MFT.toLowerCase();
      const wethLower = WETH.toLowerCase();
      const mftIsToken0 = mftLower < wethLower;
      const ethPriceUsd = 2400; // rough estimate, good enough for marketing
      if (mftIsToken0) {
        mftPriceUsd = price * ethPriceUsd; // price = WETH per MfT
      } else {
        mftPriceUsd = (1 / price) * ethPriceUsd;
      }
    }
  } catch (err) { console.error('[!] MfT price fetch failed:', err.message); }

  return {
    burns,
    reactors: reactorStatus,
    launches,
    launchCount: launches.length,
    totalPools,
    readyReactors: readyCount,
    totalReactors: FIREABLE_REACTORS.length,
    mftPriceUsd,
    timestamp: new Date().toISOString(),
  };
}

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  if (n >= 1) return Math.floor(n).toLocaleString();
  if (n > 0) return n.toFixed(4);
  return "0";
}

// Run standalone to test
if (require.main === module) {
  fetchChainData().then(data => {
    console.log("\n=== MfT Chain Data ===\n");
    console.log("Launches:", data.launchCount);
    console.log("Reactors:", data.totalReactors, "(" + data.readyReactors + " ready)");
    console.log("Total pools:", data.totalPools);
    console.log("MfT price: $" + data.mftPriceUsd.toFixed(6));
    console.log("\nBurns:");
    for (const [sym, amt] of Object.entries(data.burns)) {
      if (amt > 0) console.log("  " + sym + ": " + formatNum(amt));
    }
    console.log("\nReactors:");
    for (const r of data.reactors) {
      console.log("  " + r.name.padEnd(12) + (r.ready || r.cooldownMin === 0 ? "READY" : r.cooldownMin + "min") +
        " | " + r.pools + " pools | " + formatNum(r.mftBalance || 0) + " MfT");
    }
    console.log("\nRecent launches:");
    for (const l of data.launches.slice(0, 5)) {
      console.log("  " + l.symbol + " - seed: $" + (Number(l.seed) / 1e6).toFixed(2));
    }
  }).catch(console.error);
}

module.exports = { fetchChainData, formatNum, FIREABLE_REACTORS };
