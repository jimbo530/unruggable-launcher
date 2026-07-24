// Launch the first real ship — "The Black Tide" — through the Dock (gasless flow).
// Agent wallet escrows $1 USDC + requestLaunch; the live keeper fulfills.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'Baselings', 'api', '.env') });
const { ethers } = require('ethers');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const DOCK = '0x5A9185666551012B1ef381dA4cA309599AdF85D4';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NAME = 'The Black Tide';
const TICKER = 'BLACKTIDE';
const KEY = process.env.DEPLOY_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const usdc = new ethers.Contract(USDC, [
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
  ], wallet);
  const dock = new ethers.Contract(DOCK, [
    'function launchFee() view returns (uint256)',
    'function requestLaunch(string,string,address) returns (uint256)',
    'event LaunchRequested(uint256 indexed id, address indexed user, string name, string symbol, uint256 amount)',
  ], wallet);

  const shipyard = new ethers.Contract('0x1afBe7101Acc6460d8793e17c40f9aa5Bbd7D573',
    ['function launchFee() view returns (uint256)'], provider);
  const fee = await shipyard.launchFee();
  const bal = await usdc.balanceOf(wallet.address);
  console.log('requester:', wallet.address);
  console.log('fee      :', ethers.formatUnits(fee, 6), 'USDC  | balance:', ethers.formatUnits(bal, 6), 'USDC');
  if (bal < fee) throw new Error('not enough USDC for the launch fee');

  const allow = await usdc.allowance(wallet.address, DOCK);
  if (allow < fee) {
    const a = await usdc.approve(DOCK, fee);
    console.log('approve tx:', a.hash);
    await a.wait();
  } else { console.log('allowance already sufficient'); }

  const tx = await dock.requestLaunch(NAME, TICKER, ethers.ZeroAddress);
  console.log('requestLaunch tx:', tx.hash);
  const rc = await tx.wait();
  for (const log of rc.logs) {
    try {
      const p = dock.interface.parseLog(log);
      if (p && p.name === 'LaunchRequested') {
        console.log('✓ REQUEST ID:', p.args.id.toString(), '| ship:', p.args.name, '| user:', p.args.user);
      }
    } catch {}
  }
  console.log('Escrowed. The keeper will now fulfill — watch for the ship.');
})().catch(e => { console.error('ERR', e.shortMessage || e.message); process.exit(1); });
