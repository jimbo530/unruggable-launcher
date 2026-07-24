// READ-ONLY. Values every LP position by its HARD-ASSET side (USDC/WETH/cbBTC).
// Reads lp-inventory.json, writes value-inventory.json. No wallet/signing.
const { ethers } = require('ethers');
const fs = require('fs');

const RPCS = ['https://mainnet.base.org','https://base-rpc.publicnode.com','https://base.drpc.org','https://base.meowrpc.com','https://1rpc.io/base'];
const providers = RPCS.map(u => new ethers.JsonRpcProvider(u));
let rp = 0;
async function call(fn, tries = 8) { let e; for (let i=0;i<tries;i++){ const p=providers[(rp++)%providers.length]; try { return await fn(p); } catch(err){ e=err; await new Promise(r=>setTimeout(r,200)); } } throw e; }

const FACT = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const WETH = '0x4200000000000000000000000000000000000006'.toLowerCase();
const CBBTC= '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase();
const HARD = { [USDC]:6, [WETH]:18, [CBBTC]:8 };

const decCache = {};
async function dec(a){ const k=a.toLowerCase(); if(decCache[k]!=null)return decCache[k]; try{ decCache[k]=Number(await call(p=>new ethers.Contract(a,['function decimals() view returns (uint8)'],p).decimals())); }catch{ decCache[k]=18; } return decCache[k]; }
const poolCache={}, slotCache={};
async function getPool(t0,t1,fee){ const k=[t0.toLowerCase(),t1.toLowerCase(),fee].join('|'); if(poolCache[k])return poolCache[k]; const pa=await call(p=>new ethers.Contract(FACT,['function getPool(address,address,uint24) view returns (address)'],p).getPool(t0,t1,fee)); poolCache[k]=pa; return pa; }
async function slot0(pool){ if(slotCache[pool])return slotCache[pool]; const s=await call(p=>new ethers.Contract(pool,['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)'],p).slot0()); slotCache[pool]={sqrtPriceX96:s.sqrtPriceX96,tick:Number(s.tick)}; return slotCache[pool]; }

// price of a token in USDC via its deepest USDC pool
const priceCache={};
async function priceUsdc(token){ const k=token.toLowerCase(); if(k===USDC)return 1; if(priceCache[k]!=null)return priceCache[k];
  for(const fee of [500,3000,10000,100]){ try{ const pool=await getPool(token,USDC,fee); if(!pool||pool===ethers.ZeroAddress)continue; const s=await slot0(pool); const sp=Number(s.sqrtPriceX96)/2**96; const dt=await dec(token); const p01=sp*sp; // token1/token0 raw
      // order: token0<token1
      const t0 = token.toLowerCase()<USDC ? token.toLowerCase():USDC;
      let price; if(t0===token.toLowerCase()){ // token is token0, USDC token1: price = USDC(raw)/token(raw) * 10^(dt-6)
        price = p01 * 10**(dt-6);
      } else { // USDC token0, token token1: token/USDC raw = p01 → USDC per token = 1/p01 *10^(6-dt)... invert
        price = (1/p01) * 10**(dt-6);
      }
      if(price>0&&isFinite(price)){ priceCache[k]=price; return price; } }catch{} }
  priceCache[k]=0; return 0; }

function amounts(L,tickLower,tickUpper,sqrtPriceX96,tick){ const sp=Number(sqrtPriceX96)/2**96; const spL=Math.pow(1.0001,tickLower/2), spU=Math.pow(1.0001,tickUpper/2); L=Number(L); let a0=0,a1=0;
  if(tick<tickLower){ a0=L*(1/spL-1/spU); } else if(tick>=tickUpper){ a1=L*(spU-spL); } else { a0=L*(1/sp-1/spU); a1=L*(sp-spL); } return [a0,a1]; }

(async()=>{
  const inv = JSON.parse(fs.readFileSync('C:\\Users\\bigji\\lp-inventory.json','utf8'));
  let wethP=0,btcP=0; try{wethP=await priceUsdc(WETH);}catch{} try{btcP=await priceUsdc(CBBTC);}catch{}
  console.log(`prices: WETH $${wethP.toFixed(2)} · cbBTC $${btcP.toFixed(0)}`);
  const px={[USDC]:1,[WETH]:wethP,[CBBTC]:btcP};

  const out={pricedAt:inv.generatedAtBlock,wethP,btcP,owners:[]};
  let grand=0;
  for(const o of inv.owners){
    const orec={name:o.name,address:o.address,hardUsd:0,positions:[]};
    for(const p of (o.positions||[])){
      if(p.error||!p.alive){ continue; }
      let usd=0, note='';
      try{
        const pool=await getPool(p.token0,p.token1,p.fee);
        if(pool&&pool!==ethers.ZeroAddress){ const s=await slot0(pool);
          // get tick range + liquidity from NPM positions
          const npmPos=await call(pp=>new ethers.Contract('0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',['function positions(uint256) view returns (uint96,address,address,address,uint24,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256,uint256,uint128,uint128)'],pp).positions(p.tokenId));
          const [a0,a1]=amounts(npmPos.liquidity,Number(npmPos.tickLower),Number(npmPos.tickUpper),s.sqrtPriceX96,s.tick);
          const d0=await dec(p.token0), d1=await dec(p.token1);
          const t0=p.token0.toLowerCase(), t1=p.token1.toLowerCase();
          if(px[t0]!=null) usd += (a0/10**d0)*px[t0];
          if(px[t1]!=null) usd += (a1/10**d1)*px[t1];
        }
      }catch(e){ note='valuation failed'; }
      orec.positions.push({tokenId:p.tokenId,pair:p.pair,hardUsd:+usd.toFixed(2),note});
      orec.hardUsd+=usd;
    }
    orec.hardUsd=+orec.hardUsd.toFixed(2); grand+=orec.hardUsd;
    out.owners.push(orec);
    console.log(`${o.name.padEnd(20)} $${orec.hardUsd.toFixed(2)}`);
    fs.writeFileSync('C:\\Users\\bigji\\value-inventory.json',JSON.stringify(out,null,2));
  }
  out.grandHardUsd=+grand.toFixed(2);
  fs.writeFileSync('C:\\Users\\bigji\\value-inventory.json',JSON.stringify(out,null,2));
  console.log(`\nGRAND HARD-ASSET VALUE: $${grand.toFixed(2)}`);
})().catch(e=>console.error('FATAL',e));
