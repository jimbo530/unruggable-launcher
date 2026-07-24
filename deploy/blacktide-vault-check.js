// READ-ONLY — find the Black Tide community vault the user just created + its LP (for the page).
// Tries multiple RPCs so one flaky endpoint can't stall it. No signing, no tx.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const RPCS = [process.env.ALCHEMY_RPC, 'https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.llamarpc.com'].filter(Boolean);
const FACTORY = '0x1f6fF7370e2E897db7cf5d72684EF76d988Caaf1';
const BT      = '0x8823E5c30a7EC507379e01aeD8F81e0A9Ef787a7'; // BLACKTIDE (verified from the Money/BLACKTIDE pool)
const MONEY   = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const ercAbi  = ['function balanceOf(address) view returns (uint256)','function totalSupply() view returns (uint256)','function symbol() view returns (string)','function decimals() view returns (uint8)'];

(async () => {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const f = new ethers.Contract(FACTORY, [
        'function vaultsForToken(address) view returns (address[])',
        'function vaultCount() view returns (uint256)',
      ], p);
      const vaults = await f.vaultsForToken(BT);
      console.log('RPC:', url.replace(/\/[^/]*$/, '/…'));
      console.log('vaultCount total:', (await f.vaultCount().catch(() => '?')).toString());
      console.log('vaults for BLACKTIDE:', vaults.length ? vaults : '(NONE yet)');
      if (vaults.length) {
        const addr = vaults[vaults.length - 1];
        const v = new ethers.Contract(addr, [
          'function TOKEN() view returns (address)',
          'function LP() view returns (address)',
          'function totalShares() view returns (uint256)',
        ], p);
        const tok = await v.TOKEN(); const lp = await v.LP(); const ts = await v.totalShares();
        console.log('\n=> VAULT_ADDR:', addr);
        console.log('   TOKEN():', tok);
        console.log('   LP():   ', lp);
        console.log('   totalShares:', ts.toString());
        const erc = a => new ethers.Contract(a, ercAbi, p);
        const m = erc(MONEY), b = erc(BT), l = erc(lp);
        const [lm, lb, sup] = await Promise.all([m.balanceOf(lp), b.balanceOf(lp), l.totalSupply().catch(() => 0n)]);
        console.log('   LP reserves:', ethers.formatUnits(lm, 18), 'Money +', ethers.formatUnits(lb, 18), 'BLACKTIDE | LP supply', ethers.formatUnits(sup, 18));
        const poolUsd = Number(ethers.formatUnits(lm, 18)) * 2;
        console.log('   seed pool value: ~$' + poolUsd.toFixed(2), '(Money side x2)');

        // where did the $20 go? vault's own balances + the authoritative seed event
        const u = new ethers.Contract('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', ercAbi, p);
        const [vUsdc, vMoney, vBT] = await Promise.all([u.balanceOf(addr), m.balanceOf(addr), b.balanceOf(addr)]);
        console.log('   VAULT holds: USDC', ethers.formatUnits(vUsdc, 6), '| Money', ethers.formatUnits(vMoney, 18), '| BLACKTIDE', ethers.formatUnits(vBT, 18));
        try {
          const fe = new ethers.Contract(FACTORY, ['event VaultCreated(address indexed vault, address indexed token, address indexed creator, address lp, uint256 seedUsdc, uint256 seedToken, uint256 seedLpBurned)'], p);
          const cur = await p.getBlockNumber();
          const evs = await fe.queryFilter(fe.filters.VaultCreated(addr), cur - 4500, cur);
          for (const ev of evs) console.log('   VaultCreated @blk', ev.blockNumber, '| creator', ev.args.creator, '| seedUsdc $' + ethers.formatUnits(ev.args.seedUsdc, 6), '| seedToken', ethers.formatUnits(ev.args.seedToken, 18), 'BLACKTIDE');
          if (!evs.length) console.log('   (VaultCreated event not in last 4500 blocks — created earlier)');
        } catch (e) { console.log('   event query failed:', e.shortMessage || e.message); }
      }
      return; // success on this RPC — stop
    } catch (e) {
      console.log('RPC', url.replace(/\/[^/]*$/, '/…'), 'failed:', e.shortMessage || e.message);
    }
  }
  console.log('All RPCs failed.');
})();
