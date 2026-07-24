const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// CharityFeeRouter — the cookie-cutter charity fee pass-through. Mocked unit tests.
//   - usdc = MockUSDC (6-dec)
//   - flush() pushes 100% of held USDC to the beneficiary, or to trees if the
//     beneficiary is unset/buckled. NO owner withdraw/drain anywhere.
//   - The one lever: repoint the beneficiary (charity-or-trees only, 2-step timelock).

const U = 1_000_000n;        // $1 (6-dec)
const DELAY = 2 * 24 * 3600; // 2-day timelock

describe("CharityFeeRouter — cookie-cutter charity pass-through (mocked)", function () {
  let usdc, router;
  let gov, trees, charityA, charityB, payer, randomCaller, operator, attacker;

  async function fund(dollars) {
    const amt = BigInt(dollars) * U;
    await usdc.mint(await router.getAddress(), amt);
    return amt;
  }

  beforeEach(async function () {
    [gov, trees, charityA, charityB, payer, randomCaller, operator, attacker] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const Router = await ethers.getContractFactory("CharityFeeRouter", gov);
    router = await Router.deploy(
      await usdc.getAddress(),
      trees.address,
      charityA.address, // launch beneficiary (auto-verified in ctor)
      DELAY,
      gov.address       // governance/owner
    );
  });

  // ── flush: 100% pass-through to the charity ────────────────────────────────
  it("flush sends 100% of held USDC to the beneficiary and tracks totalRouted", async function () {
    await fund(10);
    const before = await usdc.balanceOf(charityA.address);
    await expect(router.connect(randomCaller).flush())
      .to.emit(router, "Flushed").withArgs(charityA.address, 10n * U, false);
    expect((await usdc.balanceOf(charityA.address)) - before).to.equal(10n * U);
    expect(await usdc.balanceOf(await router.getAddress())).to.equal(0n);
    expect(await router.totalRouted()).to.equal(10n * U);

    // Accumulates across flushes.
    await fund(5);
    await router.flush();
    expect(await router.totalRouted()).to.equal(15n * U);
  });

  it("flush is permissionless (anyone can push funds through)", async function () {
    await fund(3);
    await expect(router.connect(attacker).flush()).to.not.be.reverted;
    expect(await usdc.balanceOf(charityA.address)).to.equal(3n * U);
  });

  it("flush reverts when there is nothing to flush", async function () {
    await expect(router.flush()).to.be.revertedWith("nothing to flush");
  });

  // ── trees = immortal fallback ──────────────────────────────────────────────
  it("flush routes to trees when the beneficiary is unset (deployed with 0)", async function () {
    const Router = await ethers.getContractFactory("CharityFeeRouter", gov);
    const r2 = await Router.deploy(
      await usdc.getAddress(), trees.address, ethers.ZeroAddress, DELAY, gov.address
    );
    await usdc.mint(await r2.getAddress(), 4n * U);
    const before = await usdc.balanceOf(trees.address);
    await expect(r2.flush()).to.emit(r2, "Flushed").withArgs(trees.address, 4n * U, true);
    expect((await usdc.balanceOf(trees.address)) - before).to.equal(4n * U);
  });

  it("flush falls back to trees when the beneficiary 'buckles' (de-verified)", async function () {
    await fund(6);
    await router.setVerifiedCharity(charityA.address, false); // charity buckles
    const treesBefore = await usdc.balanceOf(trees.address);
    const charBefore = await usdc.balanceOf(charityA.address);
    await expect(router.flush()).to.emit(router, "Flushed").withArgs(trees.address, 6n * U, true);
    expect((await usdc.balanceOf(trees.address)) - treesBefore).to.equal(6n * U);
    expect(await usdc.balanceOf(charityA.address)).to.equal(charBefore); // got nothing
  });

  // ── NO drain path ──────────────────────────────────────────────────────────
  it("has no owner withdraw/drain/rescue path — only flush moves USDC", async function () {
    const names = router.interface.fragments.filter(f => f.type === "function").map(f => f.name);
    for (const banned of ["withdraw", "drain", "rescue", "emergencyWithdraw", "sweep", "skim", "transferOut", "recover"]) {
      expect(names, `unexpected ${banned}()`).to.not.include(banned);
    }
  });

  // ── repoint: constrained + timelocked ──────────────────────────────────────
  it("repoint works (charityA → charityB) via the 2-step timelock", async function () {
    await router.setVerifiedCharity(charityB.address, true);
    await expect(router.proposeBeneficiary(charityB.address)).to.emit(router, "BeneficiaryProposed");
    await expect(router.executeBeneficiary()).to.be.revertedWith("timelocked");

    await time.increase(DELAY + 1);
    await expect(router.executeBeneficiary())
      .to.emit(router, "BeneficiaryChanged").withArgs(charityA.address, charityB.address);
    expect(await router.beneficiary()).to.equal(charityB.address);

    await fund(2);
    const before = await usdc.balanceOf(charityB.address);
    await router.flush();
    expect((await usdc.balanceOf(charityB.address)) - before).to.equal(2n * U);
  });

  it("repoint REVERTS for owner/self/zero/unverified targets; trees always allowed", async function () {
    await expect(router.proposeBeneficiary(operator.address)).to.be.revertedWith("bad target"); // unverified
    await expect(router.proposeBeneficiary(gov.address)).to.be.revertedWith("bad target");       // never the owner
    await expect(router.proposeBeneficiary(await router.getAddress())).to.be.revertedWith("bad target");
    await expect(router.proposeBeneficiary(ethers.ZeroAddress)).to.be.revertedWith("bad target");
    await expect(router.proposeBeneficiary(trees.address)).to.emit(router, "BeneficiaryProposed"); // trees ok
  });

  it("executeBeneficiary REVERTS if the target was de-verified during the timelock", async function () {
    await router.setVerifiedCharity(charityB.address, true);
    await router.proposeBeneficiary(charityB.address);
    await router.setVerifiedCharity(charityB.address, false); // buckled mid-timelock
    await time.increase(DELAY + 1);
    await expect(router.executeBeneficiary()).to.be.revertedWith("target no longer valid");
  });

  it("cancel clears a pending repoint", async function () {
    await router.setVerifiedCharity(charityB.address, true);
    await router.proposeBeneficiary(charityB.address);
    await expect(router.cancelBeneficiary()).to.emit(router, "BeneficiaryProposalCancelled");
    await expect(router.executeBeneficiary()).to.be.revertedWith("none pending");
  });

  // ── access control ─────────────────────────────────────────────────────────
  it("non-governance cannot verify charities or repoint", async function () {
    await expect(router.connect(attacker).setVerifiedCharity(attacker.address, true)).to.be.reverted;
    await expect(router.connect(attacker).proposeBeneficiary(charityB.address)).to.be.reverted;
    await expect(router.connect(attacker).executeBeneficiary()).to.be.reverted;
    await expect(router.connect(attacker).cancelBeneficiary()).to.be.reverted;
  });

  it("setVerifiedCharity rejects owner and self as charity", async function () {
    await expect(router.setVerifiedCharity(gov.address, true)).to.be.revertedWith("charity == owner");
    await expect(router.setVerifiedCharity(await router.getAddress(), true)).to.be.revertedWith("charity == self");
  });

  // ── reactor drop-in hook ───────────────────────────────────────────────────
  it("notifyDeposit is a no-op hook (emits, never reverts, moves no funds)", async function () {
    await fund(5);
    const charBefore = await usdc.balanceOf(charityA.address);
    await expect(router.connect(randomCaller).notifyDeposit(5n * U)).to.emit(router, "Received").withArgs(5n * U);
    // Funds untouched until flush; hook never forwards or reverts.
    expect(await usdc.balanceOf(await router.getAddress())).to.equal(5n * U);
    expect(await usdc.balanceOf(charityA.address)).to.equal(charBefore);
  });

  // ── views ──────────────────────────────────────────────────────────────────
  it("destination() reports the live target and fallback flag", async function () {
    let [dest, toTrees] = await router.destination();
    expect(dest).to.equal(charityA.address);
    expect(toTrees).to.equal(false);

    await router.setVerifiedCharity(charityA.address, false);
    [dest, toTrees] = await router.destination();
    expect(dest).to.equal(trees.address);
    expect(toTrees).to.equal(true);
  });

  it("pending() reports the USDC awaiting flush", async function () {
    expect(await router.pending()).to.equal(0n);
    await fund(7);
    expect(await router.pending()).to.equal(7n * U);
  });

  // ── constructor guards ───────────────────────────────────────────────────
  it("constructor rejects trees==governance and zero addresses", async function () {
    const Router = await ethers.getContractFactory("CharityFeeRouter", gov);
    await expect(Router.deploy(await usdc.getAddress(), gov.address, charityA.address, DELAY, gov.address))
      .to.be.revertedWith("trees == governance");
    await expect(Router.deploy(ethers.ZeroAddress, trees.address, charityA.address, DELAY, gov.address))
      .to.be.revertedWith("zero usdc");
    await expect(Router.deploy(await usdc.getAddress(), ethers.ZeroAddress, charityA.address, DELAY, gov.address))
      .to.be.revertedWith("zero trees");
    await expect(Router.deploy(await usdc.getAddress(), trees.address, gov.address, DELAY, gov.address))
      .to.be.revertedWith("beneficiary == governance");
  });
});
