// READ-ONLY. Confirms deployer USDC, and for PIZZA+WALL: price, deployer token balance,
// whether an MV4 pool already exists. Tells us exactly what each $5 seed needs. No signing.
const { ethers } = require('ethers');
const RPCS=['https://mainnet.base.org','https://base-rpc.publicnode.com','https://base.drpc.org','https://base.meowrpc.com'];
const P=RPCS.map(u=>new ethers.JsonRpcProvider(u)); let rp=0;
async function call(fn,t=8){let e;for(let i=0;i<t;i++){const p=P[(rp++)%P.length];try{return await fn(p);}catch(x){e=x;await new Promise(r=>setTimeout(r,200));}}throw e;}

const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const MV4='0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const FACT='0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const DEPLOYER='0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
const TOKENS=[['PIZZA','0x84BF55C117bc97323d332f08782ADBCAf3B15468'],['WALL','0x89B689462Cd57f14d5d1a714d102B3EE5F0dCEF2']];

const erc20=['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)','function symbol() view returns (string)'];
async function getPool(a,b,f){return call(p=>new ethers.Contract(FACT,['function getPool(address,address,uint24) view returns (address)'],p).getPool(a,b,f));}
async function priceUsd(token,dec){ for(const f of [10000,3000,500,100]){ try{ const pool=await getPool(token,USDC,f); if(!pool||pool===ethers.ZeroAddress)continue; const s=await call(p=>new ethers.Contract(pool,['function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)'],p).slot0()); const sp=Number(s.sqrtPriceX96)/2**96; const p01=sp*sp; const isTok0=token.toLowerCase()<USDC; const price=isTok0? p01*10**(dec-6) : (1/p01)*10**(dec-6); if(price>0&&isFinite(price))return {price,pool,fee:f}; }catch{} } return {price:0}; }

(async()=>{
  const usdc=Number(ethers.formatUnits(await call(p=>new ethers.Contract(USDC,erc20,p).balanceOf(DEPLOYER)),6));
  console.log('Deployer USDC now:', usdc.toFixed(2), '(was 1.58; +~10 expected)');
  console.log('');
  for(const [name,token] of TOKENS){
    const dec=Number(await call(p=>new ethers.Contract(token,erc20,p).decimals()).catch(()=>18));
    const bal=Number(ethers.formatUnits(await call(p=>new ethers.Contract(token,erc20,p).balanceOf(DEPLOYER)),dec));
    const {price,fee}=await priceUsd(token,dec);
    const tokenNeededFor5=price>0? (5/price):0;
    let mv4pool=await getPool(token,MV4,10000).catch(()=>null);
    const mv4exists = mv4pool && mv4pool!==ethers.ZeroAddress;
    console.log(`${name} (${token})`);
    console.log(`  decimals:${dec}  price:$${price? price.toPrecision(4):'?'}  (via USDC pool fee ${fee||'-'})`);
    console.log(`  deployer holds: ${bal.toLocaleString()} ${name}  = $${(bal*price).toFixed(2)}`);
    console.log(`  for a balanced $5/$5 LP need ~${tokenNeededFor5.toLocaleString(undefined,{maximumFractionDigits:0})} ${name} ($5) + 5 MV4`);
    console.log(`  enough token on hand? ${bal>=tokenNeededFor5?'YES ✅ (token side free)':'NO ❌ (would need to buy token side)'}`);
    console.log(`  MV4 pool exists already? ${mv4exists?'yes '+mv4pool:'NO — create new'}`);
    console.log('');
  }
})().catch(e=>console.error('ERR',e));
