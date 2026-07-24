#!/usr/bin/env node
/**
 * resource-lever.js — the TREASURY monetary-policy lever for ALL world-resource keyed pools (founder
 * 2026-06-26: "world imbalance is something we just need to build ourselves … they buy from us and we
 * can sell into them with supply … we have 100B thats a lot of selling to keep them low if needed").
 *
 * TRAINING WHEELS → SELF-GOVERNANCE (founder 2026-06-26: "same levers to transition from short term
 * control to long term self governing"). SHORT TERM: thin liquidity needs a heavy hand, so we manage
 * every world-resource price by hand from the 100B reserve. LONG TERM: as fish sales capitalize the
 * ocean-water vaults, the vaults + player arb assume this exact job and dev intervention tapers to 0.
 * Same tool, same pools, dialed down as the economy learns to stand on its own.
 *
 * We hold 100B of every world resource (fish, crab, logs, lumber, grapes, …), so we ARE the market.
 * Three levers on any gated LocationPool (RESOURCE/GOLD):
 *   • restock  — inject() the resource side from our reserve. Single-sided, PERMANENT, no gold back.
 *                Price DROPS → keeps the catch cheap. "if they fish out the ocean we dump fish back in."
 *   • sell     — self-attested swap RESOURCE→GOLD. Collects the gold players paid in (PROFIT) AND
 *                pushes the price back down. The gold funds the ocean-water vault → "run the engines
 *                long term" (the resource reserve bootstraps the vault principal; no dev USDC).
 *   • buy      — self-attested swap GOLD→RESOURCE. Price UP → engineer scarcity / a trade route.
 *   • quote    — show reserves + the implied gold price (read-only).
 *
 * Self-attestation: swaps are gated, but WE own the gameSigner key (location-signer.cjs), so the
 * treasury signs its own presence. (If a pool's cooldown blocks repeat treasury swaps, setParams
 * cooldown=0 on pools we run — owner-only.) ADD-ONLY contract: admin can never WITHDRAW; gold only
 * comes back to us via `sell` swaps, never a drain. Guardian: DRY-RUN by default; --execute to send.
 *
 *   node deploy/resource-lever.js quote   <poolAddr>
 *   BASE_RPC=<alchemy> node deploy/resource-lever.js restock <poolAddr> <units>        --execute
 *   BASE_RPC=<alchemy> node deploy/resource-lever.js sell    <poolAddr> <units>        --execute
 *   BASE_RPC=<alchemy> node deploy/resource-lever.js buy     <poolAddr> <goldUnits>    --execute
 */
const { ethers } = require('ethers');
const path = require('path');
const { signSwap } = require(path.join(__dirname, '..', 'game', 'server', 'location-signer.cjs'));
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const GOLD = '0x2065d87b3a1FACc9A4fE037D7a58bC069F597004';
const ONE = 10n ** 18n;
const SLIPPAGE_BPS = 200n;   // 2% min-out cushion on treasury swaps
const EXECUTE = process.argv.includes('--execute');

const POOL_ABI = [
  'function token0() view returns (address)', 'function token1() view returns (address)',
  'function getReserves() view returns (uint256,uint256)', 'function feeBps() view returns (uint16)',
  'function maxSwapIn() view returns (uint256)', 'function location() view returns (uint256)',
  'function quote(bool,uint256) view returns (uint256)',
  'function inject(bool,uint256)',
  'function swap(bool,uint256,uint256,uint256,bytes) returns (uint256)',
];
const ERC20_ABI = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)'];
const FEES = { maxFeePerGas: ethers.parseUnits('0.1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };

async function main() {
  const [cmd, poolAddr, amtArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!cmd || !poolAddr) { console.error('usage: resource-lever.js <quote|restock|sell|buy> <poolAddr> [units] [--execute]'); process.exit(1); }
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const pool = new ethers.Contract(poolAddr, POOL_ABI, wallet);

  const [t0, t1] = [await pool.token0(), await pool.token1()];
  const goldIsT0 = t0.toLowerCase() === GOLD.toLowerCase();
  const resource = goldIsT0 ? t1 : t0;                     // the non-GOLD side = the world resource
  const [r0, r1] = await pool.getReserves();
  const [resRes, goldRes] = goldIsT0 ? [r1, r0] : [r0, r1];
  const sym = await new ethers.Contract(resource, ERC20_ABI, provider).symbol().catch(() => 'RES');
  const price = resRes > 0n ? Number(goldRes) / Number(resRes) : 0;       // gold per 1 resource
  console.log(`Pool ${poolAddr}  loc ${await pool.location()}`);
  console.log(`  reserves: ${ethers.formatUnits(resRes)} ${sym}  /  ${ethers.formatUnits(goldRes)} GOLD`);
  console.log(`  price   : ${price.toFixed(6)} gold per ${sym}  (fee ${await pool.feeBps()} bps, maxSwapIn ${ethers.formatUnits(await pool.maxSwapIn())})`);
  if (cmd === 'quote') return;

  const units = BigInt(Math.round(parseFloat(amtArg || '0')));
  if (units <= 0n) { console.error('need a positive <units>'); process.exit(1); }
  const amt = units * ONE;
  console.log(`\n${cmd.toUpperCase()} ${units} ${cmd === 'buy' ? 'GOLD' : sym}  | mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);
  if (!EXECUTE) { console.log('DRY RUN — add --execute (BASE_RPC=<alchemy>) to send. Guardian gate: needs explicit approval.'); return; }

  let nonce = await provider.getTransactionCount(me, 'pending');

  if (cmd === 'restock') {
    // inject the RESOURCE side (side0 if resource is token0) — single-sided, permanent, price ↓
    const side0 = !goldIsT0;
    await (await new ethers.Contract(resource, ERC20_ABI, wallet).approve(poolAddr, amt, { ...FEES, nonce: nonce++, gasLimit: 100000 })).wait();
    const rc = await (await pool.inject(side0, amt, { ...FEES, nonce: nonce++, gasLimit: 200000 })).wait();
    console.log(`  restocked ${units} ${sym} (inject side0=${side0}) — tx ${rc.hash}`);
    return;
  }

  // sell (resource→gold) or buy (gold→resource): self-attested gated swap
  const sellingResource = cmd === 'sell';
  const tokenIn = sellingResource ? resource : GOLD;
  // zeroForOne = token0 in. resource-in: zeroForOne = !goldIsT0 ; gold-in: zeroForOne = goldIsT0
  const zeroForOne = sellingResource ? !goldIsT0 : goldIsT0;
  const cap = await pool.maxSwapIn();
  if (cap > 0n && amt > cap) { console.error(`amountIn ${units} exceeds maxSwapIn ${ethers.formatUnits(cap)} — split it`); process.exit(1); }
  const expectedOut = await pool.quote(zeroForOne, amt);
  const minOut = expectedOut * (10000n - SLIPPAGE_BPS) / 10000n;
  const att = await signSwap(poolAddr, me);                // we self-attest (we own the gameSigner key)
  await (await new ethers.Contract(tokenIn, ERC20_ABI, wallet).approve(poolAddr, amt, { ...FEES, nonce: nonce++, gasLimit: 100000 })).wait();
  const rc = await (await pool.swap(zeroForOne, amt, minOut, att.expiry, att.sig, { ...FEES, nonce: nonce++, gasLimit: 300000 })).wait();
  console.log(`  ${cmd} done: in ${units} ${sellingResource ? sym : 'GOLD'} → out ~${ethers.formatUnits(expectedOut)} ${sellingResource ? 'GOLD' : sym}  — tx ${rc.hash}`);
  console.log(sellingResource ? '  (gold collected → earmark for ocean-water vault principal)' : '  (resource price nudged up — scarcity)');
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
