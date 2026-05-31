// Unrugable Agent Launch SDK
// Standalone module for AI agents to interact with Unrugable (V5.2 Factory + Adoption) on Base.
//
// Usage (read-only):
//   const launch = require('./agent-sdk/launch');
//   const ctx = launch.createReadContext();
//   const info = await launch.getFactoryInfo(ctx);
//   const recent = await launch.getRecentLaunches(ctx);
//   const adopted = await launch.checkAdoption(ctx, '0x...');
//
// NOTE: launchToken() needs updating for V5.2 (USDC seed, two-step flow).
// Do not call launchToken() until it is rewritten for the new factory.

const { ethers } = require('ethers');

const BASE_RPC = 'https://mainnet.base.org';

const FACTORY_ADDRESS = '0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51'; // V5.2 active

const FACTORY_ABI = [
  'function launchCount() view returns (uint256)',
  'function launches(uint256) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)',
  'function isReactor(address) view returns (bool)',
  'function minSeed() view returns (uint256)',
  'function upstreamReactor() view returns (address)',
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed charReactor, address launcher, string name, string symbol, uint256 supply, uint256 seed)',
];

const ADOPTION_ADDRESS = '0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d';

const ADOPTION_ABI = [
  'function adoptionCount() view returns (uint256)',
  'function adopterOf(address token) view returns (address)',
  'function reactorOf(address token) view returns (address)',
  'event TokenAdopted(address indexed token, address indexed reactor, address indexed adopter, address upstreamReactor, string name, string symbol)',
];

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function createLaunchContext(privateKey, opts = {}) {
  const provider = new ethers.JsonRpcProvider(opts.rpc || BASE_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);
  const adoption = new ethers.Contract(ADOPTION_ADDRESS, ADOPTION_ABI, wallet);
  return { wallet, provider, factory, adoption };
}

function createReadContext(opts = {}) {
  const provider = new ethers.JsonRpcProvider(opts.rpc || BASE_RPC);
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const adoption = new ethers.Contract(ADOPTION_ADDRESS, ADOPTION_ABI, provider);
  return { provider, factory, adoption };
}

async function getFactoryInfo(ctx) {
  const [launchCount, minSeed, upstream] = await Promise.all([
    ctx.factory.launchCount(),
    ctx.factory.minSeed(),
    ctx.factory.upstreamReactor(),
  ]);
  return {
    factory: FACTORY_ADDRESS,
    chain: 'Base (8453)',
    launchCount: Number(launchCount),
    minSeedUSDC: (Number(minSeed) / 1e6).toFixed(2),
    minSeedRaw: minSeed.toString(),
    upstreamReactor: upstream,
  };
}

async function checkReactor(ctx, address) {
  const valid = await ctx.factory.isReactor(address);
  return { address, isReactor: valid };
}

async function getLaunch(ctx, index) {
  const [token, reactor, charReactor, launcher, supply, seed, timestamp] = await ctx.factory.launches(index);
  return {
    index,
    token,
    reactor,
    charReactor,
    launcher,
    supply: ethers.formatUnits(supply, 18),
    seedUSDC: (Number(seed) / 1e6).toFixed(2),
    timestamp: Number(timestamp),
    date: new Date(Number(timestamp) * 1000).toISOString(),
  };
}

async function getRecentLaunches(ctx, count = 5) {
  const total = Number(await ctx.factory.launchCount());
  const start = Math.max(0, total - count);
  const results = [];
  for (let i = total - 1; i >= start; i--) {
    results.push(await getLaunch(ctx, i));
  }
  return { total, showing: results.length, launches: results };
}

// WARNING: This function is NOT updated for V5.2 factory.
// V5.2 uses USDC seed (not ETH) and a two-step launch flow.
// Do NOT call this until it is rewritten.
async function launchToken(ctx, name, symbol, totalSupply, inviteReactor = ZERO_ADDR) {
  throw new Error('launchToken() not yet updated for V5.2 factory — needs USDC seed flow rewrite');
  if (!name || !symbol) throw new Error('name and symbol are required');

  const supply = ethers.parseUnits(String(totalSupply), 18);
  const minSeed = await ctx.factory.minSeed();

  // Validate invite reactor if provided
  if (inviteReactor !== ZERO_ADDR) {
    const valid = await ctx.factory.isReactor(inviteReactor);
    if (!valid) throw new Error(`Invalid invite reactor: ${inviteReactor}`);
  }

  const tx = await ctx.factory.launch(name, symbol, supply, inviteReactor, { value: minSeed });
  const receipt = await tx.wait();

  // Parse TokenLaunched event
  const launchEvent = receipt.logs
    .map(log => { try { return ctx.factory.interface.parseLog(log); } catch { return null; } })
    .find(e => e && e.name === 'TokenLaunched');

  if (!launchEvent) throw new Error('Launch tx succeeded but no TokenLaunched event found');

  const tokenAddr = launchEvent.args.token;
  const reactorAddr = launchEvent.args.reactor;

  return {
    ok: true,
    token: tokenAddr,
    reactor: reactorAddr,
    name,
    symbol,
    supply: totalSupply,
    seedETH: ethers.formatEther(minSeed),
    launcher: ctx.wallet.address,
    upstream: inviteReactor === ZERO_ADDR ? 'MfT Reactor Prime (default)' : inviteReactor,
    txHash: receipt.hash,
    inviteLink: `https://tasern.quest/launcher/unrugable.html?ref=${reactorAddr}`,
  };
}

async function getAdoptionInfo(ctx) {
  const count = Number(await ctx.adoption.adoptionCount());
  return {
    contract: ADOPTION_ADDRESS,
    adoptionCount: count,
  };
}

async function checkAdoption(ctx, tokenAddress) {
  const [adopter, reactor] = await Promise.all([
    ctx.adoption.adopterOf(tokenAddress),
    ctx.adoption.reactorOf(tokenAddress),
  ]);
  const isAdopted = adopter !== ZERO_ADDR;
  return {
    token: tokenAddress,
    isAdopted,
    adopter: isAdopted ? adopter : null,
    reactor: isAdopted ? reactor : null,
  };
}

module.exports = {
  FACTORY_ADDRESS,
  FACTORY_ABI,
  ADOPTION_ADDRESS,
  ADOPTION_ABI,
  ZERO_ADDR,
  createLaunchContext,
  createReadContext,
  getFactoryInfo,
  getAdoptionInfo,
  checkAdoption,
  checkReactor,
  getLaunch,
  getRecentLaunches,
  launchToken,
};
