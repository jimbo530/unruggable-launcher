#!/usr/bin/env node
/**
 * unwind-coin-money-walls.js — Remove liquidity from the 3 one-sided COIN/Money
 * sell-wall positions (the 1% pools), returning the coins to treasury and burning
 * the position NFTs. Run this BEFORE re-seeding at 0.01% so the coins are free.
 *
 * Finds each position by enumerating the treasury's NonfungiblePositionManager
 * NFTs and matching (token0, token1, fee) against the recorded walls.
 *
 * Usage:  node deploy/unwind-coin-money-walls.js            (DRY RUN)
 *         node deploy/unwind-coin-money-walls.js --execute   (broadcasts)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.DEPLOY_PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY not found'); process.exit(1); }

const RPC = process.env.BASE_RPC || process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const EXECUTE = process.argv.includes('--execute');
const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const MAX128 = (1n << 128n) - 1n;

const NPM_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 f0,uint256 f1,uint128 owed0,uint128 owed1)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) returns (uint256 amount0,uint256 amount1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256 amount0,uint256 amount1)',
  'function burn(uint256) payable',
];

async function main() {
  const walls = require(path.join(__dirname, 'coin-money-walls-deployed.json')).walls;
  const wantFee = Number(walls[0].fee); // 10000
  const targets = new Map(); // key coin|money -> {sym}
  for (const w of walls) targets.set(`${w.coin.toLowerCase()}|${w.money.toLowerCase()}`, w);

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const me = wallet.address;
  const npm = new ethers.Contract(NPM, NPM_ABI, wallet);

  const bal = Number(await npm.balanceOf(me));
  console.log('Treasury:', me, '| NPM positions:', bal, '| Mode:', EXECUTE ? 'EXECUTE' : 'DRY RUN');

  const found = [];
  for (let i = 0; i < bal; i++) {
    const id = await npm.tokenOfOwnerByIndex(me, i);
    const p = await npm.positions(id);
    const key = `${p.token0.toLowerCase()}|${p.token1.toLowerCase()}`;
    if (targets.has(key) && Number(p.fee) === wantFee) {
      const w = targets.get(key);
      found.push({ id, sym: w.sym, liquidity: p.liquidity, t0: p.token0, t1: p.token1, fee: Number(p.fee) });
      console.log(`  match: tokenId ${id}  ${w.sym}/Money  fee ${p.fee}  liquidity ${p.liquidity}`);
    }
  }

  if (found.length !== walls.length) {
    console.error(`Expected ${walls.length} wall positions, found ${found.length}. Aborting (inspect manually).`);
    if (!EXECUTE) console.log('(dry run — listing only)'); else process.exit(1);
  }

  if (!EXECUTE) { console.log('\nDRY RUN complete. Re-run with --execute to unwind.'); return; }

  for (const f of found) {
    console.log(`\n=== unwinding ${f.sym} (tokenId ${f.id}) ===`);
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    if (f.liquidity > 0n) {
      await (await npm.decreaseLiquidity({ tokenId: f.id, liquidity: f.liquidity, amount0Min: 0n, amount1Min: 0n, deadline })).wait();
      console.log('  liquidity decreased');
      await (await npm.collect({ tokenId: f.id, recipient: me, amount0Max: MAX128, amount1Max: MAX128 })).wait();
      console.log('  collected to treasury');
    } else {
      console.log('  already cleared (liquidity 0)');
    }
    try {
      await (await npm.burn(f.id)).wait();
      console.log('  position NFT burned');
    } catch (e) {
      console.log('  burn skipped (non-fatal, empty NFT left behind):', e.shortMessage || e.message);
    }
  }
  console.log('\nUnwind complete. Coins are back in treasury — now re-seed at 0.01%.');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
