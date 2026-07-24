// READ-ONLY. Fill remaining PL audit gaps on a sturdier RPC, paced to avoid rate limits.
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

const PL   = '0x430Cc28D70D35F3599FC648CD80E417C4aD84711';
const MEME = '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3';
const MONEY= '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const REACTOR='0x4232Dc1E891E6076C8171D7DCa959AE488A544B1';
const NPM  = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const PLMEME_POOL='0x0d62fC9db67fBaa9500c30754a0a963C922c4440';
const OPS  = '0xE1259391D74042659553656846A5bdCE34Beb6f9';
const PEG  = '0x2BC3dEFA030C63D0a5E3a7A68C47E34f41bdD0f4';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const D=600;
const ERC20=['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)'];
const lbl=a=>{const x=(a||'').toLowerCase();if(x===PL.toLowerCase())return'PL';if(x===MEME.toLowerCase())return'MEME';if(x===MONEY.toLowerCase())return'MONEY_V4';return a;};
const fmt=ethers.formatUnits;

(async()=>{
  const npm=new ethers.Contract(NPM,['function balanceOf(address) view returns (uint256)','function tokenOfOwnerByIndex(address,uint256) view returns (uint256)','function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24,int24,uint128 liquidity,uint256,uint256,uint128 owed0,uint128 owed1)'],provider);
  console.log('--- PrivateReactor 3 positions ---');
  const n=await npm.balanceOf(REACTOR); await sleep(D);
  for(let i=0;i<Number(n);i++){
    try{
      const id=await npm.tokenOfOwnerByIndex(REACTOR,i); await sleep(D);
      const p=await npm.positions(id); await sleep(D);
      console.log(`  #${id}: ${lbl(p.token0)}/${lbl(p.token1)} fee=${p.fee} liquidity=${p.liquidity} owed=(${p.owed0},${p.owed1})`);
    }catch(e){console.log(`  position ${i} failed: ${e.code||e.message}`);}
  }

  console.log('\n--- PL/MEME pool reserves (0x0d62) ---');
  try{
    const plB=await new ethers.Contract(PL,ERC20,provider).balanceOf(PLMEME_POOL); await sleep(D);
    const meB=await new ethers.Contract(MEME,ERC20,provider).balanceOf(PLMEME_POOL); await sleep(D);
    console.log(`  ${fmt(plB,6)} PL + ${fmt(meB,18)} MEME locked in PL/MEME LP`);
  }catch(e){console.log('  pool read failed:',e.message);}

  console.log('\n--- notable PL holders ---');
  for(const [name,a] of [['OPS wallet (0xE1259391)',OPS],['peg-onehop bot (0x2BC3)',PEG]]){
    try{const b=await new ethers.Contract(PL,ERC20,provider).balanceOf(a); await sleep(D); console.log(`  ${name}: ${fmt(b,6)} PL`);}catch(e){console.log(`  ${name}: read failed ${e.code||e.message}`);}
  }
})().catch(e=>console.error('ERR',e.message));
