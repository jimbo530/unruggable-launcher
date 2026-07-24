// READ-ONLY — find the VaultCreated event for the Black Tide vault to see the AUTHORITATIVE
// seedUsdc / seedToken the user actually passed, and the tx hash. Chunked getLogs so the
// public RPC doesn't choke. No signing.
const { ethers } = require('ethers');
const RPCS = ['https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.llamarpc.com'];
const FACTORY = '0x1f6fF7370e2E897db7cf5d72684EF76d988Caaf1';
const VAULT   = '0x57ebD864E81963b18E30a1D4224f70A242E28d2F';
const LP      = '0xBb9C7fbd56bFEB8Ae3997518e47e8D983777D932';

(async () => {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const fe = new ethers.Contract(FACTORY, ['event VaultCreated(address indexed vault, address indexed token, address indexed creator, address lp, uint256 seedUsdc, uint256 seedToken, uint256 seedLpBurned)'], p);
      const cur = await p.getBlockNumber();
      console.log('RPC', url.replace(/\/[^/]*$/, '/…'), '| head', cur);
      let found = false;
      for (let end = cur; end > cur - 60000 && !found; end -= 700) {
        let evs;
        try { evs = await fe.queryFilter(fe.filters.VaultCreated(VAULT), end - 699, end); }
        catch { continue; }
        for (const ev of evs) {
          found = true;
          console.log('\n✓ VaultCreated  blk', ev.blockNumber);
          console.log('  tx      :', ev.transactionHash);
          console.log('  creator :', ev.args.creator);
          console.log('  lp      :', ev.args.lp);
          console.log('  seedUsdc: $' + ethers.formatUnits(ev.args.seedUsdc, 6));
          console.log('  seedToken:', ethers.formatUnits(ev.args.seedToken, 18), 'BLACKTIDE');
          console.log('  seedLpBurned:', ev.args.seedLpBurned.toString());
        }
      }
      if (!found) console.log('VaultCreated not found in last 60k blocks on this RPC');
      // fresh LP balances RIGHT NOW (raw wei too, so no decimals ambiguity)
      const erc = a => new ethers.Contract(a, ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)'], p);
      const MONEY = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
      const BT = '0x8823E5c30a7EC507379e01aeD8F81e0A9Ef787a7';
      const m = erc(MONEY), b = erc(BT), l = erc(LP);
      const [lm, lb, sup, md] = await Promise.all([m.balanceOf(LP), b.balanceOf(LP), l.totalSupply(), m.decimals()]);
      console.log('\nLP 0xBb9C NOW: Money', ethers.formatUnits(lm, md), '(raw ' + lm.toString() + ') + BLACKTIDE', ethers.formatUnits(lb, 18), '| LP supply', ethers.formatUnits(sup, 18));
      console.log('Money side ~$' + (Number(ethers.formatUnits(lm, md)) * 2).toFixed(2), '(x2 for pool value)');
      return;
    } catch (e) { console.log('RPC', url, 'failed:', e.shortMessage || e.message); }
  }
})();
