// READ-ONLY. For each valued position, recompute its hard-asset amount AND compare to the
// pool's ACTUAL hard-asset balance — to flag thin-pool price artifacts ("tricks"). No signing.
const { ethers } = require('ethers');
const fs = require('fs');
const RPCS = ['https://mainnet.base.org','https://base-rpc.publicnode.com','https://base.drpc.org','https://base.meowrpc.com','https://1rpc.io/base'];
const providers = RPCS.map(u => new ethers.JsonRpcProvider(u));
let rp = 0;
async function call(fn, tries=8){ let e; for(let i=0;i<tries;i++){ const p=providers[(rp++)%providers.length]; try{return await fn(p);}catch(err){e=err;await new Promise(r=>setTimeout(r,200));}} throw e; }

const FACT='0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const NPM='0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH='0x4200000000000000000000000000000000000006';
const CBBTC='0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
const HARD={[USDC]:6,[WETH]:18,[CBBTC]:8};
const NAME={[USDC]:'USDC',[WETH]:'WETH',[CBBTC]:'cbBTC'};

const v=JSON.parse(fs.readFileSync('C:\\Users\\bigji\\value-inventory.json','utf8'));
const inv=JSON.parse(fs.readFileSync('C:\\Users\\bigji\\lp-inventory.json','utf8'));
const px={[USDC]:1,[WETH]:v.wethP,[CBBTC]:v.btcP};
const meta={}; for(const o of inv.owners) for(const p of (o.positions||[])) if(p.tokenId) meta[p.tokenId]={t0:p.token0,t1:p.token1,fee:p.fee,pair:p.pair};

const erc20=['function balanceOf(address) view returns (uint256)'];
function amounts(L,tl,tu,sqrtX96,tick){const sp=Number(sqrtX96)/2**96,spL=Math.pow(1.0001,tl/2),spU=Math.pow(1.0001,tu/2);L=Number(L);let a0=0,a1=0;if(tick<tl)a0=L*(1/spL-1/spU);else if(tick>=tu)a1=L*(spU-spL);else{a0=L*(1/sp-1/spU);a1=L*(sp-spL);}return[a0,a1];}

(async()=>{
  const jobs=[];
  for(const o of v.owners) for(const p of (o.positions||[])) if(p.hardUsd>0.5) jobs.push({owner:o.name,...p,...meta[p.tokenId]});
  const byAssetClaimed={USDC:0,WETH:0,cbBTC:0}, byAssetReal={USDC:0,WETH:0,cbBTC:0};
  const rows=[];
  for(const j of jobs){
    try{
      const pool=await call(p=>new ethers.Contract(FACT,['function getPool(address,address,uint24) view returns (address)'],p).getPool(j.t0,j.t1,j.fee));
      const s=await call(p=>new ethers.Contract(pool,['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)'],p).slot0());
      const np=await call(p=>new ethers.Contract(NPM,['function positions(uint256) view returns (uint96,address,address,address,uint24,int24 tl,int24 tu,uint128 liq,uint256,uint256,uint128,uint128)'],p).positions(j.tokenId));
      const [a0,a1]=amounts(np.liq,Number(np.tl),Number(np.tu),s.sqrtPriceX96,Number(s.tick));
      const t0=j.t0.toLowerCase(),t1=j.t1.toLowerCase();
      let asset=null,claimed=0;
      if(HARD[t0]!=null){asset=NAME[t0];claimed=(a0/10**HARD[t0])*px[t0];}
      else if(HARD[t1]!=null){asset=NAME[t1];claimed=(a1/10**HARD[t1])*px[t1];}
      if(!asset)continue;
      // pool's ACTUAL hard-asset balance
      const hardAddr=HARD[t0]!=null?t0:t1;
      const bal=await call(p=>new ethers.Contract(hardAddr,erc20,p).balanceOf(pool));
      const poolHardUsd=(Number(bal)/10**HARD[hardAddr])*px[hardAddr];
      const real=Math.min(claimed,poolHardUsd); // can't be worth more than the pool actually holds
      const flag = claimed>poolHardUsd*1.1 ? 'ARTIFACT(claims>pool)' : poolHardUsd<5 ? 'THIN(<$5 pool)' : 'ok';
      byAssetClaimed[asset]+=claimed; byAssetReal[asset]+=real;
      rows.push({owner:j.owner,pair:j.pair,asset,claimed:+claimed.toFixed(2),poolHas:+poolHardUsd.toFixed(2),real:+real.toFixed(2),flag});
    }catch(e){ rows.push({owner:j.owner,pair:j.pair,err:e.code||e.message}); }
  }
  rows.sort((a,b)=>(b.claimed||0)-(a.claimed||0));
  console.log('owner / pair / asset / CLAIMED / pool-actually-has / REAL(capped) / flag');
  for(const r of rows){ if(r.err){console.log(`${r.owner} ${r.pair} ERR ${r.err}`);continue;} console.log(`${r.owner.padEnd(16)} ${r.pair.padEnd(16)} ${r.asset.padEnd(6)} $${String(r.claimed).padStart(8)}  pool:$${String(r.poolHas).padStart(8)}  real:$${String(r.real).padStart(8)}  ${r.flag}`); }
  const tc=byAssetClaimed.USDC+byAssetClaimed.WETH+byAssetClaimed.cbBTC, tr=byAssetReal.USDC+byAssetReal.WETH+byAssetReal.cbBTC;
  console.log(`\nCLAIMED by asset: USDC $${byAssetClaimed.USDC.toFixed(2)} · WETH $${byAssetClaimed.WETH.toFixed(2)} · cbBTC $${byAssetClaimed.cbBTC.toFixed(2)}  = $${tc.toFixed(2)}`);
  console.log(`REAL (capped at pool's actual holdings): USDC $${byAssetReal.USDC.toFixed(2)} · WETH $${byAssetReal.WETH.toFixed(2)} · cbBTC $${byAssetReal.cbBTC.toFixed(2)}  = $${tr.toFixed(2)}`);
  fs.writeFileSync('C:\\Users\\bigji\\value-analysis.json',JSON.stringify({rows,byAssetClaimed,byAssetReal},null,2));
})().catch(e=>console.error('FATAL',e));
