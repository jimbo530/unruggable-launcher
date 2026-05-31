require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const MFT_REACTOR = '0xf8ea9545fbe51F0C859e155AD81964fFcE17E30d';
const MFT = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

// Known MfT pair tokens (from ChainReactor pools)
const PAIRS = [
  { symbol: 'AZUSD',     addr: '0x3595ca37596D5895B70EFAB592ac315D5B9809B2', fees: [10000, 500] },
  { symbol: 'MfTUSD',    addr: '0xe96fa44b4b82F085a457F9B7a0F85ea26FF1652F', fees: [10000] },
  { symbol: 'TGN',       addr: '0xD75dfa972C6136f1c594Fec1945302f885E1ab29', fees: [10000] },
  { symbol: 'cbBTC',     addr: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', fees: [10000] },
  { symbol: 'BURGERS',   addr: '0x06A05043eb2C1691b19c2C13219dB9212269dDc5', fees: [10000] },
  { symbol: 'CHAR',      addr: '0x20b048fA035D5763685D695e66aDF62c5D9F5055', fees: [10000] },
  { symbol: 'EGP',       addr: '0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe', fees: [10000] },
  { symbol: 'POOP',      addr: '0x00B7B8cFEb7eBa4e3BEbC73Bea1e1523d15a4702', fees: [10000] },
  { symbol: 'BB',        addr: '0xf967bf3dccF8b6826F82de1781C98E61Bda3b106', fees: [10000] },
  { symbol: 'EB',        addr: '0x17a176Ab2379b86F1E65D79b03bD8c75981244D8', fees: [10000] },
  { symbol: 'ecowealth', addr: '0x170dc0ca26f1247ced627d8abcafa90ecf1e1519', fees: [10000] },
  { symbol: 'PIZZA',     addr: '0x84BF55C117bc97323d332f08782ADBCAf3B15468', fees: [10000] },
  { symbol: 'NFS',       addr: '0xb9630280DC93c503aEE06d1Eca8E125fc19AB3c5', fees: [10000] },
];

const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const REACTOR_ABI = [
  'function addPool(address v3Pool)',
  'function poolCount() view returns (uint256)',
  'function pools(uint256) view returns (address v3Pool, address token0, address token1, uint24 fee, bool disabled)'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log('Wallet:', wallet.address);

  const factory = new ethers.Contract(V3_FACTORY, FACTORY_ABI, provider);
  const reactor = new ethers.Contract(MFT_REACTOR, REACTOR_ABI, wallet);

  // Find all existing V3 pools for MfT pairs
  const poolsToAdd = [];

  for (const pair of PAIRS) {
    for (const fee of pair.fees) {
      await sleep(400);
      try {
        const pool = await factory.getPool(MFT, pair.addr, fee);
        if (pool === '0x0000000000000000000000000000000000000000') {
          console.log(`  ${pair.symbol} fee:${fee} — no pool exists`);
          continue;
        }
        console.log(`  ${pair.symbol} fee:${fee} — pool: ${pool}`);
        poolsToAdd.push({ symbol: pair.symbol, fee, pool });
      } catch(e) {
        console.log(`  ${pair.symbol} fee:${fee} — error: ${e.message}`);
      }
    }
  }

  console.log(`\nFound ${poolsToAdd.length} pools to add.\n`);

  // Add each pool
  for (const p of poolsToAdd) {
    try {
      console.log(`Adding ${p.symbol} fee:${p.fee} pool ${p.pool}...`);
      const tx = await reactor.addPool(p.pool);
      const receipt = await tx.wait();
      console.log(`  Added! TX: ${receipt.hash}`);
      await sleep(1000);
    } catch(e) {
      console.log(`  Failed: ${e.reason || e.message}`);
    }
  }

  // Verify
  await sleep(1000);
  const ct = await reactor.poolCount();
  console.log(`\nReactor now has ${ct} pools.`);
  for (let i = 0; i < Number(ct); i++) {
    await sleep(300);
    const pool = await reactor.pools(i);
    console.log(`  Pool ${i}: ${pool.v3Pool} (${pool.token0.slice(0,10)}... / ${pool.token1.slice(0,10)}... fee:${pool.fee})`);
  }
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
