// READ-ONLY. Finds GB reactor = owner of the GB/Money position NFT.
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

const GB       = '0x75f3eaad5cCC8701A6EBC9F148B93866114df9d2';
const MONEY_V4 = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const MFT_MEME = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const POOL     = '0x2bc2f756789ad9fc8d0090c174d8f71758257d6d';
const NPM      = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const TRANSFER = ethers.id('Transfer(address,address,uint256)');
const MINT     = ethers.id('Mint(address,address,int24,int24,uint128,uint256,uint256)');

const label = (a) => {
  const x = (a || '').toLowerCase();
  if (x === GB.toLowerCase())       return 'GB ✅ (launched token)';
  if (x === MONEY_V4.toLowerCase()) return 'MONEY V4 ⚠️';
  if (x === MFT_MEME.toLowerCase()) return 'MfT-meme';
  return a;
};

async function creationBlock(addr) {
  let lo = 1, hi = await provider.getBlockNumber();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await provider.getCode(addr, mid);
    if (code && code !== '0x') hi = mid; else lo = mid + 1;
  }
  return lo;
}

(async () => {
  const poolBlk = await creationBlock(POOL);
  const latest = await provider.getBlockNumber();
  console.log(`Pool created ~block ${poolBlk}`);

  // 1) find a Mint on this pool -> grab its tx
  let mintTx = null;
  const CHUNK = 9000;
  for (let from = poolBlk; from <= latest && !mintTx; from += CHUNK + 1) {
    const to = Math.min(from + CHUNK, latest);
    let logs;
    try { logs = await provider.getLogs({ address: POOL, topics: [MINT], fromBlock: from, toBlock: to }); }
    catch (e) { console.log(`mint scan ${from}-${to}: ${e.message}`); continue; }
    if (logs.length) { mintTx = logs[0].transactionHash; }
  }
  if (!mintTx) { console.log('No Mint found on pool.'); return; }
  console.log('First LP Mint tx:', mintTx);

  // 2) in that tx, find the NPM ERC721 mint (from=0x0) -> tokenId
  const receipt = await provider.getTransactionReceipt(mintTx);
  const tokenIds = [];
  for (const lg of receipt.logs) {
    if (lg.address.toLowerCase() === NPM.toLowerCase()
        && lg.topics[0] === TRANSFER
        && lg.topics.length === 4
        && BigInt(lg.topics[1]) === 0n) {            // from == address(0) => mint
      tokenIds.push(BigInt(lg.topics[3]).toString());
    }
  }
  console.log('NPM position mints in tx:', tokenIds);
  if (!tokenIds.length) { console.log('No NPM position mint in that tx.'); return; }
  const tokenId = tokenIds[0];
  console.log('Position NFT tokenId:', tokenId);

  // 3) confirm the position pair + read current owner = reactor
  const npm = new ethers.Contract(NPM, [
    'function ownerOf(uint256) view returns (address)',
    'function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24,int24,uint128,uint256,uint256,uint128,uint128)'
  ], provider);
  const pos = await npm.positions(tokenId);
  console.log('position token0:', pos.token0, '=>', label(pos.token0));
  console.log('position token1:', pos.token1, '=>', label(pos.token1));
  const owner = await npm.ownerOf(tokenId);
  console.log('POSITION OWNER (=reactor):', owner);

  // 4) read the reactor
  const reactor = new ethers.Contract(owner, [
    'function token() view returns (address)',
    'function mft() view returns (address)',
    'function launcher() view returns (address)',
    'function pools(uint256) view returns (uint256 tokenId, address xToken, address poolAddress, uint24 fee, bool tokenIsToken0, bool disabled)'
  ], provider);
  let core, mft = '(n/a)', launcher = '(n/a)';
  try { core = await reactor.token(); } catch (e) { console.log('owner is not a reactor (token() failed):', e.message); return; }
  try { mft = await reactor.mft(); } catch {}
  try { launcher = await reactor.launcher(); } catch {}
  console.log('\n================ REACTOR', owner, '================');
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
    : 'RESULT: ⚠️ core token is NOT GB.'));
})().catch(e => console.error('ERR', e.message));
