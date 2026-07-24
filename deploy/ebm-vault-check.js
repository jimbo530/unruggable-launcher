// READ-ONLY — find the EBM community vault (if created) + its LP (for the page). No signing, no tx.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const RPCS = [process.env.ALCHEMY_RPC, 'https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.llamarpc.com'].filter(Boolean);
const FACTORY = '0x1f6fF7370e2E897db7cf5d72684EF76d988Caaf1';
const EBM     = '0xF113fe2A0E1181A21fA97B1F52ff232140B7692d'; // Elves of Ballinmoore (ebm-deployed.json)
const MFT     = '0xe3dd3881477c20C17Df080cEec0C1bD0C065A072';
const PAIR    = '0x7b053d6dcb7afb45c5d57c85c0442312d9cd04dd'; // EBM/MfT V2 pair (from user)
const ercAbi  = ['function balanceOf(address) view returns (uint256)','function totalSupply() view returns (uint256)','function symbol() view returns (string)','function decimals() view returns (uint8)'];

(async () => {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const f = new ethers.Contract(FACTORY, [
        'function vaultsForToken(address) view returns (address[])',
        'function vaultCount() view returns (uint256)',
      ], p);
      const vaults = await f.vaultsForToken(EBM);
      console.log('RPC:', url.replace(/\/[^/]*$/, '/…'));
      console.log('vaultCount total:', (await f.vaultCount().catch(() => '?')).toString());
      console.log('vaults for EBM:', vaults.length ? vaults : '(NONE yet)');
      if (vaults.length) {
        const addr = vaults[vaults.length - 1];
        const v = new ethers.Contract(addr, [
          'function TOKEN() view returns (address)',
          'function LP() view returns (address)',
          'function totalShares() view returns (uint256)',
        ], p);
        const tok = await v.TOKEN(); const lp = await v.LP(); const ts = await v.totalShares();
        console.log('\n=> VAULT_ADDR:', addr);
        console.log('   TOKEN():', tok, tok.toLowerCase() === EBM.toLowerCase() ? '(EBM ok)' : '(MISMATCH!)');
        console.log('   LP():   ', lp, lp.toLowerCase() === PAIR.toLowerCase() ? '(matches user pair)' : '(differs from user pair!)');
        console.log('   totalShares:', ts.toString());
      }
      // pair reserves either way
      const erc = a => new ethers.Contract(a, ercAbi, p);
      const [rm, re, sup] = await Promise.all([erc(MFT).balanceOf(PAIR), erc(EBM).balanceOf(PAIR), erc(PAIR).totalSupply()]);
      console.log('\nPAIR reserves: MfT', ethers.formatUnits(rm, 6), '| EBM', ethers.formatUnits(re, 18), '| LP supply', ethers.formatUnits(sup, 18));
      return;
    } catch (e) {
      console.log('RPC', url.replace(/\/[^/]*$/, '/…'), 'failed:', e.shortMessage || e.message);
    }
  }
  console.log('All RPCs failed.');
})();
