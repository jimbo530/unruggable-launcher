// READ-ONLY. No wallet, no signing. Just eth_call to verify GB reactor safety.
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

const GB       = '0x75f3eaad5cCC8701A6EBC9F148B93866114df9d2';
const MONEY_V4 = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const MFT_MEME = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const POOL     = '0x2bc2f756789ad9fc8d0090c174d8f71758257d6d';

const FACTORIES = [
  ['V7',   '0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2'],
  ['V5.4', '0xb1fE1deeA42F85F124E7cB166B2f52a1D7f1d054'],
  ['V5.3', '0x65F8227f37932e1aF1771398DFA76B4079fbDb21'],
  ['OLD',  '0x9a9E797e366556dDF940219bF6613E4fcBD7018F'],
  ['PRGT', '0x955383723E8A1AD82800406D6f492260918DF882'],
  ['LB',   '0x51eF41E0730c0e607950421e1EE113b089867d3e'],
];

const label = (a) => {
  const x = (a || '').toLowerCase();
  if (x === GB.toLowerCase())       return 'GB ✅ (launched token)';
  if (x === MONEY_V4.toLowerCase()) return 'MONEY V4 ⚠️';
  if (x === MFT_MEME.toLowerCase()) return 'MfT-meme';
  return a;
};

async function dumpReactor(reactorAddr) {
  const reactor = new ethers.Contract(reactorAddr, [
    'function token() view returns (address)',
    'function mft() view returns (address)',
    'function launcher() view returns (address)',
    'function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)'
  ], provider);
  const core = await reactor.token();
  let mft = '(n/a)', launcher = '(n/a)';
  try { mft = await reactor.mft(); } catch {}
  try { launcher = await reactor.launcher(); } catch {}
  console.log('\nREACTOR =>', reactorAddr);
  console.log('CORE token() =>', core, '=>', label(core));
  console.log('mft()        =>', mft, '=>', label(mft));
  console.log('launcher()   =>', launcher);
  console.log('--- pools (only CORE token ever leaves; xTokens stay in LP forever) ---');
  for (let i = 0; i < 20; i++) {
    try {
      const p = await reactor.pools(i);
      console.log(`pool[${i}] xToken=${p.xToken} (${label(p.xToken)}) fee=${p.fee} disabled=${p.disabled} tokenId=${p.tokenId}`);
    } catch { break; }
  }
  const safe = core.toLowerCase() === GB.toLowerCase();
  console.log('\n' + (safe
    ? 'RESULT: SAFE ✅ core token = GB. Money V4 (and every pair) can NEVER be sent out.'
    : 'RESULT: ⚠️ core token is NOT GB — investigate.'));
}

(async () => {
  // Confirm the pool's tokens
  const pool = new ethers.Contract(POOL, [
    'function token0() view returns (address)',
    'function token1() view returns (address)'
  ], provider);
  try {
    const [t0, t1] = await Promise.all([pool.token0(), pool.token1()]);
    console.log('POOL', POOL);
    console.log('  token0 =>', t0, '=>', label(t0));
    console.log('  token1 =>', t1, '=>', label(t1));
  } catch (e) { console.log('pool read failed:', e.message); }

  // Try reactorOf across factories
  const abi = ['function reactorOf(address) view returns (address)'];
  let found = null;
  for (const [name, addr] of FACTORIES) {
    try {
      const f = new ethers.Contract(addr, abi, provider);
      const r = await f.reactorOf(GB);
      console.log(`factory ${name} ${addr} reactorOf(GB) =>`, r);
      if (r && r !== ethers.ZeroAddress) { found = r; break; }
    } catch (e) { console.log(`factory ${name} ${addr} -> no reactorOf (${e.code || e.message})`); }
  }

  if (found) await dumpReactor(found);
  else console.log('\nNo factory mapping hit. Next: find owner of the GB/Money position NFT (need tokenId) or scan logs.');
})().catch(e => console.error('ERR', e.message));
