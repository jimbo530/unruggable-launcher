const { ethers } = require('ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../Baselings/api/.env') });

const p = new ethers.JsonRpcProvider('https://mainnet.base.org');
const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY, p);

const NPM   = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const BB_RX = '0x84FB78ac1E60d33de602cAf004eB5626cd2420bE';
const EB_RX = '0x9bE45Ae0E515e1268DDdF3b787c943E56715694A';

const NPM_ABI = ['function safeTransferFrom(address,address,uint256) external','function ownerOf(uint256) view returns (address)'];
const RX_ABI  = ['function addPool(uint256) external','function poolCount() view returns (uint256)'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TODO = [
  { id: '5055678', rx: BB_RX, label: 'BB/USDC ref' },
  { id: '5055680', rx: BB_RX, label: 'BB/cbBTC 500K' },
  { id: '5055682', rx: BB_RX, label: 'AZUSD/BB 50K' },
  { id: '5055687', rx: BB_RX, label: 'EB/BB cross' },
  { id: '5055699', rx: BB_RX, label: 'BURG/BB 10K' },
  { id: '5055696', rx: EB_RX, label: 'POOP/EB 10K' },
];

async function main() {
  const npm = new ethers.Contract(NPM, NPM_ABI, w);
  console.log('ETH:', ethers.formatEther(await p.getBalance(w.address)));

  for (const item of TODO) {
    const rx = new ethers.Contract(item.rx, RX_ABI, w);
    const owner = await npm.ownerOf(item.id);
    const rxName = item.rx === BB_RX ? 'BB' : 'EB';
    console.log('\n' + item.label + ' #' + item.id + ' → ' + rxName + ' Rx');
    console.log('  Owner: ' + owner.slice(0,10) + '...');

    try {
      if (owner.toLowerCase() === w.address.toLowerCase()) {
        await (await npm.safeTransferFrom(w.address, item.rx, item.id, {gasLimit: 200000})).wait();
        console.log('  Transferred');
        await sleep(3000);
      } else if (owner.toLowerCase() === item.rx.toLowerCase()) {
        console.log('  Already in reactor');
      }
      await (await rx.addPool(item.id, {gasLimit: 200000})).wait();
      console.log('  Added');
    } catch(e) { console.error('  ERR:', e.message.slice(0,120)); }
    await sleep(3000);
  }

  const bbRx = new ethers.Contract(BB_RX, RX_ABI, p);
  const ebRx = new ethers.Contract(EB_RX, RX_ABI, p);
  console.log('\nBB Reactor pools:', (await bbRx.poolCount()).toString());
  console.log('EB Reactor pools:', (await ebRx.poolCount()).toString());
  console.log('ETH left:', ethers.formatEther(await p.getBalance(w.address)));
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
