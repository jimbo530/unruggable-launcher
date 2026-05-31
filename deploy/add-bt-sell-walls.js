require("dotenv").config({ path: require("path").resolve(__dirname, "../../Baselings/api/.env") });
const ethers = require("ethers");

const RPC = "https://base-mainnet.public.blastapi.io";
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;

const BT = "0xFF49E20a1FbDC439c06Bb7c22b3BF37Ef5EA1d74";
const MFTUSD = "0xe3dd3881477c20C17Df080cEec0C1bD0C065A072";
const PM = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const BT_REACTOR = "0x299e5e35036EA2521819D71Bd25B564Ba776E84C";
const BT_MFTUSD_POOL = "0xb75B809bAae824Ee5bf41fb8553af27Cb73e78CB";
const FEE = 10000;
const TICK_SPACE = 200;
const TICK_MIN = -887200;

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const PM_ABI = [
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "function safeTransferFrom(address,address,uint256)",
];

const REACTOR_ABI = [
  "function addPool(uint256 tokenId)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log("Wallet:", wallet.address);

  const bt = new ethers.Contract(BT, ERC20_ABI, wallet);
  const pm = new ethers.Contract(PM, PM_ABI, wallet);
  const reactor = new ethers.Contract(BT_REACTOR, REACTOR_ABI, wallet);
  const pool = new ethers.Contract(BT_MFTUSD_POOL, POOL_ABI, provider);

  // Check balance
  const bal = await bt.balanceOf(wallet.address);
  console.log("BT balance:", ethers.formatUnits(bal, 18));
  if (bal === 0n) { console.log("No BT!"); return; }

  // Verify current tick
  const slot0 = await pool.slot0();
  const currentTick = Number(slot0[1]);
  console.log("Current tick:", currentTick);

  const base = Math.floor(currentTick / TICK_SPACE) * TICK_SPACE;
  const t1 = base - 1000;   // 1.1x
  const t2 = base - 7000;   // 2x
  const t5 = base - 16200;  // 5x
  const tMin = TICK_MIN;

  console.log("\nWall 1 (1.1x): ticks", t2, "to", t1);
  console.log("Wall 2 (2x):   ticks", t5, "to", t2);
  console.log("Wall 3 (5x):   ticks", tMin, "to", t5);

  // Verify all ranges are below current tick (single-sided token1)
  if (t1 >= currentTick) { console.log("ERROR: wall 1 not below current tick!"); return; }

  // Split BT 3 ways
  const s1 = bal / 3n;
  const s2 = bal / 3n;
  const s3 = bal - s1 - s2;
  console.log("\nSplit:", ethers.formatUnits(s1, 18), "/", ethers.formatUnits(s2, 18), "/", ethers.formatUnits(s3, 18));

  // token0 = mftUSD (lower address), token1 = BT
  const token0 = MFTUSD;
  const token1 = BT;

  // Step 1: Approve BT for PM
  console.log("\n[1/10] Approving BT for Position Manager...");
  const appTx = await bt.approve(PM, bal);
  await appTx.wait();
  console.log("Approved:", appTx.hash);

  // Step 2: Mint Wall 1 (1.1x)
  console.log("\n[2/10] Minting Wall 1 (1.1x)...");
  const tx1 = await pm.mint({
    token0, token1, fee: FEE,
    tickLower: t2, tickUpper: t1,
    amount0Desired: 0, amount1Desired: s1,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline: Math.floor(Date.now() / 1000) + 600
  });
  const r1 = await tx1.wait();
  const id1 = getTokenId(r1);
  console.log("Wall 1 minted, NFT #" + id1, tx1.hash);

  // Step 3: Mint Wall 2 (2x)
  console.log("\n[3/10] Minting Wall 2 (2x)...");
  const tx2 = await pm.mint({
    token0, token1, fee: FEE,
    tickLower: t5, tickUpper: t2,
    amount0Desired: 0, amount1Desired: s2,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline: Math.floor(Date.now() / 1000) + 600
  });
  const r2 = await tx2.wait();
  const id2 = getTokenId(r2);
  console.log("Wall 2 minted, NFT #" + id2, tx2.hash);

  // Step 4: Mint Wall 3 (5x)
  console.log("\n[4/10] Minting Wall 3 (5x)...");
  const tx3 = await pm.mint({
    token0, token1, fee: FEE,
    tickLower: tMin, tickUpper: t5,
    amount0Desired: 0, amount1Desired: s3,
    amount0Min: 0, amount1Min: 0,
    recipient: wallet.address, deadline: Math.floor(Date.now() / 1000) + 600
  });
  const r3 = await tx3.wait();
  const id3 = getTokenId(r3);
  console.log("Wall 3 minted, NFT #" + id3, tx3.hash);

  // Steps 5-7: Transfer NFTs to reactor
  for (const [i, id] of [[5, id1], [6, id2], [7, id3]]) {
    console.log(`\n[${i}/10] Transferring NFT #${id} to reactor...`);
    const tx = await pm.safeTransferFrom(wallet.address, BT_REACTOR, id);
    await tx.wait();
    console.log("Transferred:", tx.hash);
  }

  // Steps 8-10: addPool on reactor
  for (const [i, id] of [[8, id1], [9, id2], [10, id3]]) {
    console.log(`\n[${i}/10] addPool(${id}) on reactor...`);
    const tx = await reactor.addPool(id);
    await tx.wait();
    console.log("Added:", tx.hash);
  }

  console.log("\nDone! 3 sell walls locked in BT reactor forever.");
}

function getTokenId(receipt) {
  // Transfer event from PM: Transfer(address,address,uint256)
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  for (const log of receipt.logs) {
    if (log.topics[0] === transferTopic && log.address.toLowerCase() === PM.toLowerCase()) {
      return BigInt(log.topics[3]).toString();
    }
  }
  throw new Error("Could not find tokenId in receipt");
}

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
