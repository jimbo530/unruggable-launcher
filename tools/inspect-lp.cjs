// inspect-lp.cjs — read-only: identify an LP/pool address (V3 pool or V2 pair) and dump its state.
require('dotenv').config();
const { ethers } = require('ethers');
const RPC  = 'https://mainnet.base.org';
const ADDR = process.env.LP || '0x437b6482480b34791d7aec11b9ca48f9068ae7cd';
const ERC20 = ['function symbol() view returns (string)','function decimals() view returns (uint8)','function balanceOf(address) view returns (uint256)'];

(async () => {
  const net = new ethers.Network('base', 8453);
  const p = new ethers.JsonRpcProvider(RPC, net, { staticNetwork: net });
  console.log('inspecting', ADDR);
  const code = await p.getCode(ADDR);
  console.log('code bytes:', (code.length - 2) / 2);
  if (code === '0x') { console.log('NO CODE — not a contract'); return; }
  const meta = async (a) => { try { const c = new ethers.Contract(a, ERC20, p); return `${await c.symbol()} (${await c.decimals()}dec)`; } catch (e) { return '?'; } };
  const bal  = async (tok, who) => { try { const c = new ethers.Contract(tok, ERC20, p); return ethers.formatUnits(await c.balanceOf(who), await c.decimals()); } catch (e) { return '?'; } };

  // try V3 pool
  try {
    const v3 = new ethers.Contract(ADDR, [
      'function token0() view returns (address)','function token1() view returns (address)',
      'function fee() view returns (uint24)','function tickSpacing() view returns (int24)',
      'function liquidity() view returns (uint128)',
      'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)'
    ], p);
    const [t0, t1, fee, ts, liq, s] = await Promise.all([v3.token0(), v3.token1(), v3.fee(), v3.tickSpacing(), v3.liquidity(), v3.slot0()]);
    const sp = Number(s.sqrtPriceX96) / 2 ** 96, price = sp * sp;
    console.log('=== UNISWAP V3 POOL ===');
    console.log('token0:', t0, await meta(t0), ' held:', await bal(t0, ADDR));
    console.log('token1:', t1, await meta(t1), ' held:', await bal(t1, ADDR));
    console.log('fee:', Number(fee), '(' + (Number(fee) / 10000) + '%)  tickSpacing:', Number(ts));
    console.log('active liquidity:', liq.toString());
    console.log('slot0 tick:', Number(s.tick), ' price(token1/token0):', price.toPrecision(6));
    return;
  } catch (e) { console.log('not a V3 pool (', e.message.slice(0, 60), ')'); }

  // try V2 pair
  try {
    const v2 = new ethers.Contract(ADDR, ['function token0() view returns (address)','function token1() view returns (address)','function getReserves() view returns (uint112,uint112,uint32)','function totalSupply() view returns (uint256)'], p);
    const [t0, t1, r, ts] = await Promise.all([v2.token0(), v2.token1(), v2.getReserves(), v2.totalSupply()]);
    console.log('=== UNISWAP V2 PAIR ===');
    console.log('token0:', t0, await meta(t0), ' reserve:', r[0].toString());
    console.log('token1:', t1, await meta(t1), ' reserve:', r[1].toString());
    console.log('LP totalSupply:', ts.toString());
    return;
  } catch (e) { console.log('not a V2 pair (', e.message.slice(0, 60), ')'); }

  // maybe it's a token / vault itself
  console.log('not V3/V2 — token meta:', await meta(ADDR));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
