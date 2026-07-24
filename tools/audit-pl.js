// READ-ONLY PL (Power Liquidity) on-chain audit. No wallet/signing.
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

const PL_V2   = '0x430Cc28D70D35F3599FC648CD80E417C4aD84711';
const PL_V1   = '0x1Caa9b04CA7f3103be97EAe1FAFA94Cdf6F19b77';
const REACTOR = '0x4232Dc1E891E6076C8171D7DCa959AE488A544B1'; // PrivateReactor
const MEME    = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3'; // MfT meme
const USDC    = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BURN    = '0xfd780B0aE569e15e514B819ecFDF46f804953a4B';
const NPM     = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const V3FACT  = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const AAVEPOOL= '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'; // Aave V3 Base Pool
const TRANSFER= ethers.id('Transfer(address,address,uint256)');

const ERC20 = ['function symbol() view returns (string)','function name() view returns (string)','function decimals() view returns (uint8)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)'];
const label = (a) => {
  const x=(a||'').toLowerCase();
  if(x===PL_V2.toLowerCase())return'PL_V2';
  if(x===REACTOR.toLowerCase())return'PrivateReactor';
  if(x===MEME.toLowerCase())return'MEME';
  if(x===BURN.toLowerCase())return'BURN';
  if(x===ethers.ZeroAddress.toLowerCase())return'0x0';
  return a;
};
async function retry(fn,n=5){for(let i=0;i<n;i++){try{return await fn()}catch(e){if(i===n-1)throw e;await new Promise(r=>setTimeout(r,400))}}}
async function creationBlock(addr){let lo=1,hi=await provider.getBlockNumber();while(lo<hi){const mid=(lo+hi)>>1;const c=await provider.getCode(addr,mid);if(c&&c!=='0x')hi=mid;else lo=mid+1}return lo}
const fmt=(v,d)=>ethers.formatUnits(v,d);

(async()=>{
  const plv2=new ethers.Contract(PL_V2,ERC20,provider);
  const meme=new ethers.Contract(MEME,ERC20,provider);

  console.log('===== PL_V2 token',PL_V2,'=====');
  const [sym,dec,sup]=await Promise.all([retry(()=>plv2.symbol()),retry(()=>plv2.decimals()),retry(()=>plv2.totalSupply())]);
  console.log(`symbol=${sym} decimals=${dec} totalSupply=${fmt(sup,dec)}`);

  // Aave underlying held by PL contract = live principal + accrued yield
  try{
    const pool=new ethers.Contract(AAVEPOOL,['function getReserveData(address) view returns (tuple(uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))'],provider);
    const rd=await retry(()=>pool.getReserveData(USDC));
    const aToken=rd.aTokenAddress;
    const aBal=await retry(()=>new ethers.Contract(aToken,ERC20,provider).balanceOf(PL_V2));
    console.log(`aUSDC ${aToken}: PL holds ${fmt(aBal,6)} USDC underlying (principal + accrued, live)`);
  }catch(e){console.log('Aave read failed:',e.message);}

  // PL holders via transfer scan
  console.log('\n--- PL_V2 holders (Transfer scan) ---');
  const start=await creationBlock(PL_V2), latest=await provider.getBlockNumber();
  const seen=new Set(); const CH=9000;
  for(let f=start;f<=latest;f+=CH+1){const t=Math.min(f+CH,latest);let logs;try{logs=await retry(()=>provider.getLogs({address:PL_V2,topics:[TRANSFER],fromBlock:f,toBlock:t}))}catch{continue}for(const lg of logs){seen.add(ethers.getAddress('0x'+lg.topics[1].slice(26)));seen.add(ethers.getAddress('0x'+lg.topics[2].slice(26)))}}
  seen.delete(ethers.ZeroAddress);
  async function classify(a){
    const code=await provider.getCode(a).catch(()=>'0x');
    if(!code||code==='0x')return 'EOA';
    // try V3 pool
    try{const pc=new ethers.Contract(a,['function token0() view returns (address)','function token1() view returns (address)','function fee() view returns (uint24)'],provider);const t0=await pc.token0();const t1=await pc.token1();const fee=await pc.fee();return `V3 pool ${label(t0)}/${label(t1)} fee=${fee}`;}catch{}
    // try reactor
    try{const rc=new ethers.Contract(a,['function token() view returns (address)'],provider);const t=await rc.token();return `reactor? token()=${label(t)}`;}catch{}
    return 'contract (other)';
  }
  for(const a of seen){
    try{
      const b=await retry(()=>plv2.balanceOf(a));
      if(b>0n){const kind=await classify(a);console.log(`${fmt(b,dec).padStart(16)} PL  ${a} [${label(a)} | ${kind}]`);}
    }catch(e){console.log(`            ???  ${a} [balanceOf failed: ${e.code||e.message}]`);}
  }
  // explicit reactor balances
  try{const rPL=await retry(()=>plv2.balanceOf(REACTOR));const rME=await retry(()=>meme.balanceOf(REACTOR));console.log(`\nPrivateReactor ${REACTOR}: holds ${fmt(rPL,dec)} PL + ${fmt(rME,18)} MEME (idle, between executes)`);}catch(e){console.log('reactor balance read failed:',e.message);}

  // Reactor position NFTs (owned by reactor) + amounts
  console.log('\n--- PrivateReactor V3 positions ---');
  const npm=new ethers.Contract(NPM,['function balanceOf(address) view returns (uint256)','function tokenOfOwnerByIndex(address,uint256) view returns (uint256)','function ownerOf(uint256) view returns (address)','function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256,uint256,uint128,uint128)'],provider);
  try{
    const n=await retry(()=>npm.balanceOf(REACTOR));
    console.log('reactor owns',n.toString(),'position NFTs');
    for(let i=0;i<Number(n);i++){const id=await retry(()=>npm.tokenOfOwnerByIndex(REACTOR,i));const p=await retry(()=>npm.positions(id));const t0=label(p.token0),t1=label(p.token1);console.log(`  #${id}: ${t0}/${t1} fee=${p.fee} liquidity=${p.liquidity}`)}
  }catch(e){console.log('position enum failed:',e.message);}

  // PL/MEME V3 pool reserves
  console.log('\n--- PL/MEME V3 pool reserves ---');
  const fact=new ethers.Contract(V3FACT,['function getPool(address,address,uint24) view returns (address)'],provider);
  for(const fee of [500,3000,10000]){try{const pa=await retry(()=>fact.getPool(PL_V2,MEME,fee));if(pa&&pa!==ethers.ZeroAddress){const plB=await retry(()=>plv2.balanceOf(pa));const mB=await retry(()=>meme.balanceOf(pa));console.log(`pool ${pa} fee=${fee}: ${fmt(plB,dec)} PL + ${fmt(mB,18)} MEME`)}}catch{}}

  // Meme burned by reactor (lifetime)
  console.log('\n--- MEME burned by reactor (Transfer reactor -> BURN) ---');
  const rStart=await creationBlock(REACTOR);
  let burned=0n,toBurnCount=0;
  const fromTopic='0x'+'0'.repeat(24)+REACTOR.slice(2).toLowerCase();
  const burnTopic='0x'+'0'.repeat(24)+BURN.slice(2).toLowerCase();
  for(let f=rStart;f<=latest;f+=CH+1){const t=Math.min(f+CH,latest);let logs;try{logs=await retry(()=>provider.getLogs({address:MEME,topics:[TRANSFER,fromTopic,burnTopic],fromBlock:f,toBlock:t}))}catch{continue}for(const lg of logs){burned+=BigInt(lg.data);toBurnCount++}}
  console.log(`MEME burned via PL reactor: ${fmt(burned,18)} (${toBurnCount} burn txs)`);

  // PL_V1 legacy
  console.log('\n--- PL_V1 (legacy) ---');
  try{const v1=new ethers.Contract(PL_V1,ERC20,provider);const [s1,d1,sp1]=await Promise.all([retry(()=>v1.symbol()),retry(()=>v1.decimals()),retry(()=>v1.totalSupply())]);console.log(`${s1} supply=${fmt(sp1,d1)} (decimals ${d1})`)}catch(e){console.log('V1 read failed:',e.message)}
})().catch(e=>console.error('ERR',e.message));
