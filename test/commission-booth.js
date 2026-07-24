// ============================================================
//  CommissionBooth — unit tests (Hardhat / Chai, no fork needed).
//
//  Covers:
//    1. Happy-path: commission pulls exactly `price` tokens to projectWallet
//       and emits Commissioned with the exact idea + handle strings.
//    2. Reverts: inactive band / not-registered band / insufficient allowance /
//       contract paused.
//    3. Owner-only guards: setBand / setProjectWallet / setPaused /
//       transferOwnership all revert for non-owner.
//    4. Band management: BandSet event; deactivate/reactivate a band.
//    5. transferOwnership: new owner can administer; old owner loses access.
// ============================================================
const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRICE = ethers.parseUnits("100000", 18); // 100 000 × 1e18

describe("CommissionBooth", function () {
  let booth, token;
  let owner, projectWallet, fan, outsider, newOwner;

  beforeEach(async function () {
    [owner, projectWallet, fan, outsider, newOwner] = await ethers.getSigners();

    // Deploy a minimal ERC20 as the band token (MockERC20 already in contracts/test/).
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("ElvesOfBallinmoore", "EBM");

    const Booth = await ethers.getContractFactory("CommissionBooth");
    booth = await Booth.deploy(projectWallet.address);

    // Register band 1 (EBM), price = 100 000 tokens, active.
    await booth.setBand(1, await token.getAddress(), PRICE, true);
  });

  // ── Helper: mint + approve the exact price for `from`. ────────────────────
  async function approveFan(from, amount = PRICE) {
    await token.mint(from.address, amount);
    await token.connect(from).approve(await booth.getAddress(), amount);
  }

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  it("commission transfers exactly `price` to projectWallet and emits Commissioned", async function () {
    await approveFan(fan);

    const idea = "a storm at sea with lightning masts";
    const handle = "@stormfan";

    const before = await token.balanceOf(projectWallet.address);
    const boothBefore = await token.balanceOf(await booth.getAddress());

    const tx = await booth.connect(fan).commission(1, idea, handle);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);

    // Exact token movement.
    const after = await token.balanceOf(projectWallet.address);
    expect(after - before).to.equal(PRICE);

    // Contract holds nothing.
    expect(await token.balanceOf(await booth.getAddress())).to.equal(boothBefore);

    // Fan balance drained by exactly price.
    expect(await token.balanceOf(fan.address)).to.equal(0n);

    // Emits Commissioned with the right fields.
    await expect(tx)
      .to.emit(booth, "Commissioned")
      .withArgs(fan.address, 1, await token.getAddress(), PRICE, idea, handle, block.timestamp);
  });

  it("idea and handle strings pass through verbatim", async function () {
    await approveFan(fan);
    const idea = "two dwarves fighting over a mushroom pizza in space";
    const handle = "@mushroomspace";

    const tx = await booth.connect(fan).commission(1, idea, handle);
    const receipt = await tx.wait();

    // Parse the Commissioned event from the receipt and assert strings directly.
    const iface = booth.interface;
    let found = false;
    for (const log of receipt.logs) {
      let parsed;
      try { parsed = iface.parseLog(log); } catch (_) { continue; }
      if (parsed.name !== "Commissioned") continue;
      expect(parsed.args.idea).to.equal(idea);
      expect(parsed.args.handle).to.equal(handle);
      expect(parsed.args.payer).to.equal(fan.address);
      expect(parsed.args.bandId).to.equal(1n);
      found = true;
    }
    expect(found, "Commissioned event not found in receipt").to.be.true;
  });

  // ── 2. Revert paths ───────────────────────────────────────────────────────

  it("reverts when band is inactive", async function () {
    await booth.setBand(1, await token.getAddress(), PRICE, false); // deactivate
    await approveFan(fan);
    await expect(booth.connect(fan).commission(1, "idea", "handle"))
      .to.be.revertedWith("band");
  });

  it("reverts when band id is not registered", async function () {
    await approveFan(fan);
    await expect(booth.connect(fan).commission(99, "idea", "handle"))
      .to.be.revertedWith("band");
  });

  it("reverts when fan has insufficient allowance", async function () {
    // Mint enough tokens but approve 1 less than price.
    await token.mint(fan.address, PRICE);
    await token.connect(fan).approve(await booth.getAddress(), PRICE - 1n);
    await expect(booth.connect(fan).commission(1, "idea", "handle"))
      .to.be.reverted; // MockERC20 reverts "allowance"
  });

  it("reverts when fan has zero allowance (no approve call at all)", async function () {
    await token.mint(fan.address, PRICE);
    // No approve.
    await expect(booth.connect(fan).commission(1, "idea", "handle"))
      .to.be.reverted;
  });

  it("reverts when contract is paused", async function () {
    await approveFan(fan);
    await booth.setPaused(true);
    await expect(booth.connect(fan).commission(1, "idea", "handle"))
      .to.be.revertedWith("paused");
  });

  it("unpausing allows commission again", async function () {
    await approveFan(fan);
    await booth.setPaused(true);
    await booth.setPaused(false);
    await expect(booth.connect(fan).commission(1, "idea", "handle"))
      .to.emit(booth, "Commissioned");
  });

  // ── 3. Owner-only guards ──────────────────────────────────────────────────

  it("setBand reverts for non-owner", async function () {
    await expect(booth.connect(outsider).setBand(2, await token.getAddress(), PRICE, true))
      .to.be.revertedWith("not owner");
  });

  it("setProjectWallet reverts for non-owner", async function () {
    await expect(booth.connect(outsider).setProjectWallet(outsider.address))
      .to.be.revertedWith("not owner");
  });

  it("setProjectWallet reverts on zero address", async function () {
    await expect(booth.setProjectWallet(ethers.ZeroAddress))
      .to.be.revertedWith("zero wallet");
  });

  it("setPaused reverts for non-owner", async function () {
    await expect(booth.connect(outsider).setPaused(true))
      .to.be.revertedWith("not owner");
  });

  it("transferOwnership reverts for non-owner", async function () {
    await expect(booth.connect(outsider).transferOwnership(newOwner.address))
      .to.be.revertedWith("not owner");
  });

  it("transferOwnership reverts on zero address", async function () {
    await expect(booth.transferOwnership(ethers.ZeroAddress))
      .to.be.revertedWith("zero owner");
  });

  it("setBand reverts for id 0", async function () {
    await expect(booth.setBand(0, await token.getAddress(), PRICE, true))
      .to.be.revertedWith("id 0 reserved");
  });

  // ── 4. Band management ────────────────────────────────────────────────────

  it("setBand emits BandSet and updates state", async function () {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token2 = await MockERC20.deploy("Rish", "RISH");

    await expect(booth.setBand(2, await token2.getAddress(), PRICE * 2n, true))
      .to.emit(booth, "BandSet")
      .withArgs(2, await token2.getAddress(), PRICE * 2n, true);

    const band = await booth.bands(2);
    expect(band.token).to.equal(await token2.getAddress());
    expect(band.price).to.equal(PRICE * 2n);
    expect(band.active).to.equal(true);
  });

  it("deactivated band blocks commission; reactivation restores it", async function () {
    await approveFan(fan);
    await booth.setBand(1, await token.getAddress(), PRICE, false);
    await expect(booth.connect(fan).commission(1, "idea", "handle"))
      .to.be.revertedWith("band");

    // Re-activate.
    await booth.setBand(1, await token.getAddress(), PRICE, true);
    // Re-mint/approve since fan spent nothing yet (tx reverted).
    await expect(booth.connect(fan).commission(1, "idea", "handle"))
      .to.emit(booth, "Commissioned");
  });

  it("projectWallet can be changed and subsequent commission routes correctly", async function () {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    // New project wallet.
    const newWallet = outsider; // reuse signer as new wallet

    await booth.setProjectWallet(newWallet.address);
    await approveFan(fan);

    const before = await token.balanceOf(newWallet.address);
    await booth.connect(fan).commission(1, "idea", "handle");
    expect(await token.balanceOf(newWallet.address) - before).to.equal(PRICE);
  });

  // ── 5. Ownership transfer ─────────────────────────────────────────────────

  it("transferOwnership moves control; old owner loses it", async function () {
    await expect(booth.transferOwnership(newOwner.address))
      .to.emit(booth, "OwnershipTransferred")
      .withArgs(owner.address, newOwner.address);

    expect(await booth.owner()).to.equal(newOwner.address);

    // Old owner can no longer call admin functions.
    await expect(booth.setPaused(true)).to.be.revertedWith("not owner");

    // New owner can.
    await expect(booth.connect(newOwner).setPaused(true))
      .to.emit(booth, "Paused");
  });

  // ── 6. Constructor guards ─────────────────────────────────────────────────

  it("constructor reverts on zero projectWallet", async function () {
    const Booth = await ethers.getContractFactory("CommissionBooth");
    await expect(Booth.deploy(ethers.ZeroAddress))
      .to.be.revertedWith("zero wallet");
  });
});
