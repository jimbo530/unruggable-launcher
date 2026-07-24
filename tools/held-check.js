// READ-ONLY. Which gap tokens does 0xE2a4 hold enough of for a free $5 token-side?
const { ethers } = require('ethers');
const RPCS=['https://mainnet.base.org','https://base-rpc.publicnode.com','https://base.drpc.org','https://base.meowrpc.com'];
const P=RPCS.map(u=>new ethers.JsonRpcProvider(u)); let rp=0;
async function call(fn,t=8){let e;for(let i=0;i<t;i++){const p=P[(rp++)%P.length];try{return await fn(p);}catch(x){e=x;await new Promise(r=>setTimeout(r,200));}}throw e;}
const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const FACT='0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const A='0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
const T=[['PIZZA','0x84BF55C117bc97323d332f08782ADBCAf3B15468'],['WALL','0x89B689462Cd57f14d5d1a714d102B3EE5F0dCEF2'],['MTEST','0x4600fcAe4b190591Fc0859765a94Dc46036e8491'],['NMB','0x64908eF36C85feEA39625d2F653f3bCDDAea5e9b'],['MR','0x9265BfDD02B61D864923371C63f68DDbF7e17656'],['BP','0x33c5e3362A9ddfD453FF655D7DdbC8C2Eff4A062'],['Myco','0xD377fcADE46CDA9C7B6Bc5ea6450CA53994b6577'],['RT','0x5d565fE46D285ab3e1e8d7fB6d0B2ecF4ba3B90B'],['Turtle','0x2999f1Bfa1Bd65Aa908bef41A8BF4d8CB7C370FB'],['bAGI','0x7311a6975a173Ee637D199F8123a409EC82b1992'],['Flwr','0x5bF510BFc635598D77b6Ac5fDE45CDa888A0C4c1'],['DD','0x3EeCC1c07d0a8BdEAF495a1300486a376cc959FF'],['NZ','0xCd79F05197F79E0f08D1f4599aA7BBf02EA36098'],['ILM','0x324980EE4219d350c0506beff151cd4327bF770B'],['Moon','0xc42e63F7b0cBd12E7C50941646D6eb539D2DE430'],['Bat','0xc720FFf033E70E11AE6b80A0Bb88C77911EEBc7D'],['SC','0x640AEB7263EDBAd0A840F2F8C751949Fc1d48B18'],['NFS','0xb9630280DC93c503aEE06d1Eca8E125fc19AB3c5']];
const erc20=['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)'];
async function price(token,dec){for(const f of [10000,3000,500,100]){try{const pool=await call(p=>new ethers.Contract(FACT,['function getPool(address,address,uint24) view returns (address)'],p).getPool(token,USDC,f));if(!pool||pool===ethers.ZeroAddress)continue;const s=await call(p=>new ethers.Contract(pool,['function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)'],p).slot0());const sp=Number(s.sqrtPriceX96)/2**96;const p01=sp*sp;const isTok0=token.toLowerCase()<USDC;const pr=isTok0?p01*10**(dec-6):(1/p01)*10**(dec-6);if(pr>0&&isFinite(pr))return pr;}catch{}}return 0;}
(async()=>{
  const rows=[];
  for(const [name,token] of T){
    let dec=18,bal=0,pr=0;
    try{dec=Number(await call(p=>new ethers.Contract(token,erc20,p).decimals()));}catch{}
    try{bal=Number(ethers.formatUnits(await call(p=>new ethers.Contract(token,erc20,p).balanceOf(A)),dec));}catch{}
    try{pr=await price(token,dec);}catch{}
    const val=bal*pr; const need5=pr>0?5/pr:Infinity;
    const free=bal>=need5 && pr>0;
    rows.push({name,token,bal,pr,val,free});
  }
  rows.sort((a,b)=>(b.free-a.free)||(b.val-a.val));
  console.log('token   held            price       $value     $5 token-side FREE?');
  for(const r of rows) console.log(`${r.name.padEnd(7)} ${r.bal.toLocaleString(undefined,{maximumFractionDigits:2}).padStart(14)}  $${(r.pr||0).toPrecision(3).padStart(9)}  $${r.val.toFixed(2).padStart(9)}  ${r.free?'FREE ✅':'no (buy)'}`);
  console.log('\nHeld-supply (free token side):', rows.filter(r=>r.free).map(r=>r.name).join(', ') || 'none');
})().catch(e=>console.error('ERR',e));
