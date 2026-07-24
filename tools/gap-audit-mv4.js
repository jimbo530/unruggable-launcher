// READ-ONLY. For each launched token, check if it has a live Money-V4 LP. No signing.
const { ethers } = require('ethers');
const fs = require('fs');
const RPCS=['https://mainnet.base.org','https://base-rpc.publicnode.com','https://base.drpc.org','https://base.meowrpc.com','https://1rpc.io/base'];
const P=RPCS.map(u=>new ethers.JsonRpcProvider(u)); let rp=0;
async function call(fn,t=8){let e;for(let i=0;i<t;i++){const p=P[(rp++)%P.length];try{return await fn(p);}catch(x){e=x;await new Promise(r=>setTimeout(r,200));}}throw e;}

const MV4='0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const FACT='0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

// launch reactors → their core token() is the launched token
const REACTORS=[
 ['GB','0x186185E7b161409162639Da59dE6d7D565bec82a'],['PIZZA','0xe93Aa8104Ad035AC88b984320D80b5c335B2B96C'],
 ['BURGERSv4','0x2867F1107d3A4767018740e10f0067702a8eC682'],['NFSv4','0x286416cE59B355dEFf1a02d52013d4CBDC11F3bF'],
 ['WALL','0xBEe606A4Dd8c7027613FA300C517782A14A56490'],
 ['MTEST','0xAb2d882d0CBc9065425210F49073EA5dAEDa58eB'],['NMB','0x745BAbD96010A1459edAdc0760c936501fCC95dB'],
 ['MR','0x195505D0F711628F4BD32b8C9B6c9D18050F6acc'],['NFSv1','0x71C28E76E3CD6D457e7639314B114760246cdeAD'],
 ['BP','0xfDb309F2a7055e2dd8221f9eb27655F11d2d43be'],['Myco','0x87bbF797152Ca3136a92DAc1333Fc7b1f8966e2A'],
 ['RT','0x513d2EB33F1A7eC3798cC221Ab4b4Ce2A3FAfb98'],['Turtle','0xf1f8c64102Ee62361eACb694F09d24f42Aaa23da'],
 ['bAGI','0x20a14d6A1aB57851a58d4A85C0FC06f23A7AeA42'],['Flwr','0x752831229E92957902B328b63df545aB50d98Af5'],
 ['DD','0x1a6Eb1F6Bd44A35ca83d8E5E130D1eb95692b5E0'],['BRUHr','0x14972F189310c0B510C20f239E283D1cBd8Bfc7A'],
 ['NZ','0x93AB8aB8Df2fa299bF1874A638239d5ef6C95330'],['ILMr','0x13Fba3fe255b8e3e462816c45725211d06Be82fB'],
 ['Moon','0x3534706f4B1642841c008f7368A0A16411c5Abf2'],['Bat','0xdb4ED222C19082C8ea9c9A044ce81e2d22DF61AB'],
 ['BRUHbrick','0xE9679341527B0e062F08c9efEa8764D46030Bfaf'],['ILMbrick','0x885f90b0fcc10AD6d3257Df851eda4c78f38c5A4'],
 ['RTbrick','0x3FE916c7CB6354eAF8ee49427380740bEe2b061a'],['SCbrick','0xB7C5b050E0545b5b2b3015111E4f197641F0D3Fa'],
];

(async()=>{
  const out=[];
  for(const [name,reactor] of REACTORS){
    let token=null,sym='?';
    try{ token=await call(p=>new ethers.Contract(reactor,['function token() view returns (address)'],p).token()); }catch(e){ out.push({name,reactor,err:'no token() '+(e.code||e.message)}); continue; }
    try{ sym=await call(p=>new ethers.Contract(token,['function symbol() view returns (string)'],p).symbol()); }catch{}
    // check Money-V4 LP at common fees
    let mv4pool=null,liq='0';
    for(const fee of [10000,3000,500,100]){
      try{ const pool=await call(p=>new ethers.Contract(FACT,['function getPool(address,address,uint24) view returns (address)'],p).getPool(token,MV4,fee));
        if(pool&&pool!==ethers.ZeroAddress){ const L=await call(p=>new ethers.Contract(pool,['function liquidity() view returns (uint128)'],p).liquidity()); if(L>0n){ mv4pool=pool; liq=L.toString(); break; } if(!mv4pool)mv4pool=pool; }
      }catch{}
    }
    const has = liq!=='0';
    out.push({name,token,sym,hasMV4LP:has,mv4pool,liq});
    console.log(`${name.padEnd(11)} ${sym.padEnd(10)} ${token}  MV4-LP: ${has?'YES ✅':'NO  ❌'}${mv4pool&&!has?' (pool exists, 0 liq)':''}`);
  }
  fs.writeFileSync('C:\\Users\\bigji\\mv4-gap.json',JSON.stringify(out,null,2));
  const miss=out.filter(o=>!o.err&&!o.hasMV4LP);
  console.log(`\nMISSING a live Money-V4 LP: ${miss.length}/${out.length} → ${miss.map(m=>m.sym).join(', ')}`);
})().catch(e=>console.error('FATAL',e));
