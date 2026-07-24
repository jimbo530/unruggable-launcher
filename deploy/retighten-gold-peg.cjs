#!/usr/bin/env node
/**
 * retighten-gold-peg.cjs — re-concentrate the GOLD/Money peg into a tight, up-only penny wall.
 *
 * FOUNDER DESIGN 2026-07-24: the old wall smears ~2B gold from $0.01 -> infinity (loose ceiling, no
 * floor). Replace it with a SINGLE gold-only wall pinned $0.01 -> $0.0105 — a $20M brick right on the
 * penny. Gold can only be BOUGHT at >= $0.01 (no bid below, so it never trades under a penny = "0.01 or
 * more, not less"), and there is no $0.009 floor to bleed a spread on round-trips. Demand eats into a
 * tight band -> price ticks UP = a gain, not a bleed.
 *
 * MOVE (all on OUR own position — this is a withdrawable Uniswap v3 NFT, not an add-only game pool):
 *   1. decreaseLiquidity(100%) + collect on tokenId 5396400  -> ~2B GOLD + ~$25 Money to 0xE2a4
 *   2. mint a NEW gold-only position [tickLower $0.01, tickUpper $0.0105] with the collected gold
 * The ~$25 Money just returns to treasury (no floor position, by design).
 *
 * SAFETY: our wallet (0xE2a4) owns the NFT; exact gold approval to the NPM (never MaxUint); Base-paced
 * fees; explicit nonces; one tx at a time; real-or-nothing (a revert is surfaced, never faked). The new
 * position is deliberately CONCENTRATED (a peg) — DO NOT lock/renounce it; keep it re-centerable.
 *   DRY by default:  node deploy/retighten-gold-peg.cjs
 *   LIVE:            node deploy/retighten-gold-peg.cjs --execute
 */
'use strict';
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'mftusd-build', '.env') });

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';   // Uniswap v3 NonfungiblePositionManager (Base)
const POOL = '0x18A880F2EDe190B1dad8D11f8A22F1B273c16A08';  // GOLD/Money 0.01% peg pool
const GOLD = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004';  // token0 (18 dec)
const MONEY = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072'; // token1 (6 dec)
const OWNER = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
const TOKEN_ID = 5396400n;
const FEE = 100;
const TICK_LOWER = -322377; // just ABOVE $0.01 (pool tick is -322378) => PURE gold, no Money needed
const TICK_UPPER = -321890; // $0.010498  (~$0.0105)
const WALL_GOLD = ethers.parseUnits('2000000000', 18); // the 2B ("$20M brick"), from treasury
const MAX_U128 = (1n << 128n) - 1n;
const EXECUTE = process.argv.includes('--execute');

const MAX_FEE = ethers.parseUnits('0.15', 'gwei');
const PRIORITY = ethers.parseUnits('0.02', 'gwei');

const NPM_ABI = [
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowth0,uint256 feeGrowth1,uint128 tokensOwed0,uint128 tokensOwed1)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256 amount0,uint256 amount1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const tickToUsd = (t) => Math.pow(1.0001, t) * 1e12;
const gfmt = (w) => Number(ethers.formatUnits(w, 18));

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true, batchMaxCount: 1 });
  console.log('=================================================================');
  console.log(' RE-TIGHTEN GOLD PEG  —  single gold wall $0.01 → $0.0105');
  console.log(`   mode: ${EXECUTE ? '*** LIVE ***' : 'DRY (no tx)'}`);
  console.log(`   position: NFT ${TOKEN_ID}  pool ${POOL}`);
  console.log(`   new band: tick [${TICK_LOWER}, ${TICK_UPPER}] = $${tickToUsd(TICK_LOWER).toFixed(6)} → $${tickToUsd(TICK_UPPER).toFixed(6)}`);
  console.log('=================================================================');

  const npmR = new ethers.Contract(NPM, NPM_ABI, provider);
  const pos = await npmR.positions(TOKEN_ID);
  if (pos.token0.toLowerCase() !== GOLD.toLowerCase() || pos.token1.toLowerCase() !== MONEY.toLowerCase()) {
    throw new Error(`tokenId ${TOKEN_ID} is not the GOLD/Money position (got ${pos.token0}/${pos.token1})`);
  }
  console.log(`\n1) PULL: position holds liquidity=${pos.liquidity}  (ticks ${pos.tickLower}..${pos.tickUpper})`);
  const goldInPool = await new ethers.Contract(GOLD, ERC20_ABI, provider).balanceOf(POOL);
  console.log(`   pool currently holds ~${gfmt(goldInPool).toLocaleString()} GOLD → pulling ~all of it back to ${OWNER}`);

  if (!EXECUTE) {
    console.log(`\n2) REMINT (planned): gold-only wall, ~${gfmt(goldInPool).toLocaleString()} GOLD into [$0.01, $0.0105]`);
    console.log(`   (money side: ~$25 returns to treasury, no floor position — by design)`);
    console.log('\nDRY complete — re-run with --execute to pull + remint.');
    return;
  }

  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error('AGENT_PRIVATE_KEY not set (mftusd-build/.env)');
  const wallet = new ethers.Wallet(key.startsWith('0x') ? key : `0x${key}`, provider);
  if (wallet.address.toLowerCase() !== OWNER.toLowerCase()) throw new Error(`key is ${wallet.address}, expected ${OWNER}`);
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);
  const gold = new ethers.Contract(GOLD, ERC20_ABI, wallet);
  const fees = { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY };
  let nonce = await provider.getTransactionCount(OWNER, 'pending');
  const deadline = () => Math.floor(Date.now() / 1000) + 900;

  let tx, rc;
  // 1) PULL — only if the old position still holds liquidity (idempotent: skip if already pulled).
  if (pos.liquidity > 0n) {
    console.log('\n→ decreaseLiquidity(100%)…');
    tx = await npm.decreaseLiquidity({ tokenId: TOKEN_ID, liquidity: pos.liquidity, amount0Min: 0, amount1Min: 0, deadline: deadline() }, { ...fees, nonce: nonce++, gasLimit: 400000 });
    rc = await tx.wait(); if (rc.status !== 1) throw new Error(`decreaseLiquidity reverted ${tx.hash}`);
    console.log(`  ✓ ${tx.hash}`);
    console.log('→ collect(max)…');
    tx = await npm.collect({ tokenId: TOKEN_ID, recipient: OWNER, amount0Max: MAX_U128, amount1Max: MAX_U128 }, { ...fees, nonce: nonce++, gasLimit: 300000 });
    rc = await tx.wait(); if (rc.status !== 1) throw new Error(`collect reverted ${tx.hash}`);
    console.log(`  ✓ ${tx.hash}`);
  } else {
    console.log('\n  (position already empty — skipping pull; reminting from treasury gold)');
  }

  const goldBal = await gold.balanceOf(OWNER);
  if (goldBal < WALL_GOLD) throw new Error(`treasury has ${gfmt(goldBal)} GOLD, need ${gfmt(WALL_GOLD)} for the wall`);
  console.log(`  treasury GOLD ${gfmt(goldBal).toLocaleString()} → walling ${gfmt(WALL_GOLD).toLocaleString()}`);

  // 2) approve exact gold + mint the tight, PURE-gold wall (tickLower is above the pool tick)
  console.log('→ approve GOLD to NPM (exact)…');
  const cur = await gold.allowance(OWNER, NPM);
  if (cur < WALL_GOLD) { tx = await gold.approve(NPM, WALL_GOLD, { ...fees, nonce: nonce++, gasLimit: 70000 }); await tx.wait(); console.log(`  ✓ approve ${tx.hash}`); }
  console.log('→ mint gold-only wall [$0.01+, $0.0105]…');
  tx = await npm.mint({
    token0: GOLD, token1: MONEY, fee: FEE, tickLower: TICK_LOWER, tickUpper: TICK_UPPER,
    amount0Desired: WALL_GOLD, amount1Desired: 0, amount0Min: 0, amount1Min: 0, recipient: OWNER, deadline: deadline(),
  }, { ...fees, nonce: nonce++, gasLimit: 600000 });
  rc = await tx.wait(); if (rc.status !== 1) throw new Error(`mint reverted ${tx.hash}`);
  console.log(`  ✓ mint ${tx.hash}`);
  console.log('\n=================================================================');
  console.log(` DONE. Gold peg re-tightened: ${gfmt(WALL_GOLD).toLocaleString()} GOLD walled $0.01 → $0.0105.`);
  console.log('=================================================================');
}
main().catch((e) => { console.error('[retighten] FATAL:', e.message || e); process.exit(1); });
