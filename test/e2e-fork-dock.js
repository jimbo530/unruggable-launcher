// ─────────────────────────────────────────────────────────────────────────
// END-TO-END FORK TEST — Dock gasless relay on Base mainnet fork
//
// Run with:  FORK_E2E=1 npx hardhat test test/e2e-fork-dock.js
//
// Proves against REAL Base bytecode (pinned block 47510000):
//   - A user requestLaunch()s with 1 real USDC (the cheap tx) → escrowed in Dock.
//   - A DIFFERENT relayer address calls fulfill() (pays the heavy gas).
//   - The ship + 100 crew NFTs land in the USER's wallet (not the relayer's).
//   - The $0.50 buy-in hits prizeWallet, $0.50 remainder hits treasury.
//   - The relayer spends only gas (its USDC is untouched).
//   - reclaim() refunds an unfulfilled request after REFUND_WINDOW.
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

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
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
const HOUR = 3600;

(FORK ? describe : describe.skip)("E2E fork — Dock gasless relay", function () {
  this.timeout(600000);

  let deployer, user, relayer, treasury, prize, usdcAddr;
  let shipyard, dock;

  before(async function () {
    await ethers.provider.send("evm_mine", []); // advance past the fork block
    [deployer, user, relayer, treasury, prize] = await ethers.getSigners();
    for (const s of [deployer, user, relayer]) {
      await helpers.setBalance(s.address, ethers.parseEther("100"));
    }

    const moneyView = new ethers.Contract(MONEY, ["function usdc() view returns (address)"], ethers.provider);
    usdcAddr = await moneyView.usdc();

    // Deploy a real Shipyard (V6 impl), set a distinct prize wallet.
    const V6 = await ethers.getContractFactory("SporeReactorV6", deployer);
    const impl = await V6.deploy(); await impl.waitForDeployment();

    const fc = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
    let moneyMemeFee = 0;
    for (const f of [100, 500, 3000, 10000]) {
      if ((await fc.getPool(MONEY, MEME, f)) !== ethers.ZeroAddress) { moneyMemeFee = f; break; }
    }
    expect(moneyMemeFee, "no live Money/Meme pool").to.be.greaterThan(0);

    const Shipyard = await ethers.getContractFactory("Shipyard", deployer);
    shipyard = await Shipyard.deploy(
      MEME, MONEY, usdcAddr, FACTORY, PM, ROUTER,
      await impl.getAddress(), UPSTREAM, moneyMemeFee, treasury.address
    );
    await shipyard.waitForDeployment();
    await (await shipyard.setPrizeWallet(prize.address)).wait();

    const Dock = await ethers.getContractFactory("Dock", deployer);
    dock = await Dock.deploy(await shipyard.getAddress(), usdcAddr);
    await dock.waitForDeployment();
    console.log("    shipyard:", await shipyard.getAddress(), "| dock:", await dock.getAddress());
  });

  it("relayer pays gas, USER owns the ship: requestLaunch (user) → fulfill (relayer)", async function () {
    const usdcUser = new ethers.Contract(usdcAddr, erc20, user);

    // USER: the cheap tx — fund $1, approve the Dock exactly, request.
    await fundToken(usdcAddr, user.address, FEE);
    await (await usdcUser.approve(await dock.getAddress(), FEE)).wait();

    const reqRcpt = await (await dock.connect(user).requestLaunch("Black Pearl", "PEARL", ethers.ZeroAddress)).wait();
    const reqEv = reqRcpt.logs.map(l => { try { return dock.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "LaunchRequested");
    const id = reqEv.args.id;
    expect(reqEv.args.user).to.equal(user.address);

    // Escrow holds the $1; user spent it.
    expect(await new ethers.Contract(usdcAddr, erc20, ethers.provider).balanceOf(await dock.getAddress())).to.equal(FEE);

    // RELAYER: holds USDC that must NOT be touched (proves relayer pays only gas).
    await fundToken(usdcAddr, relayer.address, FEE);
    const usdcView = new ethers.Contract(usdcAddr, erc20, ethers.provider);
    const relayerUsdcBefore = await usdcView.balanceOf(relayer.address);
    const treBefore = await usdcView.balanceOf(treasury.address);
    const prizeBefore = await usdcView.balanceOf(prize.address);

    // A different address (relayer) fulfills. NOTE: the launch is a ~16M-gas op
    // and ethers auto-estimation under-shoots it (the buy-in's nested try/catch
    // self-call confuses estimation), so we pass an explicit gas limit — exactly
    // what the keeper does. This is a real operational finding, not a test hack.
    const fRcpt = await (await dock.connect(relayer).fulfill(id, { gasLimit: 25_000_000n })).wait();
    const fEv = fRcpt.logs.map(l => { try { return dock.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "LaunchFulfilled");
    expect(fEv, "LaunchFulfilled not emitted").to.not.be.undefined;
    expect(fEv.args.user).to.equal(user.address);

    const token = fEv.args.token;
    const distributor = fEv.args.distributor;

    // The SHIP + 100 crew NFTs went to the USER (not the relayer).
    const dist = await ethers.getContractAt("FeeShareDistributor", distributor, ethers.provider);
    expect(await dist.balanceOf(user.address)).to.equal(100n);
    expect(await dist.balanceOf(relayer.address)).to.equal(0n);
    expect(await shipyard.launcherOf(fEv.args.reactor)).to.equal(user.address);

    // Relayer's USDC untouched (gas only).
    expect(await usdcView.balanceOf(relayer.address)).to.equal(relayerUsdcBefore);

    // Fee split: $0.50 buy-in TOKEN → prizeWallet, $0.50 remainder → treasury.
    const remainder = FEE - (await shipyard.buyInAmount());
    expect((await usdcView.balanceOf(treasury.address)) - treBefore).to.equal(remainder);
    expect(await usdcView.balanceOf(prize.address)).to.equal(prizeBefore); // prize got TOKEN, not USDC
    const shipToken = new ethers.Contract(token, erc20, ethers.provider);
    expect(await shipToken.balanceOf(prize.address)).to.be.greaterThan(0n); // real buy-in TOKEN

    // Escrow drained.
    expect(await usdcView.balanceOf(await dock.getAddress())).to.equal(0n);
    console.log("    user owns ship + 100 crew NFTs; relayer paid only gas; buy-in -> prizeWallet");
  });

  it("reclaim refunds an unfulfilled request after REFUND_WINDOW", async function () {
    const usdcUser = new ethers.Contract(usdcAddr, erc20, user);
    await fundToken(usdcAddr, user.address, FEE);
    await (await usdcUser.approve(await dock.getAddress(), FEE)).wait();

    const rcpt = await (await dock.connect(user).requestLaunch("Ghost", "GHST", ethers.ZeroAddress)).wait();
    const id = rcpt.logs.map(l => { try { return dock.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "LaunchRequested").args.id;

    // Too early.
    await expect(dock.connect(user).reclaim(id)).to.be.revertedWith("too early");

    await helpers.time.increase(HOUR + 1);

    const usdcView = new ethers.Contract(usdcAddr, erc20, ethers.provider);
    const before = await usdcView.balanceOf(user.address);
    await expect(dock.connect(user).reclaim(id)).to.emit(dock, "Reclaimed");
    expect((await usdcView.balanceOf(user.address)) - before).to.equal(FEE);

    // A reclaimed request can never be fulfilled.
    await expect(dock.connect(relayer).fulfill(id)).to.be.revertedWith("already done");
    console.log("    reclaim refunded the user after the window; later fulfill blocked");
  });
});
