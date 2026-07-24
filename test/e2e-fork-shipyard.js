// ─────────────────────────────────────────────────────────────────────────
// END-TO-END FORK TEST — Shipyard (mutiny-capable ships) on Base mainnet fork
//
// Run with:  FORK_E2E=1 npx hardhat test test/e2e-fork-shipyard.js
//
// Proves against REAL Base bytecode (pinned block 47510000):
//   - Shipyard launches a mutiny-capable ship (ShipToken) with 2 pools, a V6
//     reactor, and a 100-NFT crew (FeeShareDistributor), all minted to launcher.
//   - The launcher (holds all 100 crew NFTs) pays a real 1 USDC fee and mutinies
//     the ship: name()/symbol()/logoURI() change on-chain; ShipRenamed emitted;
//     the treasury receives exactly 1 USDC.
//   - A non-captain (0 crew NFTs) cannot mutiny.
//   - Economic state (supply/balances) is untouched by the mutiny.
// ─────────────────────────────────────────────────────────────────────────

const { expect } = require("chai");
const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");

// Real Base addresses (same set verified in test/e2e-fork-v9.js).
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
  "function symbol() view returns (string)",
];

// Fund a holder with an ERC20 by brute-forcing its balanceOf storage slot.
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
const FEE = 1_000_000n; // 1 USDC

(FORK ? describe : describe.skip)("E2E fork — Shipyard mutiny-capable ship", function () {
  this.timeout(600000);

  let signer, treasury, outsider, prize, usdcAddr;
  let ship, dist, shipyard;

  before(async function () {
    await ethers.provider.send("evm_mine", []); // advance past the fork block
    [signer, treasury, outsider, prize] = await ethers.getSigners();
    await helpers.setBalance(signer.address, ethers.parseEther("100"));

    // Read USDC straight off the Money contract — do NOT trust a literal.
    const moneyView = new ethers.Contract(MONEY, ["function usdc() view returns (address)"], ethers.provider);
    usdcAddr = await moneyView.usdc();

    // Deploy V6 impl + Shipyard, then launch a ship.
    const V6 = await ethers.getContractFactory("SporeReactorV6", signer);
    const impl = await V6.deploy(); await impl.waitForDeployment();

    const fc = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
    let moneyMemeFee = 0;
    for (const f of [100, 500, 3000, 10000]) {
      if ((await fc.getPool(MONEY, MEME, f)) !== ethers.ZeroAddress) { moneyMemeFee = f; break; }
    }
    expect(moneyMemeFee, "no live Money/Meme pool").to.be.greaterThan(0);

    const Shipyard = await ethers.getContractFactory("Shipyard", signer);
    shipyard = await Shipyard.deploy(
      MEME, MONEY, usdcAddr, FACTORY, PM, ROUTER,
      await impl.getAddress(), UPSTREAM, moneyMemeFee, treasury.address
    );
    await shipyard.waitForDeployment();

    // Route the moonshot buy-in to a DISTINCT prize wallet (default is treasury)
    // so the buy-in tests can measure TOKEN-in-prize vs USDC-in-treasury cleanly.
    await (await shipyard.setPrizeWallet(prize.address)).wait();

    // Default launch fee is $1 — fund + approve it for the launcher (signer).
    await fundToken(usdcAddr, signer.address, FEE);
    const usdcSetup = new ethers.Contract(usdcAddr, erc20, signer);
    await (await usdcSetup.approve(await shipyard.getAddress(), FEE)).wait();

    const rcpt = await (await shipyard.launch("Black Pearl", "PEARL", ethers.ZeroAddress)).wait();
    const ev = rcpt.logs
      .map(l => { try { return shipyard.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "ShipLaunched");
    expect(ev, "ShipLaunched not emitted").to.not.be.null;

    ship = await ethers.getContractAt("ShipToken", ev.args.token, signer);
    dist = await ethers.getContractAt("FeeShareDistributor", ev.args.distributor, signer);
    console.log("    ship:", ev.args.token, "| crew:", ev.args.distributor);
  });

  it("launches a mutiny-capable ship: crew wired, 100 NFTs to launcher, usdc+treasury set", async function () {
    expect(await ship.crew()).to.equal(await dist.getAddress());
    expect(await ship.usdc()).to.equal(usdcAddr);
    expect(await ship.treasury()).to.equal(treasury.address);
    expect(await dist.balanceOf(signer.address)).to.equal(100n); // launcher = captain
    expect(await ship.name()).to.equal("Black Pearl");
    expect(await ship.totalSupply()).to.equal(1_000_000_000n * 10n ** 18n);
  });

  it("captain pays 1 real USDC and mutinies: name/symbol/logoURI change, treasury +1 USDC, ShipRenamed", async function () {
    // Launcher holds all 100 crew NFTs → is a captain. Give them 1 real USDC.
    await fundToken(usdcAddr, signer.address, FEE);
    const usdc = new ethers.Contract(usdcAddr, erc20, signer);
    await (await usdc.approve(await ship.getAddress(), FEE)).wait(); // exact approval

    const tBefore = await usdc.balanceOf(treasury.address);

    await expect(ship.connect(signer).mutiny("Queen Anne's Revenge", "QAR", "ipfs://newflag"))
      .to.emit(ship, "ShipRenamed");

    expect(await ship.name()).to.equal("Queen Anne's Revenge");
    expect(await ship.symbol()).to.equal("QAR");
    expect(await ship.logoURI()).to.equal("ipfs://newflag");
    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(FEE);
    console.log("    mutiny succeeded on real USDC fee; treasury +1 USDC; ship re-flagged on-chain");
  });

  it("a non-captain (0 crew NFTs) cannot mutiny", async function () {
    expect(await dist.balanceOf(outsider.address)).to.equal(0n);
    await fundToken(usdcAddr, outsider.address, FEE);
    const usdc = new ethers.Contract(usdcAddr, erc20, outsider);
    await (await usdc.approve(await ship.getAddress(), FEE)).wait();
    // The captain gate blocks it. (Exact "not captain" string is asserted in the
    // mocked suite; against the real OZ crew the gate reverts with empty data,
    // so we assert the guarantee — the mutiny is blocked — not the string.)
    const nameBefore = await ship.name();
    await expect(ship.connect(outsider).mutiny("Hijack", "HJ", "x")).to.be.reverted;
    expect(await ship.name()).to.equal(nameBefore);              // unchanged
    expect(await ship.balanceOf(outsider.address)).to.equal(0n); // economic state untouched
  });

  it("economic state survives the mutiny (supply/balance intact)", async function () {
    expect(await ship.totalSupply()).to.equal(1_000_000_000n * 10n ** 18n);
    // The 70/30 walls are LP-locked; the launcher only holds rounding dust (if any).
    // Just confirm a transfer of any dust the launcher holds still works.
    const bal = await ship.balanceOf(signer.address);
    if (bal > 0n) {
      await ship.connect(signer).transfer(outsider.address, bal);
      expect(await ship.balanceOf(outsider.address)).to.equal(bal);
    }
    expect(await ship.decimals()).to.equal(18n);
  });

  // Helper: parse the ShipLaunched event from a receipt.
  function shipLaunchedOf(rcpt) {
    return rcpt.logs
      .map(l => { try { return shipyard.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "ShipLaunched");
  }

  it("launch() pulls $1: $0.50 buy-in → real TOKEN in prizeWallet, $0.50 remainder → treasury", async function () {
    expect(await shipyard.launchFee()).to.equal(FEE);          // $1 default
    const buyIn = await shipyard.buyInAmount();
    expect(buyIn).to.equal(500_000n);                          // $0.50 default
    const remainder = FEE - buyIn;                              // $0.50 to treasury

    const usdc = new ethers.Contract(usdcAddr, erc20, signer);
    await fundToken(usdcAddr, signer.address, FEE);
    await (await usdc.approve(await shipyard.getAddress(), FEE)).wait(); // exact

    const tBefore = await usdc.balanceOf(treasury.address);
    const rcpt = await (await shipyard.launch("Sea Hawk", "HAWK", ethers.ZeroAddress)).wait();
    const ev = shipLaunchedOf(rcpt);
    expect(ev, "ShipLaunched not emitted").to.not.be.null;

    // BoughtIn event present → buy-in executed (not the failure path).
    const bought = rcpt.logs
      .map(l => { try { return shipyard.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "BoughtIn");
    expect(bought, "BoughtIn not emitted (buy-in did not execute)").to.not.be.undefined;
    expect(bought.args.usdcIn).to.equal(buyIn);
    const tokenOut = bought.args.tokenOut;
    expect(tokenOut, "buy-in produced zero TOKEN").to.be.greaterThan(0n);

    // Real ship TOKEN landed in the prize wallet.
    const shipToken = new ethers.Contract(ev.args.token, erc20, signer);
    expect(await shipToken.balanceOf(prize.address)).to.equal(tokenOut);

    // Remainder USDC → treasury (buy-in USDC left via Money.deposit, not treasury).
    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(remainder);

    // Launcher still owns the ship (100 crew NFTs).
    const d = await ethers.getContractAt("FeeShareDistributor", ev.args.distributor, signer);
    expect(await d.balanceOf(signer.address)).to.equal(100n);

    console.log(
      "    buy-in: 0.5 USDC ->", tokenOut.toString(),
      "ship TOKEN (~$10K floor) to prizeWallet; 0.5 USDC -> treasury"
    );
  });

  it("launchFor(shipOwner): RELAYER pays the $1 fee, SHIPOWNER receives the ship + 100 crew NFTs", async function () {
    const relayer = signer;          // pays gas + the $1 fee
    const shipOwner = outsider;      // owns the ship, holds 0 USDC, pays nothing
    const usdc = new ethers.Contract(usdcAddr, erc20, relayer);

    // Only the relayer funds + approves USDC. The shipOwner has none.
    await fundToken(usdcAddr, relayer.address, FEE);
    await (await usdc.approve(await shipyard.getAddress(), FEE)).wait();
    const ownerUsdcBefore = await usdc.balanceOf(shipOwner.address);
    const tBefore = await usdc.balanceOf(treasury.address);

    const rcpt = await (await shipyard
      .connect(relayer)
      .launchFor(shipOwner.address, "Relayer Ship", "RLY", ethers.ZeroAddress)).wait();
    const ev = shipLaunchedOf(rcpt);
    expect(ev, "ShipLaunched not emitted").to.not.be.null;

    // Relayer paid the full $1; $0.50 remainder → treasury (the other $0.50 was
    // spent on the buy-in via Money.deposit). The shipOwner paid nothing.
    const remainder = FEE - (await shipyard.buyInAmount());
    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(remainder);
    expect(await usdc.balanceOf(shipOwner.address)).to.equal(ownerUsdcBefore);

    // The SHIPOWNER (not the relayer) owns the ship: 100 crew NFTs + launcher role.
    expect(ev.args.launcher).to.equal(shipOwner.address);
    const d = await ethers.getContractAt("FeeShareDistributor", ev.args.distributor, relayer);
    expect(await d.balanceOf(shipOwner.address)).to.equal(100n);
    expect(await d.balanceOf(relayer.address)).to.equal(0n);
    expect(await shipyard.launcherOf(ev.args.reactor)).to.equal(shipOwner.address);
    console.log("    launchFor(): relayer paid $1, shipOwner got the ship + 100 crew NFTs");
  });

  it("free launch (fee=0): owner sets fee to 0, launch pulls no USDC", async function () {
    await (await shipyard.setLaunchFee(0)).wait();
    expect(await shipyard.launchFee()).to.equal(0n);

    const usdc = new ethers.Contract(usdcAddr, erc20, signer);
    const tBefore = await usdc.balanceOf(treasury.address);

    // No USDC funded / approved for the fee — a $0 launch must still succeed.
    const rcpt = await (await shipyard.launch("Free Ship", "FREE", ethers.ZeroAddress)).wait();
    expect(shipLaunchedOf(rcpt), "ShipLaunched not emitted").to.not.be.null;
    expect(await usdc.balanceOf(treasury.address)).to.equal(tBefore); // nothing pulled

    // restore the $1 fee for any later runs
    await (await shipyard.setLaunchFee(FEE)).wait();
  });

  it("BuyInFailed: a broken swap routes the buy-in $0.50 to treasury, launch still succeeds", async function () {
    // Deploy a Shipyard whose ROUTER reverts on swap. Everything else is real.
    const V6 = await ethers.getContractFactory("SporeReactorV6", signer);
    const impl = await V6.deploy(); await impl.waitForDeployment();
    const RevRouter = await ethers.getContractFactory("MockRevertRouter", signer);
    const badRouter = await RevRouter.deploy(); await badRouter.waitForDeployment();

    const fc = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
    let fee = 0;
    for (const f of [100, 500, 3000, 10000]) {
      if ((await fc.getPool(MONEY, MEME, f)) !== ethers.ZeroAddress) { fee = f; break; }
    }

    const Shipyard = await ethers.getContractFactory("Shipyard", signer);
    const yard2 = await Shipyard.deploy(
      MEME, MONEY, usdcAddr, FACTORY, PM, await badRouter.getAddress(),
      await impl.getAddress(), UPSTREAM, fee, treasury.address
    );
    await yard2.waitForDeployment();
    await (await yard2.setPrizeWallet(prize.address)).wait();

    const usdc = new ethers.Contract(usdcAddr, erc20, signer);
    await fundToken(usdcAddr, signer.address, FEE);
    await (await usdc.approve(await yard2.getAddress(), FEE)).wait();

    const tBefore = await usdc.balanceOf(treasury.address);
    const prizeBefore = await usdc.balanceOf(prize.address);

    // Launch must NOT revert despite the broken swap.
    const rcpt = await (await yard2.launch("Doomed Buy", "DOOM", ethers.ZeroAddress)).wait();
    const parsed = rcpt.logs.map(l => { try { return yard2.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
    const names = parsed.map(e => e.name);

    expect(shipLaunchedOf(rcpt), "ShipLaunched not emitted").to.not.be.null; // launch succeeded
    expect(names, "BuyInFailed not emitted").to.include("BuyInFailed");
    expect(names, "BoughtIn should NOT fire on the failure path").to.not.include("BoughtIn");

    // The FULL $1 went to treasury: $0.50 buy-in (refunded on failure) + $0.50 remainder.
    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(FEE);
    // Prize wallet got no USDC (and no TOKEN, since the swap reverted).
    expect(await usdc.balanceOf(prize.address)).to.equal(prizeBefore);

    console.log("    BuyInFailed: swap reverted, $1 routed to treasury, launch still completed");
  });
});
