const { expect } = require("chai");
const { ethers } = require("hardhat");

// ShipToken mutiny — mocked unit tests.
//   - crew = MockCrew (controllable ERC-721 balanceOf for the 51% gate)
//   - usdc = MockUSDC (6-dec; mutiny costs a flat 1 USDC to the treasury)
//   - Economic state (supply/balances/transfers) must be unaffected by mutiny.

const SUPPLY = 1_000_000_000n * 10n ** 18n;
const FEE = 1_000_000n; // 1 USDC (6-dec)
const BASE_URI = "https://tasern.quest/api/unruggable/metadata/";

describe("ShipToken — mutiny (mocked)", function () {
  let ship, crew, usdc;
  let deployer, recipient, captain, treasury, mate, outsider;

  beforeEach(async function () {
    [deployer, recipient, captain, treasury, mate, outsider] = await ethers.getSigners();

    const MockCrew = await ethers.getContractFactory("MockCrew");
    crew = await MockCrew.deploy();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Deployer is the "factory" — it can setCrew once.
    const ShipToken = await ethers.getContractFactory("ShipToken", deployer);
    ship = await ShipToken.deploy(
      "Black Pearl", "PEARL", SUPPLY, recipient.address, BASE_URI,
      await usdc.getAddress(), treasury.address
    );
    await ship.setCrew(await crew.getAddress());
  });

  async function fundAndApprove(signer, amount) {
    await usdc.mint(signer.address, amount);
    await usdc.connect(signer).approve(await ship.getAddress(), amount);
  }

  it("setCrew can only be set once, and only by the deployer", async function () {
    // Already set in beforeEach.
    await expect(ship.setCrew(await crew.getAddress())).to.be.revertedWith("crew already set");
    // A fresh token: non-deployer cannot set it.
    const ShipToken = await ethers.getContractFactory("ShipToken", deployer);
    const fresh = await ShipToken.deploy(
      "Ship2", "S2", SUPPLY, recipient.address, BASE_URI,
      await usdc.getAddress(), treasury.address
    );
    await expect(fresh.connect(outsider).setCrew(await crew.getAddress())).to.be.revertedWith("not deployer");
  });

  it("a captain (>=51 crew) with USDC + approval can mutiny; treasury +1 USDC; ShipRenamed emitted", async function () {
    await crew.setBalance(captain.address, 51);
    await fundAndApprove(captain, FEE);

    const tBefore = await usdc.balanceOf(treasury.address);

    await expect(ship.connect(captain).mutiny("Queen Anne's Revenge", "QAR", "ipfs://flag1"))
      .to.emit(ship, "ShipRenamed");

    expect(await ship.name()).to.equal("Queen Anne's Revenge");
    expect(await ship.symbol()).to.equal("QAR");
    expect(await ship.logoURI()).to.equal("ipfs://flag1");
    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(FEE);
    // captain's approval was consumed exactly.
    expect(await usdc.allowance(captain.address, await ship.getAddress())).to.equal(0n);
  });

  it("SPAM: 3 back-to-back mutinies each charge $1; treasury +3 USDC; name/logo update each time", async function () {
    await crew.setBalance(captain.address, 60);
    await fundAndApprove(captain, FEE * 3n);

    const tBefore = await usdc.balanceOf(treasury.address);

    for (let i = 1; i <= 3; i++) {
      // exact approval per call is already covered by the 3x bulk approve;
      // each call pulls exactly FEE.
      await ship.connect(captain).mutiny(`Name${i}`, `SYM${i}`, `ipfs://flag${i}`);
      expect(await ship.name()).to.equal(`Name${i}`);
      expect(await ship.logoURI()).to.equal(`ipfs://flag${i}`);
    }

    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(FEE * 3n);
  });

  it("reverts (no cosmetic change) if the captain hasn't approved the 1 USDC", async function () {
    await crew.setBalance(captain.address, 51);
    await usdc.mint(captain.address, FEE); // has balance but NO approval
    // USDC-style tokens revert internally on missing allowance; the mutiny must
    // revert either way (the fee can never be skipped).
    await expect(ship.connect(captain).mutiny("X", "X", "x")).to.be.reverted;
    expect(await ship.name()).to.equal("Black Pearl"); // unchanged
    expect(await usdc.balanceOf(treasury.address)).to.equal(0n); // no fee taken
  });

  it("reverts (no cosmetic change) if the captain approved but lacks the 1 USDC balance", async function () {
    await crew.setBalance(captain.address, 51);
    await usdc.connect(captain).approve(await ship.getAddress(), FEE); // approval, no balance
    await expect(ship.connect(captain).mutiny("X", "X", "x")).to.be.reverted;
    expect(await ship.name()).to.equal("Black Pearl"); // unchanged
    expect(await usdc.balanceOf(treasury.address)).to.equal(0n);
  });

  it("reverts for a holder of <51 crew NFTs (not captain), before any fee is charged", async function () {
    await crew.setBalance(mate.address, 50); // one short
    await fundAndApprove(mate, FEE);

    const tBefore = await usdc.balanceOf(treasury.address);
    await expect(ship.connect(mate).mutiny("Mutiny", "M", "x")).to.be.revertedWith("not captain");
    // No fee taken on a failed (gated-out) mutiny.
    expect(await usdc.balanceOf(treasury.address)).to.equal(tBefore);
  });

  it("reverts if crew is not set", async function () {
    const ShipToken = await ethers.getContractFactory("ShipToken", deployer);
    const fresh = await ShipToken.deploy(
      "NoCrew", "NC", SUPPLY, recipient.address, BASE_URI,
      await usdc.getAddress(), treasury.address
    );
    await crew.setBalance(captain.address, 100);
    await fundAndApprove(captain, FEE);
    await expect(fresh.connect(captain).mutiny("X", "X", "x")).to.be.revertedWith("crew not set");
  });

  it("economic state (supply/balances/transfers) is unaffected by a mutiny", async function () {
    // Pre-mutiny economic snapshot.
    expect(await ship.totalSupply()).to.equal(SUPPLY);
    expect(await ship.balanceOf(recipient.address)).to.equal(SUPPLY);
    expect(await ship.decimals()).to.equal(18n);

    // A normal transfer works.
    await ship.connect(recipient).transfer(mate.address, 1000n);
    expect(await ship.balanceOf(mate.address)).to.equal(1000n);

    // Mutiny.
    await crew.setBalance(captain.address, 51);
    await fundAndApprove(captain, FEE);
    await ship.connect(captain).mutiny("Renamed", "REN", "ipfs://x");

    // Economic state identical after mutiny.
    expect(await ship.totalSupply()).to.equal(SUPPLY);
    expect(await ship.balanceOf(recipient.address)).to.equal(SUPPLY - 1000n);
    expect(await ship.balanceOf(mate.address)).to.equal(1000n);
    expect(await ship.decimals()).to.equal(18n);

    // Transfers still work post-mutiny.
    await ship.connect(mate).transfer(outsider.address, 400n);
    expect(await ship.balanceOf(outsider.address)).to.equal(400n);
    expect(await ship.balanceOf(mate.address)).to.equal(600n);
  });
});
