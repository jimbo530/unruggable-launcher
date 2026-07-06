#!/usr/bin/env node
'use strict';
/**
 * build-ship.js — the bot's SHIP-BUILD hand: launch a ship via the LIVE ShipyardV5 (for trade routes).
 *
 * WHY a ship matters to the endowment engine (memory: project_seas_endowment_engine): every ship the
 * bot needs for trade routes carries cargo between the location-gated production LPs → drives the
 * supply-line throughput → recirculates value → grows the edge endowments. A ship is a builder cash-
 * out the same way a structure is: value spent to build it stays in-game (the launch fee + the wall
 * liquidity become productive infra).
 *
 * THE LIVE TARGET (verified mftusd-build/shipyardv5-deployment.json):
 *   ShipyardV5 0x6213104bbb102aA86A86dbf728611439a4510DfE — STAGED, HULL-SIZED crew + captain seat.
 *   Launch = a 3-step staged state machine, each step well under Base's ~16.5M per-tx gas cap
 *   (stage, don't monolith). The RELAYER (gameWallet) pays the dynamic USDC fee in Step 1 and may
 *   advance all 3 steps on a player's behalf:
 *     1) beginLaunchFor(shipOwner, name, symbol, crewCount, captainPawn) -> token  (pays the fee, mints
 *        ShipToken, carves 1% sail slice, builds the Money wall). phase 0->1.
 *     2) launchWalls(token)   -> reactor                                            (meme wall + reactor). phase 1->2.
 *     3) finishLaunch(token)  -> reactor, distributor                                (hull-sized crew + buy-in + registry). phase 2->3.
 *   The result is a BARE, trade-route-capable ship (the sail-rig + row-vault are a heavier curator
 *   follow-on — launch-ship.cjs Stages 4-6 — NOT done by the bot here).
 *
 * SAFETY (real-or-nothing): DRY by default. A live launch needs CITIZEN_ALLOW_LIVE=1 AND the wallet
 * funded with the USDC fee. Reads currentLaunchFee() + checks USDC balance + the crew bounds [1,100]
 * BEFORE doing anything. EXACT fee approval (never MaxUint256). Base-paced fees, explicit nonces.
 * RESUMABLE: a partial launch (phase 1 or 2) is re-fireable — `resume <token>` advances from the
 * current phase. Never fakes a launch; throws loudly on any failure.
 *
 *   node citizen/tools/build-ship.js info                                  # read the yard + fee + my USDC
 *   node citizen/tools/build-ship.js plan --name "Trade Runner" --symbol TRADE [--crew 12] [--captain 0]
 *   node citizen/tools/build-ship.js launch --name "Trade Runner" --symbol TRADE --crew 12 --execute
 *   node citizen/tools/build-ship.js resume <token> --execute                # advance a partial launch
 *   node citizen/tools/build-ship.js phase <token>                           # read staged phase 0..3
 */
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const gs = require('../../gap-scan.js');
const chain = require('../lib/chain.js');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
function argOf(args, f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; }

// Verified live ShipyardV5 (mftusd-build/shipyardv5-deployment.json) — never typed from memory; this
// is the canonical record's address. The bot only ever READS or calls the staged launch entrypoints.
const SHIPYARD_V5 = '0x6213104bbb102aA86A86dbf728611439a4510DfE';
const USDC = gs.ADDR.usdc;
const MIN_CREW = 1, MAX_CREW = 100;

const YARD_ABI = [
  'function currentLaunchFee() view returns (uint256)',
  'function launchCount() view returns (uint256)',
  'function launchPhase(address token) view returns (uint8)',
  'function owner() view returns (address)',
  'function staged(address) view returns (uint8 phase,address launcher,address reactor,uint256 sailSlice,uint256 fee,uint256 moneyWallId,uint256 memeWallId,uint256 crewCount,uint256 captainPawn,address relayer,string name,string symbol)',
  'function reactorOf(address) view returns (address)',
  'function distributorOf(address) view returns (address)',
  'function beginLaunchFor(address shipOwner,string name,string symbol,uint256 crewCount,uint256 captainPawn) returns (address)',
  'function launchWalls(address token) returns (address)',
  'function finishLaunch(address token) returns (address,address)',
  'event LaunchBegan(address indexed token, address indexed launcher)',
  'event ShipLaunched(address indexed token, address reactor, address distributor, address indexed launcher, string name, string symbol)',
];

const FEES = { maxFeePerGas: ethers.parseUnits('0.15', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.02', 'gwei') };
const GAS_STEP = 12_000_000n; // each staged step <16.5M Base cap (matches launch-ship.cjs GAS.launch)

function yardRead() { return new ethers.Contract(SHIPYARD_V5, YARD_ABI, chain.provider()); }

/** Read the yard's fee, the wallet's USDC, and whether this wallet is the authorized relayer. */
async function readContext() {
  const yard = yardRead();
  const addr = chain.walletAddress();
  const [fee, count, owner] = await Promise.all([
    yard.currentLaunchFee(), yard.launchCount(), yard.owner(),
  ]);
  let usdc = 0n;
  if (addr) usdc = await chain.erc(USDC).balanceOf(addr);
  // ShipyardV5 beginLaunchFor is PERMISSIONLESS (msg.sender records as the per-launch relayer; the
  // shipOwner receives the crew). Any funded caller can launch on a player's behalf — no global
  // gameWallet gate. Steps 2/3 are gated to (launcher OR relayer) per-token.
  return {
    shipyard: SHIPYARD_V5,
    feeWei: fee, feeUsd: Number(ethers.formatUnits(fee, 6)),
    launchCount: Number(count),
    wallet: addr,
    walletUsdc: Number(ethers.formatUnits(usdc, 6)),
    walletUsdcWei: usdc,
    owner,
  };
}

(async () => {
  const args = process.argv.slice(2);
  const cmd = (args[0] || 'info').toLowerCase();

  if (cmd === 'info') {
    const ctx = await readContext();
    out({ ok: true, tool: 'build-ship', mode: 'INFO',
      shipyard: ctx.shipyard, launchFeeUsd: ctx.feeUsd, launchCount: ctx.launchCount,
      wallet: ctx.wallet, walletUsdc: ctx.walletUsdc, owner: ctx.owner,
      relayerModel: 'permissionless beginLaunchFor — msg.sender (this wallet) is the per-launch relayer; shipOwner receives the crew',
      canPayFee: ctx.walletUsdc >= ctx.feeUsd,
      crewBounds: { min: MIN_CREW, max: MAX_CREW },
      flow: ['beginLaunchFor (pays fee, ShipToken + Money wall)', 'launchWalls (meme wall + reactor)', 'finishLaunch (hull crew + buy-in + registry)'],
      note: 'Bare trade-route ship (3 staged steps). The sail-rig + row-vault are a heavier curator follow-on (launch-ship.cjs Stages 4-6), not done here. Real-or-nothing — DRY until CITIZEN_ALLOW_LIVE=1.',
    });
    return;
  }

  if (cmd === 'phase') {
    const token = args[1];
    if (!token || !ethers.isAddress(token)) throw new Error('usage: phase <token>');
    const yard = yardRead();
    const ph = Number(await yard.launchPhase(token));
    const s = await yard.staged(token);
    out({ ok: true, tool: 'build-ship', mode: 'PHASE', token, phase: ph,
      phaseLabel: ['none', 'began (token+money wall)', 'walled (meme+reactor)', 'done (crew+registry)'][ph] || String(ph),
      launcher: s.launcher, relayer: s.relayer, crewCount: Number(s.crewCount), captainPawn: Number(s.captainPawn),
      reactor: s.reactor, name: s.name, symbol: s.symbol });
    return;
  }

  if (cmd === 'plan' || cmd === 'launch') {
    const name = argOf(args, '--name');
    const symbol = argOf(args, '--symbol');
    const crew = argOf(args, '--crew') ? Number(argOf(args, '--crew')) : 12;
    const captain = argOf(args, '--captain') ? Number(argOf(args, '--captain')) : 0;
    const execute = args.includes('--execute');
    if (!name || !symbol) throw new Error('need --name and --symbol');
    if (crew < MIN_CREW || crew > MAX_CREW) throw new Error(`crew ${crew} out of bounds [${MIN_CREW},${MAX_CREW}]`);

    const ctx = await readContext();
    const shipOwner = ctx.wallet; // the bot launches for itself (its own trade fleet); relayer==owner here.
    const canPay = ctx.walletUsdc >= ctx.feeUsd;

    if (cmd === 'launch' && execute) {
      if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1 only after the founder funds + approves');
      const w = chain.loadWallet();
      if (!w) throw new Error('no wallet loaded — run init-wallet.js + fund');
      if (!canPay) throw new Error(`USDC ${ctx.walletUsdc} < launch fee ${ctx.feeUsd} — fund the wallet first (real-or-nothing)`);

      const yard = new ethers.Contract(SHIPYARD_V5, YARD_ABI, w);
      let nonce = await chain.provider().getTransactionCount(w.address, 'pending');
      // EXACT fee approval (read fresh; never MaxUint256).
      const usdcC = new ethers.Contract(USDC, ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'], w);
      const cur = await usdcC.allowance(w.address, SHIPYARD_V5);
      if (cur < ctx.feeWei) { const ax = await usdcC.approve(SHIPYARD_V5, ctx.feeWei, { ...FEES, gasLimit: 120000, nonce: nonce++ }); await ax.wait(); }

      // Step 1
      const tx1 = await yard.beginLaunchFor(shipOwner, name, symbol, BigInt(crew), BigInt(captain), { ...FEES, gasLimit: GAS_STEP, nonce: nonce++ });
      const r1 = await tx1.wait();
      const began = r1.logs.map((l) => { try { return yard.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'LaunchBegan');
      if (!began) throw new Error('Step 1 ran but no LaunchBegan event — refusing to proceed blind');
      const token = began.args.token;
      // Step 2
      const r2 = await (await yard.launchWalls(token, { ...FEES, gasLimit: GAS_STEP, nonce: nonce++ })).wait();
      // Step 3
      const r3 = await (await yard.finishLaunch(token, { ...FEES, gasLimit: GAS_STEP, nonce: nonce++ })).wait();
      const launched = r3.logs.map((l) => { try { return yard.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'ShipLaunched');

      out({ ok: true, tool: 'build-ship', mode: 'LAUNCHED', token, name, symbol, crew, captainPawn: captain,
        reactor: launched ? launched.args.reactor : await yard.reactorOf(token),
        distributor: launched ? launched.args.distributor : await yard.distributorOf(token),
        gas: { step1: r1.gasUsed.toString(), step2: r2.gasUsed.toString(), step3: r3.gasUsed.toString() },
        feePaidUsd: ctx.feeUsd,
        note: 'BARE trade-route ship launched (3 staged steps). Curator follow-on (sail-rig + row-vault) optional via launch-ship.cjs Stages 4-6.' });
      return;
    }

    // DRY plan
    out({ ok: true, tool: 'build-ship', mode: 'DRY-PLAN', name, symbol, crew, captainPawn: captain,
      shipOwner, shipyard: ctx.shipyard, launchFeeUsd: ctx.feeUsd, walletUsdc: ctx.walletUsdc, canPayFee: canPay,
      steps: [
        `beginLaunchFor(${shipOwner}, "${name}", "${symbol}", ${crew}, ${captain}) — pays ~$${ctx.feeUsd} USDC fee, mints ShipToken + Money wall`,
        'launchWalls(token) — meme wall + reactor',
        'finishLaunch(token) — hull-sized crew (' + crew + ' seats) + buy-in + registry',
      ],
      blocked: canPay ? null : `wallet USDC ${ctx.walletUsdc} < fee ${ctx.feeUsd} — fund first`,
      would: execute
        ? (canPay ? 'would launch on --execute (needs CITIZEN_ALLOW_LIVE=1)' : 'CANNOT — insufficient USDC for the fee')
        : `design only. Pass launch --execute (with CITIZEN_ALLOW_LIVE=1 + funded USDC) to launch a ${crew}-seat trade ship.`,
      note: 'Real-or-nothing. Each step is <16.5M gas (stage, don\'t monolith). Resumable: a partial launch can be advanced with `resume <token> --execute`.',
    });
    return;
  }

  if (cmd === 'resume') {
    const token = args[1];
    const execute = args.includes('--execute');
    if (!token || !ethers.isAddress(token)) throw new Error('usage: resume <token> [--execute]');
    const yard0 = yardRead();
    const ph = Number(await yard0.launchPhase(token));
    if (ph === 0) throw new Error(`token ${token} has no staged launch (phase 0)`);
    if (ph === 3) { out({ ok: true, tool: 'build-ship', mode: 'RESUME', token, phase: 3, note: 'already DONE' }); return; }

    if (!execute) { out({ ok: true, tool: 'build-ship', mode: 'DRY-RESUME', token, phase: ph, would: `would advance from phase ${ph} on --execute` }); return; }
    if (process.env.CITIZEN_ALLOW_LIVE !== '1') throw new Error('live disabled — set CITIZEN_ALLOW_LIVE=1');
    const w = chain.loadWallet();
    if (!w) throw new Error('no wallet loaded');
    const yard = new ethers.Contract(SHIPYARD_V5, YARD_ABI, w);
    let nonce = await chain.provider().getTransactionCount(w.address, 'pending');
    const done = [];
    if (ph === 1) { const r = await (await yard.launchWalls(token, { ...FEES, gasLimit: GAS_STEP, nonce: nonce++ })).wait(); done.push({ step: 'launchWalls', gas: r.gasUsed.toString() }); }
    const r3 = await (await yard.finishLaunch(token, { ...FEES, gasLimit: GAS_STEP, nonce: nonce++ })).wait();
    done.push({ step: 'finishLaunch', gas: r3.gasUsed.toString() });
    out({ ok: true, tool: 'build-ship', mode: 'RESUMED', token, fromPhase: ph, done,
      reactor: await yard.reactorOf(token), distributor: await yard.distributorOf(token) });
    return;
  }

  throw new Error(`unknown command "${cmd}" — use: info | plan | launch | resume <token> | phase <token>`);
})().catch((e) => { out({ ok: false, tool: 'build-ship', error: e.message || String(e), hint: 'run `node citizen/tools/build-ship.js info` first; launching needs a USDC fee + CITIZEN_ALLOW_LIVE=1.' }); process.exit(1); });
