const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Dock — gasless-relay escrow, mocked unit tests.
//   - usdc      = MockUSDC (6-dec)
//   - shipyard  = MockShipyard (pulls fee from the Dock, mints 100 crew to owner)
//   - crew      = MockCrew (controllable balanceOf marker)
//
// Proves: requestLaunch escrows the LIVE fee; fulfill is permissionless but the
// ship/crew always go to the stored requester (not the fulfiller); double-fulfill
// reverts; reclaim is window-gated and blocks later fulfill; fee-drop refunds.

const FEE = 1_000_000n; // $1
const HOUR = 3600;

describe("Dock — gasless relay escrow (mocked)", function () {
  let usdc, crew, yard, dock;
  let owner, user, relayer, treasury, other;

  beforeEach(async function () {
    [owner, user, relayer, treasury, other] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const MockCrew = await ethers.getContractFactory("MockCrew");
    crew = await MockCrew.deploy();

    const MockShipyard = await ethers.getContractFactory("MockShipyard");
    yard = await MockShipyard.deploy(
      await usdc.getAddress(), treasury.address, await crew.getAddress(), FEE
    );

    const Dock = await ethers.getContractFactory("Dock");
    dock = await Dock.deploy(await yard.getAddress(), await usdc.getAddress());
  });

  async function request(asUser, name = "Black Pearl", symbol = "PEARL") {
    await usdc.mint(asUser.address, FEE);
    await usdc.connect(asUser).approve(await dock.getAddress(), FEE); // exact
    const tx = await dock.connect(asUser).requestLaunch(name, symbol, ethers.ZeroAddress);
    const rcpt = await tx.wait();
    const ev = rcpt.logs
      .map(l => { try { return dock.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "LaunchRequested");
    return ev.args.id;
  }

  it("requestLaunch pulls the live fee into escrow and emits LaunchRequested", async function () {
    await usdc.mint(user.address, FEE);
    await usdc.connect(user).approve(await dock.getAddress(), FEE);

    await expect(dock.connect(user).requestLaunch("Black Pearl", "PEARL", ethers.ZeroAddress))
      .to.emit(dock, "LaunchRequested");

    // Escrow holds the fee; user spent it.
    expect(await usdc.balanceOf(await dock.getAddress())).to.equal(FEE);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);

    const r = await dock.requests(0);
    expect(r.user).to.equal(user.address);
    expect(r.amount).to.equal(FEE);
    expect(r.fulfilled).to.equal(false);
    expect(await dock.requestCount()).to.equal(1n);
  });

  it("requestLaunch reverts if the user has not approved USDC", async function () {
    await usdc.mint(user.address, FEE); // balance but no approval
    await expect(
      dock.connect(user).requestLaunch("X", "X", ethers.ZeroAddress)
    ).to.be.reverted; // MockUSDC transferFrom reverts on missing allowance
  });

  it("fulfill is permissionless: a 3rd-party relayer launches, but the SHIP + 100 crew go to the requester", async function () {
    const id = await request(user);

    // A totally unrelated address (not the user) fulfills.
    const tBefore = await usdc.balanceOf(treasury.address);
    await expect(dock.connect(other).fulfill(id)).to.emit(dock, "LaunchFulfilled");

    // Escrow drained to the shipyard → treasury (the fee was spent on the launch).
    expect(await usdc.balanceOf(await dock.getAddress())).to.equal(0n);
    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(FEE);

    // The ship owner = the requester; crew NFTs went to the USER, not the fulfiller.
    expect(await crew.balanceOf(user.address)).to.equal(100n);
    expect(await crew.balanceOf(other.address)).to.equal(0n);

    expect(await dock.isFulfilled(id)).to.equal(true);
  });

  it("double-fulfill reverts", async function () {
    const id = await request(user);
    await dock.connect(relayer).fulfill(id);
    await expect(dock.connect(relayer).fulfill(id)).to.be.revertedWith("already done");
  });

  it("reclaim reverts before the window, refunds after, and blocks later fulfill", async function () {
    const id = await request(user);

    // Too early.
    await expect(dock.connect(user).reclaim(id)).to.be.revertedWith("too early");

    // Warp past REFUND_WINDOW (1 hour).
    await time.increase(HOUR + 1);

    // Only the requester can reclaim.
    await expect(dock.connect(other).reclaim(id)).to.be.revertedWith("not requester");

    const before = await usdc.balanceOf(user.address);
    await expect(dock.connect(user).reclaim(id)).to.emit(dock, "Reclaimed");
    expect((await usdc.balanceOf(user.address)) - before).to.equal(FEE);
    expect(await usdc.balanceOf(await dock.getAddress())).to.equal(0n);

    // A reclaimed request can never be fulfilled afterward.
    await expect(dock.connect(relayer).fulfill(id)).to.be.revertedWith("already done");
  });

  it("fulfill reverts cleanly if the live fee rose above the escrow", async function () {
    const id = await request(user);
    await yard.setLaunchFee(FEE + 1n); // fee went up after the request
    await expect(dock.connect(relayer).fulfill(id)).to.be.revertedWith("fee rose above escrow");
    // Funds still safe in escrow; user can reclaim after the window.
    expect(await usdc.balanceOf(await dock.getAddress())).to.equal(FEE);
  });

  it("fulfill refunds the leftover if the live fee dropped below the escrow", async function () {
    const id = await request(user);     // escrowed $1
    await yard.setLaunchFee(600_000n);  // fee dropped to $0.60

    const tBefore = await usdc.balanceOf(treasury.address);
    const uBefore = await usdc.balanceOf(user.address);

    await expect(dock.connect(relayer).fulfill(id)).to.emit(dock, "Refunded");

    // Shipyard pulled $0.60; the $0.40 leftover refunded to the user.
    expect((await usdc.balanceOf(treasury.address)) - tBefore).to.equal(600_000n);
    expect((await usdc.balanceOf(user.address)) - uBefore).to.equal(400_000n);
    expect(await usdc.balanceOf(await dock.getAddress())).to.equal(0n);
    // Ship still went to the user.
    expect(await crew.balanceOf(user.address)).to.equal(100n);
  });

  it("requestLaunch reverts when the live fee is zero (free launches go direct)", async function () {
    await yard.setLaunchFee(0);
    await expect(
      dock.connect(user).requestLaunch("X", "X", ethers.ZeroAddress)
    ).to.be.revertedWith("fee is zero");
  });
});
