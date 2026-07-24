const { ethers } = require('ethers');
const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const DOCK = '0x5A9185666551012B1ef381dA4cA309599AdF85D4';
const AGENT = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const dock = new ethers.Contract(DOCK, [
    'function isFulfilled(uint256) view returns (bool)',
    'event LaunchFulfilled(uint256 indexed id, address indexed user, address token, address reactor, address distributor)',
  ], p);
  const filled = await dock.isFulfilled(0);
  console.log('id 0 fulfilled:', filled);
  if (filled) {
    const evs = await dock.queryFilter(dock.filters.LaunchFulfilled(0), -5000);
    for (const e of evs) {
      console.log('SHIP token  :', e.args.token);
      console.log('reactor     :', e.args.reactor);
      console.log('distributor :', e.args.distributor, '(crew NFTs)');
      const crew = new ethers.Contract(e.args.distributor, ['function balanceOf(address) view returns (uint256)','function tokenURI(uint256) view returns (string)'], p);
      console.log('crew owned by agent:', (await crew.balanceOf(AGENT)).toString());
      console.log('crew #0 tokenURI   :', await crew.tokenURI(0));
    }
  } else {
    console.log('not yet — keeper still working (or check keeper logs).');
  }
})().catch(e => console.error('ERR', e.shortMessage || e.message));
