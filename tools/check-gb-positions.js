// READ-ONLY. Confirm GB launch positions + the reactor, with retries against RPC flakiness.
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

const GB       = '0x75f3eaad5cCC8701A6EBC9F148B93866114df9d2';
const MONEY_V4 = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const MFT_MEME = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const NPM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const IDS      = ['5241952', '5241953', '5241954', '5241955'];

const label = (a) => {
  const x = (a || '').toLowerCase();
  if (x === GB.toLowerCase())       return 'GB ✅';
  if (x === MONEY_V4.toLowerCase()) return 'MONEY V4';
  if (x === MFT_MEME.toLowerCase()) return 'MfT-meme';
  return a;
};
async function retry(fn, n = 5) {
  for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { if (i === n - 1) throw e; await new Promise(r => setTimeout(r, 400)); } }
}

(async () => {
  const npm = new ethers.Contract(NPM, [
    'function ownerOf(uint256) view returns (address)',
    'function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24,int24,uint128 liquidity,uint256,uint256,uint128,uint128)'
  ], provider);

  const owners = new Set();
  for (const id of IDS) {
    let p, owner;
    try { p = await retry(() => npm.positions(id)); }
    catch { console.log(`#${id}: position does not exist / not readable`); continue; }
    try { owner = await retry(() => npm.ownerOf(id)); } catch { owner = '(no owner)'; }
    let coreTok = '(owner not a reactor)';
    try {
      const r = new ethers.Contract(owner, ['function token() view returns (address)'], provider);
      coreTok = label(await retry(() => r.token()));
    } catch {}
    if (owner.startsWith('0x')) owners.add(owner);
    console.log(`#${id}: ${label(p.token0)} / ${label(p.token1)} fee=${p.fee} liq=${p.liquidity}`);
    console.log(`     owner=${owner}  owner.token()=${coreTok}`);
  }

  for (const owner of owners) {
    const reactor = new ethers.Contract(owner, [
      'function token() view returns (address)',
      'function mft() view returns (address)',
      'function launcher() view returns (address)',
      'function admin() view returns (address)',
      'function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)'
    ], provider);
    console.log('\n================ REACTOR', owner, '================');
    try { console.log('token()   =>', label(await retry(() => reactor.token()))); } catch {}
    try { console.log('mft()     =>', label(await retry(() => reactor.mft()))); } catch {}
    try { console.log('launcher()=>', await retry(() => reactor.launcher())); } catch { console.log('launcher()=> (n/a)'); }
    try { console.log('admin()   =>', await retry(() => reactor.admin())); } catch {}
    console.log('--- registered pools ---');
    for (let i = 0; i < 20; i++) {
      let p; try { p = await retry(() => reactor.pools(i)); } catch { break; }
      console.log(`pool[${i}] xToken=${label(p.xToken)} fee=${p.fee} disabled=${p.disabled} tokenId=${p.tokenId}`);
    }
  }
})().catch(e => console.error('ERR', e.message));
