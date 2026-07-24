const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ResilientEndowmentVault — the immortal charity core. Mocked unit tests.
//   - usdc       = MockUSDC (6-dec)
//   - aave/aUsdc = MockAavePool / MockAUSDC (supply→mint, withdraw→burn, +yield)
//   - principal  = locked forever; only yield ever leaves, to a constrained dest.

const U = 1_000_000n;     // $1 (6-dec)
const DELAY = 2 * 24 * 3600; // 2-day timelock

describe("ResilientEndowmentVault — immortal charity core (mocked)", function () {
  let usdc, aUsdc, aave, vault;
  let gov, trees, charityA, charityB, player, player2, operator, attacker;

  // cause ids
  const BURGERS = 1n;
  const TGN = 2n;
  const SUCCESSOR = 3n;

  beforeEach(async function () {
    [gov, trees, charityA, charityB, player, player2, operator, attacker] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    const MockAUSDC = await ethers.getContractFactory("MockAUSDC");
    aUsdc = await MockAUSDC.deploy();
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    aave = await MockAavePool.deploy(await usdc.getAddress(), await aUsdc.getAddress());

    const Vault = await ethers.getContractFactory("ResilientEndowmentVault", gov);
    vault = await Vault.deploy(
      await usdc.getAddress(),
      await aave.getAddress(),
      await aUsdc.getAddress(),
      trees.address,
      DELAY,
      gov.address // governance/owner
    );

    // Verify two charities; register two causes.
    await vault.setVerifiedCharity(charityA.address, true);
    await vault.setVerifiedCharity(charityB.address, true);
    await vault.registerCause(BURGERS, charityA.address);
    await vault.registerCause(TGN, ethers.ZeroAddress); // unset → trees fallback
  });

  async function endow(from, account, causeId, dollars) {
    const amt = BigInt(dollars) * U;
    await usdc.mint(from.address, amt);
    await usdc.connect(from).approve(await vault.getAddress(), amt);
    await vault.connect(from).endow(account.address, causeId, amt);
  }

  // ── Per-cause endowment + level math ──────────────────────────────────────
  it("endow records per-cause cumulative endowment ($1 = 1 level) and locks principal in Aave", async function () {
    await endow(player, player, BURGERS, 10);
    expect(await vault.endowedBy(player.address, BURGERS)).to.equal(10n * U);
    expect(await vault.levelOf(player.address, BURGERS)).to.equal(10n * U);
    expect(await vault.totalPrincipal()).to.equal(10n * U);
    // Principal sits in Aave as aUSDC owned by the vault.
    expect(await aUsdc.balanceOf(await vault.getAddress())).to.equal(10n * U);

    // Cumulative across multiple endows.
    await endow(player, player, BURGERS, 5);
    expect(await vault.levelOf(player.address, BURGERS)).to.equal(15n * U);
    expect((await vault.causes(BURGERS)).totalEndowed).to.equal(15n * U);
  });

  it("levels are per-account and per-cause (no cross-contamination)", async function () {
    await endow(player, player, BURGERS, 7);
    await endow(player2, player2, TGN, 3);
    expect(await vault.levelOf(player.address, BURGERS)).to.equal(7n * U);
    expect(await vault.levelOf(player.address, TGN)).to.equal(0n);
    expect(await vault.levelOf(player2.address, TGN)).to.equal(3n * U);
    expect(await vault.levelOf(player2.address, BURGERS)).to.equal(0n);
  });

  // ── Principal can NEVER be withdrawn ──────────────────────────────────────
  it("there is no principal-withdraw/drain path (immortal); harvest moves ONLY yield", async function () {
    await endow(player, player, BURGERS, 100);

    // No function exists to pull principal — assert the ABI has no withdraw/drain/rescue.
    const names = vault.interface.fragments.filter(f => f.type === "function").map(f => f.name);
    for (const banned of ["withdraw", "withdrawPrincipal", "drain", "rescue", "emergencyWithdraw", "redeem", "unlock"]) {
      expect(names, `unexpected ${banned}()`).to.not.include(banned);
    }

    // Harvest with NO yield reverts (nothing above principal to take).
    await expect(vault.harvest(BURGERS)).to.be.revertedWith("no yield");

    // Principal still fully in Aave.
    expect(await aUsdc.balanceOf(await vault.getAddress())).to.equal(100n * U);
    expect(await vault.totalPrincipal()).to.equal(100n * U);
  });

  it("harvest routes only the yield to the beneficiary and leaves principal intact", async function () {
    await endow(player, player, BURGERS, 100);
    // Accrue $4 of yield to the vault.
    await aave.simulateYield(await vault.getAddress(), 4n * U);
    expect(await vault.pendingYield()).to.equal(4n * U);

    const before = await usdc.balanceOf(charityA.address);
    await expect(vault.harvest(BURGERS))
      .to.emit(vault, "YieldRouted").withArgs(BURGERS, charityA.address, 4n * U, false);

    // Charity got exactly the yield; principal untouched.
    expect((await usdc.balanceOf(charityA.address)) - before).to.equal(4n * U);
    expect(await aUsdc.balanceOf(await vault.getAddress())).to.equal(100n * U);
    expect(await vault.totalPrincipal()).to.equal(100n * U);
    // Yield consumed.
    expect(await vault.pendingYield()).to.equal(0n);
  });

  // ── Trees = immortal fallback ─────────────────────────────────────────────
  it("yield falls back to trees when a cause's beneficiary is unset", async function () {
    await endow(player, player, TGN, 50); // TGN beneficiary unset
    await aave.simulateYield(await vault.getAddress(), 2n * U);

    const before = await usdc.balanceOf(trees.address);
    await expect(vault.harvest(TGN))
      .to.emit(vault, "YieldRouted").withArgs(TGN, trees.address, 2n * U, true);
    expect((await usdc.balanceOf(trees.address)) - before).to.equal(2n * U);
  });

  it("yield falls back to trees when a beneficiary 'buckles' (gets de-verified)", async function () {
    await endow(player, player, BURGERS, 50); // beneficiary = charityA (verified)
    await aave.simulateYield(await vault.getAddress(), 3n * U);

    // Charity buckles — governance de-verifies it.
    await vault.setVerifiedCharity(charityA.address, false);

    const treesBefore = await usdc.balanceOf(trees.address);
    const charBefore = await usdc.balanceOf(charityA.address);
    await expect(vault.harvest(BURGERS))
      .to.emit(vault, "YieldRouted").withArgs(BURGERS, trees.address, 3n * U, true);
    expect((await usdc.balanceOf(trees.address)) - treesBefore).to.equal(3n * U);
    expect(await usdc.balanceOf(charityA.address)).to.equal(charBefore); // got nothing
  });

  // ── Beneficiary redirect: constrained + timelocked ────────────────────────
  it("beneficiary redirect works (charity → trees → other charity) via the 2-step timelock", async function () {
    await endow(player, player, BURGERS, 10);

    // Propose moving BURGERS yield to charityB.
    await expect(vault.proposeBeneficiary(BURGERS, charityB.address))
      .to.emit(vault, "BeneficiaryProposed");

    // Can't execute before the timelock.
    await expect(vault.executeBeneficiary(BURGERS)).to.be.revertedWith("timelocked");

    await time.increase(DELAY + 1);
    await expect(vault.executeBeneficiary(BURGERS))
      .to.emit(vault, "BeneficiaryChanged").withArgs(BURGERS, charityA.address, charityB.address);
    expect((await vault.causes(BURGERS)).beneficiary).to.equal(charityB.address);

    // New yield now flows to charityB.
    await aave.simulateYield(await vault.getAddress(), 1n * U);
    const before = await usdc.balanceOf(charityB.address);
    await vault.harvest(BURGERS);
    expect((await usdc.balanceOf(charityB.address)) - before).to.equal(1n * U);
  });

  it("beneficiary redirect REVERTS if target isn't a verified charity or trees", async function () {
    // operator / random / owner are all invalid targets.
    await expect(vault.proposeBeneficiary(BURGERS, operator.address)).to.be.revertedWith("bad target");
    await expect(vault.proposeBeneficiary(BURGERS, gov.address)).to.be.revertedWith("bad target"); // never the operator
    await expect(vault.proposeBeneficiary(BURGERS, await vault.getAddress())).to.be.revertedWith("bad target");
    // trees is always allowed.
    await expect(vault.proposeBeneficiary(BURGERS, trees.address)).to.emit(vault, "BeneficiaryProposed");
  });

  it("executeBeneficiary REVERTS if the target was de-verified during the timelock", async function () {
    await vault.proposeBeneficiary(BURGERS, charityB.address);
    await vault.setVerifiedCharity(charityB.address, false); // buckled mid-timelock
    await time.increase(DELAY + 1);
    await expect(vault.executeBeneficiary(BURGERS)).to.be.revertedWith("target no longer valid");
  });

  // ── Successor remap preserves levels ──────────────────────────────────────
  it("successor remap carries player levels over (never lost) + new endows credit the successor", async function () {
    await vault.registerCause(SUCCESSOR, charityB.address);
    await endow(player, player, BURGERS, 8); // player has 8 levels in BURGERS

    // Remap BURGERS → SUCCESSOR (2-step timelock).
    await expect(vault.proposeSuccessor(BURGERS, SUCCESSOR)).to.emit(vault, "SuccessorProposed");
    await time.increase(DELAY + 1);
    await expect(vault.executeSuccessor(BURGERS))
      .to.emit(vault, "SuccessorRemapped").withArgs(BURGERS, SUCCESSOR);

    // Old levels preserved AND visible through the chain.
    expect(await vault.levelOf(player.address, BURGERS)).to.equal(8n * U);
    expect(await vault.resolveCause(BURGERS)).to.equal(SUCCESSOR);

    // New endow to the OLD cause id credits the successor; level reads sum the chain.
    await endow(player, player, BURGERS, 4);
    expect(await vault.endowedBy(player.address, SUCCESSOR)).to.equal(4n * U); // credited to successor
    expect(await vault.levelOf(player.address, BURGERS)).to.equal(12n * U);    // 8 old + 4 new, never lost
  });

  // ── Governance access control ─────────────────────────────────────────────
  it("non-governance cannot register causes, verify charities, or change beneficiary/successor", async function () {
    await expect(vault.connect(attacker).registerCause(99n, charityA.address)).to.be.reverted;
    await expect(vault.connect(attacker).setVerifiedCharity(attacker.address, true)).to.be.reverted;
    await expect(vault.connect(attacker).proposeBeneficiary(BURGERS, charityB.address)).to.be.reverted;
    await expect(vault.connect(attacker).proposeSuccessor(BURGERS, TGN)).to.be.reverted;
    await expect(vault.connect(attacker).executeBeneficiary(BURGERS)).to.be.reverted;
    await expect(vault.connect(attacker).executeSuccessor(BURGERS)).to.be.reverted;
  });

  it("endow itself is permissionless (anyone can fund a player's level)", async function () {
    // operator funds player's level — fine; it locks money forever to a cause.
    await endow(operator, player, BURGERS, 6);
    expect(await vault.levelOf(player.address, BURGERS)).to.equal(6n * U);
  });

  // ── Misc safety ───────────────────────────────────────────────────────────
  it("cancel proposals clears the pending change and emits", async function () {
    await vault.proposeBeneficiary(BURGERS, charityB.address);
    await expect(vault.cancelBeneficiary(BURGERS)).to.emit(vault, "BeneficiaryProposalCancelled");
    await expect(vault.executeBeneficiary(BURGERS)).to.be.revertedWith("none pending");

    await vault.registerCause(SUCCESSOR, charityB.address);
    await vault.proposeSuccessor(BURGERS, SUCCESSOR);
    await expect(vault.cancelSuccessor(BURGERS)).to.emit(vault, "SuccessorProposalCancelled");
    await expect(vault.executeSuccessor(BURGERS)).to.be.revertedWith("none pending");
  });

  it("constructor rejects trees == governance and zero addresses", async function () {
    const Vault = await ethers.getContractFactory("ResilientEndowmentVault", gov);
    await expect(Vault.deploy(
      await usdc.getAddress(), await aave.getAddress(), await aUsdc.getAddress(),
      gov.address, DELAY, gov.address
    )).to.be.revertedWith("trees == governance");
    await expect(Vault.deploy(
      ethers.ZeroAddress, await aave.getAddress(), await aUsdc.getAddress(),
      trees.address, DELAY, gov.address
    )).to.be.revertedWith("zero usdc");
  });

  it("cause id 0 is reserved (cannot be registered)", async function () {
    await expect(vault.registerCause(0n, charityA.address)).to.be.revertedWith("cause 0 reserved");
  });
});
