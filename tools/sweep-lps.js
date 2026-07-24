// READ-ONLY LP sweep. Enumerates Uniswap V3 position NFTs held by every reactor/wallet,
// marks alive/dead, resolves token symbols, writes lp-inventory.json. No wallet/signing.
const { ethers } = require('ethers');
const fs = require('fs');

const RPCS = [
  'https://mainnet.base.org',
  'https://base-rpc.publicnode.com',
  'https://base.drpc.org',
  'https://base.meowrpc.com',
  'https://1rpc.io/base',
];
const providers = RPCS.map(u => new ethers.JsonRpcProvider(u));
let rp = 0;
async function call(fn, tries = 10) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const p = providers[(rp++) % providers.length];
    try { return await fn(p); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 250)); }
  }
  throw lastErr;
}

const NPM = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const npmAbi = [
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24,int24,uint128 liquidity,uint256,uint256,uint128,uint128)'
];

const symCache = {};
async function sym(addr) {
  const k = addr.toLowerCase();
  if (symCache[k]) return symCache[k];
  try { const s = await call(p => new ethers.Contract(addr, ['function symbol() view returns (string)'], p).symbol()); symCache[k] = s; return s; }
  catch { symCache[k] = addr.slice(0, 8); return symCache[k]; }
}

// owners to sweep: reactors + wallets + keeper contracts
const OWNERS = [
  ['ReactorPrimeV3','0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA'],
  ['MfT V1 Prime','0xed3aE91b2bb22307c07438EEebA2500C18EABcFE'],
  ['MycoPad Hub','0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045'],
  ['EGP Chain','0x10A710fced92eB096F796F43BCCFb60884c13819'],
  ['CHAR Chain','0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A'],
  ['EB Relay','0xC28e64551816535d9ef06CE95844F2b5317353bA'],
  ['ecowealth','0xc7E739f223934C5F69EBA36BcDf808c4379b1985'],
  ['Reactor Prime V2','0xB4dD1350738Ce8c01Cc229F14d7135a60a51634a'],
  ['PIZZA','0xe93Aa8104Ad035AC88b984320D80b5c335B2B96C'],
  ['BURGERS V4','0x2867F1107d3A4767018740e10f0067702a8eC682'],
  ['NFS V4','0x286416cE59B355dEFf1a02d52013d4CBDC11F3bF'],
  ['BURGERS V2','0xc858026Ec5D30280137032BC6EA86F46ea23C2CA'],
  ['AZUSD R1','0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281'],
  ['AZUSD R2','0x6888ef2f92e3073a378f7153548e9c7691c90d23'],
  ['TGN','0xc3f09dAEF814177E52B4C04ec2872B564a36989D'],
  ['BTCband v1','0x2879706E115150BBB9ffb5C432024264dEE0852F'],
  ['ETHband v1','0x7018660EFBd7CfE3219388322417D405fC15b23B'],
  ['BTCband v2','0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf'],
  ['ETHband v2','0xeB02d1137342cD08C1c4bf61C188d86C5253b631'],
  ['BB v5','0x3b31B8c9338ebFE2e737e5dd6361cEf0Bdc431e3'],
  ['EB v5','0x2e06EB264dB2C7bcD8B9a216827b7D0eF3beACA2'],
  ['BB v3','0x5375817c1798d43036d3b2DAAfaFB8e2247bAcF2'],
  ['EB v3','0x361A4E356847c5a0C60B510b2531b640aC51f090'],
  ['BRUH(brick)','0xE9679341527B0e062F08c9efEa8764D46030Bfaf'],
  ['ILM(brick)','0x885f90b0fcc10AD6d3257Df851eda4c78f38c5A4'],
  ['RT(brick)','0x3FE916c7CB6354eAF8ee49427380740bEe2b061a'],
  ['SC(brick)','0xB7C5b050E0545b5b2b3015111E4f197641F0D3Fa'],
  ['EARTH','0x424D8BC900C6cc22E791C01d7E92CEd149a232f7'],
  ['WATER','0xa8e8ecB56De8f07f40A4fcaa63D4a6B7887C0a6A'],
  ['PartnerReactor','0xB6207Ac480AfCf5e8ef6cc257Ae495d25b7f58c5'],
  ['WALL','0xBEe606A4Dd8c7027613FA300C517782A14A56490'],
  ['PrivateReactor(PL)','0x4232Dc1E891E6076C8171D7DCa959AE488A544B1'],
  ['MfTusd Compounder','0xC7b8e67f9e3bEf5A4fc5BC2a7445a547DD635797'],
  ['GB Reactor','0x186185E7b161409162639Da59dE6d7D565bec82a'],
  // per-launch primaries + CHARs
  ['MTEST','0xAb2d882d0CBc9065425210F49073EA5dAEDa58eB'],['MTEST-CHAR','0x237EfD82070f7AE71bA1950b10B16F0Ea02CA8e9'],
  ['NMB','0x745BAbD96010A1459edAdc0760c936501fCC95dB'],['NMB-CHAR','0x3C69C3d620616b6840c65145eCbCf7e45CAdf241'],
  ['MR','0x195505D0F711628F4BD32b8C9B6c9D18050F6acc'],['MR-CHAR','0x15FFF1286807FA96b4CaC8B9Bc262A492494c6D8'],
  ['NFSv1','0x71C28E76E3CD6D457e7639314B114760246cdeAD'],['NFSv1-CHAR','0x2eE4029E8d83d80B01B9CD7C0a4EE81e584b87e9'],
  ['BP','0xfDb309F2a7055e2dd8221f9eb27655F11d2d43be'],['BP-CHAR','0x22988bCB84e635c79F570711ea5477C548140a0d'],
  ['Myco','0x87bbF797152Ca3136a92DAc1333Fc7b1f8966e2A'],['Myco-CHAR','0x4618fB5b9914BEEF00C22A1082dCdC4064dcA8c3'],
  ['RTlaunch','0x513d2EB33F1A7eC3798cC221Ab4b4Ce2A3FAfb98'],['RTlaunch-CHAR','0x230a642e12b5Fabb4F4A99789a152548b39a1BE9'],
  ['Turtle','0xf1f8c64102Ee62361eACb694F09d24f42Aaa23da'],['Turtle-CHAR','0x707d226a67CE96aaD18f3594e08d868bc43D388c'],
  ['bAGI','0x20a14d6A1aB57851a58d4A85C0FC06f23A7AeA42'],['bAGI-CHAR','0xbB6Ec399365a8E64ab7d5f7162aE19B441cbEcba'],
  ['Flwr','0x752831229E92957902B328b63df545aB50d98Af5'],['Flwr-CHAR','0xfb3B709882a48b185F266Fc6f37156A92771a558'],
  ['DD','0x1a6Eb1F6Bd44A35ca83d8E5E130D1eb95692b5E0'],['DD-CHAR','0x11bcA0021E9957d7d0c3c358E9ED7a023E9C71a2'],
  ['BRUHr','0x14972F189310c0B510C20f239E283D1cBd8Bfc7A'],['BRUHr-CHAR','0xEFCfb826a5dc63e0854535DCfA567DE94AAB5493'],
  ['NZ','0x93AB8aB8Df2fa299bF1874A638239d5ef6C95330'],['NZ-CHAR','0x685Aa02a4FF0D6c396Ebb15F6F4957D9839E5852'],
  ['ILMr','0x13Fba3fe255b8e3e462816c45725211d06Be82fB'],['ILMr-CHAR','0x3598319EFd15FeC7Bf3eb59c69184CC39b730BDd'],
  ['Moon','0x3534706f4B1642841c008f7368A0A16411c5Abf2'],['Moon-CHAR','0x71A56cB21FC772181c3CC11b3E245d35c956Ee71'],
  ['Bat','0xdb4ED222C19082C8ea9c9A044ce81e2d22DF61AB'],['Bat-CHAR','0x9aea9181e97bf613a1D4Ee9E3e6f477a2B54F061'],
  // wallets + keeper contracts
  ['Agent wallet','0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10'],
  ['Tree wallet','0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2'],
  ['Ops wallet','0xE1259391D74042659553656846A5bdCE34Beb6f9'],
  ['Shark wallet','0x7117437127BE66a2bcEC042F1BEee385c95036E5'],
  ['Peg-onehop bot','0x2BC3dEFA030C63D0a5E3a7A68C47E34f41bdD0f4'],
  ['KeeperBatch V4','0xE693dD02BB1Ba0850A1a153a03b99531004096B1'],
];

(async () => {
  const out = { generatedAtBlock: null, chain: 'base-8453', owners: [] };
  try { out.generatedAtBlock = await call(p => p.getBlockNumber()); } catch {}
  let totalPos = 0, totalAlive = 0;

  for (const [name, addr] of OWNERS) {
    const rec = { name, address: addr, positions: [], error: null };
    try {
      const n = Number(await call(p => new ethers.Contract(NPM, npmAbi, p).balanceOf(addr)));
      for (let i = 0; i < n; i++) {
        try {
          const id = await call(p => new ethers.Contract(NPM, npmAbi, p).tokenOfOwnerByIndex(addr, i));
          const pos = await call(p => new ethers.Contract(NPM, npmAbi, p).positions(id));
          const [s0, s1] = [await sym(pos.token0), await sym(pos.token1)];
          const alive = pos.liquidity > 0n;
          rec.positions.push({ tokenId: id.toString(), pair: `${s0}/${s1}`, token0: pos.token0, token1: pos.token1, fee: Number(pos.fee), liquidity: pos.liquidity.toString(), alive });
          totalPos++; if (alive) totalAlive++;
        } catch (e) { rec.positions.push({ error: 'pos read failed: ' + (e.code || e.message) }); }
      }
    } catch (e) { rec.error = e.code || e.message; }
    const live = rec.positions.filter(p => p.alive).length;
    console.log(`${name.padEnd(20)} ${addr}  -> ${rec.positions.length} pos (${live} alive)${rec.error ? ' ERR ' + rec.error : ''}`);
    out.owners.push(rec);
    fs.writeFileSync('C:\\Users\\bigji\\lp-inventory.json', JSON.stringify(out, null, 2)); // incremental save
  }

  console.log(`\nTOTAL: ${totalPos} V3 positions across ${OWNERS.length} owners, ${totalAlive} alive.`);
  console.log('Written: C:\\Users\\bigji\\lp-inventory.json');
})().catch(e => console.error('FATAL', e));
