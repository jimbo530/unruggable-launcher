// Deploy the open PawnMarket + list the Black Tide's 50 sellable pawns.
// Agent (holds the 100 crew) approves the market + lists 50 by tier:
//   ids 50-69 = FREE (20) · 70-79 = $1 (10) · 80-89 = $5 (10) · 90-99 = $10 (10)
// The agent keeps holding them (multi-seller market pulls on sale). The other 50
// (ids 0-49) stay in the agent as the founder's play-pawns until the dev-wallet
// connect path is sorted. Proceeds → the agent (seller); sweep to dev/tree later.
const { ethers } = require('ethers');
const { execSync } = require('child_process');
const path = require('path');

const RPC = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const CREW = '0x2E2AB7ae48876f1b4497A04d864C025f7DF58e1f';   // Black Tide crew (FeeShareDistributor)
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEV  = '0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2';   // founder's regular wallet (verified ERC721 receiver)
const FEE = { maxFeePerGas: ethers.parseUnits('0.05', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('0.004', 'gwei') };
const ids = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1 });
  const key = execSync("grep AGENT_PRIVATE_KEY /c/Users/bigji/Documents/Baselings/api/.env | sed 's/.*=//'", { encoding: 'utf8' }).trim();
  const agent = new ethers.Wallet(key, p);
  console.log('agent:', agent.address, '| ETH:', ethers.formatEther(await p.getBalance(agent.address)));

  // 1. deploy PawnMarket
  const art = require(path.join(__dirname, '..', 'artifacts', 'contracts', 'PawnMarket.sol', 'PawnMarket.json'));
  const Market = new ethers.ContractFactory(art.abi, art.bytecode, agent);
  console.log('Deploying PawnMarket...');
  const market = await Market.deploy(USDC, FEE);
  await market.waitForDeployment();
  const mAddr = await market.getAddress();
  console.log('  PawnMarket:', mAddr);

  // 2. approve the market for the crew
  const crew = new ethers.Contract(CREW, ['function setApprovalForAll(address,bool)', 'function isApprovedForAll(address,address) view returns (bool)'], agent);
  console.log('Approving market for the crew...');
  await (await crew.setApprovalForAll(mAddr, true, FEE)).wait();
  console.log('  approved:', await crew.isApprovedForAll(agent.address, mAddr));

  // 3. list the 50 sellable pawns by tier
  const m = new ethers.Contract(mAddr, ['function listMany(address,uint256[],uint96)'], agent);
  const tiers = [
    { ids: ids(50, 69), price: 0n,         label: '20 FREE' },
    { ids: ids(70, 79), price: 1_000_000n, label: '10 @ $1' },
    { ids: ids(80, 89), price: 5_000_000n, label: '10 @ $5' },
    { ids: ids(90, 99), price: 10_000_000n, label: '10 @ $10' },
  ];
  for (const t of tiers) {
    console.log('Listing', t.label, '...');
    await (await m.listMany(CREW, t.ids, t.price, FEE)).wait();
  }

  // 4. send the 50 play-pawns (ids 0-49) to the founder's regular wallet
  const crewT = new ethers.Contract(CREW, ['function ownerOf(uint256) view returns (address)', 'function safeTransferFrom(address,address,uint256)'], agent);
  console.log('Sending 50 play-pawns (0-49) to dev wallet', DEV, '...');
  let sent = 0;
  for (const id of ids(0, 49)) {
    if ((await crewT.ownerOf(id)).toLowerCase() !== agent.address.toLowerCase()) continue; // resumable: skip already-moved
    await (await crewT.safeTransferFrom(agent.address, DEV, id, FEE)).wait();
    sent++;
    if (sent % 10 === 0) console.log('  sent', sent, '/ 50');
  }
  console.log('  dev wallet now holds:', sent, 'newly-sent (play-pawns)');

  const fs = require('fs');
  const out = { pawnMarket: mAddr, crew: CREW, usdc: USDC, seller: agent.address, devWallet: DEV,
    tiers: { free: ids(50, 69), '$1': ids(70, 79), '$5': ids(80, 89), '$10': ids(90, 99) },
    playPawnsToDevWallet: ids(0, 49) };
  fs.writeFileSync(path.join(__dirname, 'pawnmarket-deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n=== PAWN MARKET LIVE ===');
  console.log('  market :', mAddr);
  console.log('  listed : 20 free, 10@$1, 10@$5, 10@$10 (ids 50-99)');
  console.log('  agent ETH left:', ethers.formatEther(await p.getBalance(agent.address)));
})().catch(e => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
