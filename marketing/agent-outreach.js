/**
 * agent-outreach.js — Send MfT airdrops + pitch to scouted agent wallets
 *
 * Uses agent-scout.js targets. Sends MfT on-chain, casts on Farcaster if available.
 *
 * Usage:
 *   node agent-outreach.js --preview          Show targets + amounts, no sends
 *   node agent-outreach.js --send [count]     Send to top N targets (default 5)
 *   node agent-outreach.js --cast [count]     Farcaster DM/cast to top N with accounts
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');
const { getOutreachTargets, markContacted, getStats } = require('./agent-scout');

const RPC = 'https://mainnet.base.org';
const PK = process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY;
const NEYNAR_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_SIGNER = process.env.NEYNAR_SIGNER_UUID;

const MFT_ADDR = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
];

// Airdrop tiers — more MfT for hotter targets
const AIRDROP_AMOUNTS = {
  hot:  ethers.parseEther('1000'),   // 1000 MfT
  warm: ethers.parseEther('500'),    // 500 MfT
  cold: ethers.parseEther('100'),    // 100 MfT
};

// Pitch note — condensed for agents, included in Farcaster cast
const PITCH_NOTE = `MfT on Base — 31 reactors fire every 2hrs. Clock-based alpha across 180+ pools.

Your volume feeds the burn engine. Even sells are fuel. Route through reactor pools and your fees compound into MfT buy pressure automatically.

No API keys. No permissions. execute() is permissionless. Trade any Unruggable token or fire reactors yourself.

npm install baselings-mcp — 40 agent-native tools.
Contracts: tasern.quest/api/unruggable/tokenomics
Discovery: tasern.quest/llms.txt`;

// Shorter version for Farcaster (320 char limit)
const PITCH_SHORT = `MfT on Base — 31 reactors fire every 2hrs. Your trades feed the burn engine. Even sells are fuel.

No API keys. Permissionless. 180+ pools.

tasern.quest/llms.txt`;

function ts() { return new Date().toISOString().slice(11, 19); }

async function previewTargets(count) {
  const targets = getOutreachTargets(count);
  const stats = getStats();

  console.log('=== Outreach Preview ===');
  console.log(`Total scouted: ${stats.total} (${stats.hot} hot / ${stats.warm} warm / ${stats.cold} cold)`);
  console.log(`Already contacted: ${stats.contacted}`);
  console.log(`With Farcaster: ${stats.withFarcaster}`);
  console.log('');

  if (targets.length === 0) {
    console.log('No uncontacted targets. Run agent-scout.js first.');
    return;
  }

  let totalMft = 0n;
  console.log(`Top ${targets.length} targets:\n`);
  for (const t of targets) {
    const amount = AIRDROP_AMOUNTS[t.tier] || AIRDROP_AMOUNTS.cold;
    totalMft += amount;
    const amtStr = ethers.formatEther(amount);
    const fc = t.username ? `@${t.username} (${t.followerCount || 0} followers)` : 'no Farcaster';
    const sigs = (t.signals || []).slice(0, 3).join(', ');
    console.log(`  [${(t.tier || 'cold').padEnd(4)}] ${t.address}`);
    console.log(`         ${amtStr} MfT | ${fc} | ${sigs}`);
  }

  console.log(`\nTotal MfT needed: ${ethers.formatEther(totalMft)}`);
  return targets;
}

async function sendAirdrops(count) {
  if (!PK) { console.error('Set AGENT_PRIVATE_KEY'); return; }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const mft = new ethers.Contract(MFT_ADDR, ERC20_ABI, wallet);

  const bal = await mft.balanceOf(wallet.address);
  const ethBal = await provider.getBalance(wallet.address);
  console.log(`[${ts()}] Wallet: ${wallet.address}`);
  console.log(`[${ts()}] MfT balance: ${ethers.formatEther(bal)}`);
  console.log(`[${ts()}] ETH balance: ${ethers.formatEther(ethBal)}`);

  const targets = getOutreachTargets(count);
  if (targets.length === 0) {
    console.log('No targets. Run agent-scout.js first.');
    return;
  }

  let totalNeeded = 0n;
  for (const t of targets) {
    totalNeeded += AIRDROP_AMOUNTS[t.tier] || AIRDROP_AMOUNTS.cold;
  }

  if (bal < totalNeeded) {
    console.error(`Not enough MfT. Have ${ethers.formatEther(bal)}, need ${ethers.formatEther(totalNeeded)}`);
    return;
  }

  console.log(`\n[${ts()}] Sending MfT to ${targets.length} agent wallets...`);
  console.log('');

  let sent = 0, failed = 0;
  for (const t of targets) {
    const amount = AIRDROP_AMOUNTS[t.tier] || AIRDROP_AMOUNTS.cold;
    const amtStr = ethers.formatEther(amount);
    const label = t.username ? `@${t.username}` : t.address.slice(0, 14) + '...';

    try {
      const tx = await mft.transfer(t.address, amount);
      const receipt = await tx.wait();
      console.log(`[${ts()}] SENT ${amtStr} MfT → ${label} (${t.tier}) tx=${tx.hash.slice(0, 14)}...`);
      markContacted(t.address);
      sent++;
    } catch (e) {
      console.error(`[${ts()}] FAIL ${label}: ${(e.message || '').slice(0, 80)}`);
      failed++;
    }

    // 5 sec between sends to avoid nonce issues
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\n[${ts()}] Done. Sent: ${sent} | Failed: ${failed}`);
}

async function castToTargets(count) {
  if (!NEYNAR_KEY || !NEYNAR_SIGNER) {
    console.error('Set NEYNAR_API_KEY and NEYNAR_SIGNER_UUID for Farcaster casts');
    return;
  }

  const targets = getOutreachTargets(count)
    .filter(t => t.platform === 'farcaster' && t.fid);

  if (targets.length === 0) {
    console.log('No Farcaster-enabled targets. Run agent-scout.js --enrich first.');
    return;
  }

  console.log(`[${ts()}] Casting to ${targets.length} Farcaster agent accounts...\n`);

  let sent = 0;
  for (const t of targets) {
    const text = PITCH_SHORT;
    try {
      const res = await fetch('https://api.neynar.com/v2/farcaster/cast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          api_key: NEYNAR_KEY,
        },
        body: JSON.stringify({
          signer_uuid: NEYNAR_SIGNER,
          text: `@${t.username} ${text}`,
        }),
      });

      if (res.ok) {
        console.log(`[${ts()}] CAST → @${t.username} (fid:${t.fid}, ${t.followerCount || 0} followers)`);
        sent++;
      } else {
        const err = await res.text();
        console.error(`[${ts()}] CAST FAIL @${t.username}: ${err.slice(0, 80)}`);
      }
    } catch (e) {
      console.error(`[${ts()}] CAST ERROR @${t.username}: ${(e.message || '').slice(0, 80)}`);
    }

    // Rate limit: 1 cast per 10 sec
    await new Promise(r => setTimeout(r, 10000));
  }

  console.log(`\n[${ts()}] Casts sent: ${sent}/${targets.length}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const count = parseInt(args[1] || '5', 10);

  if (args.includes('--preview')) {
    previewTargets(count);
  } else if (args.includes('--send')) {
    sendAirdrops(count);
  } else if (args.includes('--cast')) {
    castToTargets(count);
  } else {
    console.log('Usage:');
    console.log('  node agent-outreach.js --preview [count]   Show targets + amounts');
    console.log('  node agent-outreach.js --send [count]      Send MfT airdrops');
    console.log('  node agent-outreach.js --cast [count]      Farcaster cast to targets');
    console.log('');
    console.log('Pitch message:');
    console.log(PITCH_SHORT);
  }
}

module.exports = { previewTargets, sendAirdrops, castToTargets, PITCH_NOTE, PITCH_SHORT };
