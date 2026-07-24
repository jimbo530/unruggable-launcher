// ─────────────────────────────────────────────────────────────────────────
// END-TO-END FORK TEST — ShipyardV2 (dynamic crew metadata) on Base mainnet fork
//
// Run with:  FORK_E2E=1 npx hardhat test test/e2e-fork-shipyardv2.js
//
// Proves against REAL Base bytecode (pinned block 47510000):
//   - A full ShipyardV2 launch still works end-to-end (token + 2 pools + V6
//     reactor + 100-NFT crew to launcher), REUSING the V6 impl.
//   - The crew NFTs resolve tokenURI(id) = `<crewBaseURI><distributor>:<id>`
//     so the crew-meta service can serve dynamic paper-doll metadata.
// ─────────────────────────────────────────────────────────────────────────

const { expect } = require("chai");
const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");

const MEME    = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3";
const MONEY   = "0xe3dd3881477c20C17Df080cEec0C1bD0C065A072";
const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const PM      = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const ROUTER  = "0x2626664c2603336E57B271c5C0b26F421741e481";
const UPSTREAM = "0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA";

const CREW_BASE_URI = "https://crew.tasern.quest/crew/meta/";

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

async function fundToken(tokenAddr, holder, amount, maxSlot = 40) {
  const t = new ethers.Contract(tokenAddr, erc20, ethers.provider);
  for (let slot = 0; slot < maxSlot; slot++) {
    const key = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holder, slot])
    );
    const before = await t.balanceOf(holder);
    await helpers.setStorageAt(tokenAddr, key, ethers.toBeHex(amount, 32));
    if ((await t.balanceOf(holder)) === BigInt(amount)) return slot;
    await helpers.setStorageAt(tokenAddr, key, ethers.toBeHex(before, 32));
  }
  throw new Error("balanceOf slot not found for " + tokenAddr);
}

const FORK = process.env.FORK_E2E === "1";
const FEE = 1_000_000n;

(FORK ? describe : describe.skip)("E2E fork — ShipyardV2 dynamic crew metadata", function () {
  this.timeout(600000);

  let signer, treasury, usdcAddr, dist;

  before(async function () {
    await ethers.provider.send("evm_mine", []);
    [signer, treasury] = await ethers.getSigners();
    await helpers.setBalance(signer.address, ethers.parseEther("100"));

    const moneyView = new ethers.Contract(MONEY, ["function usdc() view returns (address)"], ethers.provider);
    usdcAddr = await moneyView.usdc();

    // Reuse a V6 impl (mirrors the redeploy: V6 impl is NOT redeployed in prod).
    const V6 = await ethers.getContractFactory("SporeReactorV6", signer);
    const impl = await V6.deploy(); await impl.waitForDeployment();

    const fc = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
    let moneyMemeFee = 0;
    for (const f of [100, 500, 3000, 10000]) {
      if ((await fc.getPool(MONEY, MEME, f)) !== ethers.ZeroAddress) { moneyMemeFee = f; break; }
    }
    expect(moneyMemeFee, "no live Money/Meme pool").to.be.greaterThan(0);

    const ShipyardV2 = await ethers.getContractFactory("ShipyardV2", signer);
    const yard = await ShipyardV2.deploy(
      MEME, MONEY, usdcAddr, FACTORY, PM, ROUTER,
      await impl.getAddress(), UPSTREAM, moneyMemeFee, treasury.address,
      CREW_BASE_URI
    );
    await yard.waitForDeployment();

    // $1 fee — fund + approve, then launch.
    await fundToken(usdcAddr, signer.address, FEE);
    const usdc = new ethers.Contract(usdcAddr, erc20, signer);
    await (await usdc.approve(await yard.getAddress(), FEE)).wait();

    // Explicit gas limit — the full launch (2 pool creates + reactor clone +
    // crew NFT deploy + buy-in swap) is gas-heavy; auto-estimation can undershoot.
    const rcpt = await (await yard.launch("Black Pearl", "PEARL", ethers.ZeroAddress, { gasLimit: 28_000_000 })).wait();
    const ev = rcpt.logs
      .map(l => { try { return yard.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "ShipLaunched");
    expect(ev, "ShipLaunched not emitted").to.not.be.null;

    dist = await ethers.getContractAt("FeeShareDistributor", ev.args.distributor, signer);
    console.log("    crew distributor:", ev.args.distributor);
  });

  it("the launch minted 100 crew NFTs to the launcher", async function () {
    expect(await dist.balanceOf(signer.address)).to.equal(100n);
  });

  it("crew tokenURI(id) resolves to `<crewBaseURI><distributor>:<id>`", async function () {
    const distAddr = (await dist.getAddress()).toLowerCase();
    expect(await dist.baseURI()).to.equal(CREW_BASE_URI);
    expect(await dist.tokenURI(0)).to.equal(CREW_BASE_URI + distAddr + ":0");
    expect(await dist.tokenURI(42)).to.equal(CREW_BASE_URI + distAddr + ":42");
    expect(await dist.tokenURI(99)).to.equal(CREW_BASE_URI + distAddr + ":99");
    await expect(dist.tokenURI(100)).to.be.reverted;
    console.log("    tokenURI(7) =", await dist.tokenURI(7));
  });

  it("the launcher can move the crew metadata host (setBaseURI)", async function () {
    const NEW = "https://crew2.tasern.quest/m/";
    await (await dist.setBaseURI(NEW)).wait();
    const distAddr = (await dist.getAddress()).toLowerCase();
    expect(await dist.tokenURI(5)).to.equal(NEW + distAddr + ":5");
  });
});
