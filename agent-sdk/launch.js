// MycoPad Agent Launch SDK
// Standalone module for AI agents to launch tokens via MycoPadV2.
//
// Usage:
//   const launch = require('./agent-sdk/launch');
//   const ctx = launch.createLaunchContext(process.env.PRIVATE_KEY);
//   const info = await launch.getFactoryInfo(ctx);
//   const result = await launch.launchToken(ctx, 'MyToken', 'MTK', '1000000', inviteReactor);

const { ethers } = require('ethers');

const BASE_RPC = 'https://mainnet.base.org';

const FACTORY_ADDRESS = '0xbfE4fa5B630d662c375b8F06CF26e75f91CcA4d5';

const FACTORY_ABI = [
  'function launch(string _name, string _symbol, uint256 _totalSupply, address _inviteReactor) payable returns (address tokenAddr, address reactorAddr)',
  'function launchCount() view returns (uint256)',
  'function getLaunch(uint256 index) view returns (address token, address reactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)',
  'function launches(uint256) view returns (address token, address reactor, address launcher, address upstream, uint256 supply, uint256 seed, uint256 timestamp)',
  'function isReactor(address) view returns (bool)',
  'function reactorOf(address) view returns (address)',
  'function minSeed() view returns (uint256)',
  'function owner() view returns (address)',
  'function upstreamReactor() view returns (address)',
  'event TokenLaunched(address indexed token, address indexed reactor, address indexed launcher, string name, string symbol, uint256 supply, uint256 seed)',
];

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function createLaunchContext(privateKey, opts = {}) {
  const provider = new ethers.JsonRpcProvider(opts.rpc || BASE_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);
  return { wallet, provider, factory };
}

function createReadContext(opts = {}) {
  const provider = new ethers.JsonRpcProvider(opts.rpc || BASE_RPC);
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  return { provider, factory };
}

async function getFactoryInfo(ctx) {
  const [launchCount, minSeed, owner, upstream] = await Promise.all([
    ctx.factory.launchCount(),
    ctx.factory.minSeed(),
    ctx.factory.owner(),
    ctx.factory.upstreamReactor(),
  ]);
  return {
    factory: FACTORY_ADDRESS,
    chain: 'Base (8453)',
    launchCount: Number(launchCount),
    minSeedETH: ethers.formatEther(minSeed),
    minSeedWei: minSeed.toString(),
    owner,
    upstreamReactor: upstream,
  };
}

async function checkReactor(ctx, address) {
  const valid = await ctx.factory.isReactor(address);
  return { address, isReactor: valid };
}

async function getLaunch(ctx, index) {
  const [token, reactor, launcher, supply, seed, timestamp] = await ctx.factory.getLaunch(index);
  return {
    index,
    token,
    reactor,
    launcher,
    supply: ethers.formatUnits(supply, 18),
    seedETH: ethers.formatEther(seed),
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

async function launchToken(ctx, name, symbol, totalSupply, inviteReactor = ZERO_ADDR) {
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
    inviteLink: `https://mycopad.memefortrees.com?ref=${reactorAddr}`,
  };
}

module.exports = {
  FACTORY_ADDRESS,
  FACTORY_ABI,
  ZERO_ADDR,
  createLaunchContext,
  createReadContext,
  getFactoryInfo,
  checkReactor,
  getLaunch,
  getRecentLaunches,
  launchToken,
};
