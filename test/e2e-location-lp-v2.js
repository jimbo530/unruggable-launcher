// e2e-location-lp-v2.js — LocationLPFactoryV2 + LocationPoolV2: everything the V1 suite
// covers (clone, seed, inject-skew, gated swap, guards) PLUS the two V2 additions:
//   1. DROPPABLE KITS — a pool created under a kit id (>= KIT_BASE) refuses swaps until the
//      owner drops it with one-time placeAt(hexId); attestations then bind to the REAL hex.
//   2. WITHDRAW-THEN-RENOUNCE — adminWithdraw works during build (reserves stay true), and
//      renounceAdminWithdraw() closes it ONE-WAY (provably add-only, like V1 from then on).
//   npx hardhat test test/e2e-location-lp-v2.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LocationLPV2", function () {
  let owner, player, gameSigner, stranger, factory, pool, kitPool, TKA, TKB, chainId, KIT_BASE;
  const LOC = 36032n;                       // Kardov's Gate hex (placed-at-create pool)
  const DROP_HEX = 14007n;                  // where the kit town gets dropped
  const E = (n) => ethers.parseUnits(n.toString(), 18);

  // attestation binds to the pool's CURRENT location — pass it explicitly
  const attest = async (signer, poolAddr, playerAddr, loc, expiry) => {
    const raw = ethers.solidityPackedKeccak256(
      ["address", "address", "uint256", "uint256", "uint256"],
      [poolAddr, playerAddr, loc, expiry, chainId]
    );
    return signer.signMessage(ethers.getBytes(raw));
  };
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  before(async () => {
    [owner, player, gameSigner, stranger] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;
    const Impl = await ethers.getContractFactory("LocationPoolV2");
    const impl = await Impl.deploy(); await impl.waitForDeployment();
    const Factory = await ethers.getContractFactory("LocationLPFactoryV2");
    factory = await Factory.deploy(await impl.getAddress(), gameSigner.address); await factory.waitForDeployment();
    KIT_BASE = await factory.KIT_BASE();
    const LT = await ethers.getContractFactory("contracts/LaunchToken.sol:LaunchToken");
    TKA = await LT.deploy("TokenA", "TKA", E(1_000_000), owner.address, ""); await TKA.waitForDeployment();
    TKB = await LT.deploy("TokenB", "TKB", E(1_000_000), owner.address, ""); await TKB.waitForDeployment();
  });

  // ── the V1 behaviors, unchanged in V2 ──

  it("clones a placed pool under a hex id (trades immediately once seeded)", async () => {
    const a = await TKA.getAddress(), b = await TKB.getAddress();
    await factory.createPool(LOC, a, b, 30, 0, 0);
    pool = await ethers.getContractAt("LocationPoolV2", await factory.getPool(LOC, a, b));
    expect(await pool.location()).to.equal(LOC);
    expect(await pool.placed()).to.equal(true);
    expect(await factory.poolCount()).to.equal(1n);
  });

  it("rejects a duplicate pool under the same key", async () => {
    await expect(factory.createPool(LOC, await TKA.getAddress(), await TKB.getAddress(), 30, 0, 0))
      .to.be.revertedWith("pool exists");
  });

  it("seeds, inject() skews, gated swap honors quote + attestation", async () => {
    await TKA.approve(await pool.getAddress(), E(1_000_000));
    await TKB.approve(await pool.getAddress(), E(1_000_000));
    await pool.seed(E(1000), E(1000));
    await pool.inject(true, E(1000));                            // token0 now cheap here
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token0());
    const t1 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token1());
    await t0.transfer(player.address, E(100));
    await t0.connect(player).approve(await pool.getAddress(), E(100));
    const expiry = (await now()) + 3600;
    const sig = await attest(gameSigner, await pool.getAddress(), player.address, LOC, expiry);
    const q = await pool.quote(true, E(100));
    const before = await t1.balanceOf(player.address);
    await pool.connect(player).swap(true, E(100), 0, expiry, sig);
    expect((await t1.balanceOf(player.address)) - before).to.equal(q);
  });

  it("rejects bad-signer + expired attestations", async () => {
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token0());
    await t0.transfer(player.address, E(10));
    await t0.connect(player).approve(await pool.getAddress(), E(10));
    let expiry = (await now()) + 3600;
    const bad = await attest(stranger, await pool.getAddress(), player.address, LOC, expiry);
    await expect(pool.connect(player).swap(true, E(10), 0, expiry, bad)).to.be.revertedWith("bad attestation");
    expiry = (await now()) - 1;
    const sig = await attest(gameSigner, await pool.getAddress(), player.address, LOC, expiry);
    await expect(pool.connect(player).swap(true, E(10), 0, expiry, sig)).to.be.revertedWith("expired");
  });

  // ── V2 addition 1: droppable town kits ──

  it("creates an UNPLACED kit pool under a kit id; swaps refuse until placed", async () => {
    const a = await TKA.getAddress(), b = await TKB.getAddress();
    const kitId = KIT_BASE + 1n;
    await factory.createPool(kitId, a, b, 30, 0, 0);
    kitPool = await ethers.getContractAt("LocationPoolV2", await factory.getPool(kitId, a, b));
    expect(await kitPool.placed()).to.equal(false);
    expect(await kitPool.location()).to.equal(kitId);

    // pre-seed the kit (the whole point: town ready before the hex is known)
    await TKA.approve(await kitPool.getAddress(), E(10_000));
    await TKB.approve(await kitPool.getAddress(), E(10_000));
    await kitPool.seed(E(1000), E(1000));

    // even a "valid" attestation (signed over the kit id) cannot trade an unplaced pool
    const expiry = (await now()) + 3600;
    const sig = await attest(gameSigner, await kitPool.getAddress(), player.address, kitId, expiry);
    await expect(kitPool.connect(player).swap(true, E(1), 0, expiry, sig)).to.be.revertedWith("unplaced");
  });

  it("placeAt() drops the kit on a hex ONCE; attestations bind to the real hex", async () => {
    await expect(kitPool.connect(player).placeAt(DROP_HEX)).to.be.revertedWith("not owner");
    await kitPool.placeAt(DROP_HEX);
    expect(await kitPool.placed()).to.equal(true);
    expect(await kitPool.location()).to.equal(DROP_HEX);
    await expect(kitPool.placeAt(999n)).to.be.revertedWith("placed");   // one-time, forever

    // an attestation signed over the OLD kit id no longer verifies…
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await kitPool.token0());
    await t0.transfer(player.address, E(20));
    await t0.connect(player).approve(await kitPool.getAddress(), E(20));
    const expiry = (await now()) + 3600;
    const oldSig = await attest(gameSigner, await kitPool.getAddress(), player.address, KIT_BASE + 1n, expiry);
    await expect(kitPool.connect(player).swap(true, E(10), 0, expiry, oldSig)).to.be.revertedWith("bad attestation");

    // …and one signed over the REAL hex trades.
    const sig = await attest(gameSigner, await kitPool.getAddress(), player.address, DROP_HEX, expiry);
    await kitPool.connect(player).swap(true, E(10), 0, expiry, sig);
  });

  // ── V2 addition 2: withdraw during build, one-way renounce at ship ──

  it("adminWithdraw pulls reserve during build and keeps the book true", async () => {
    const [r0Before] = await kitPool.getReserves();
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await kitPool.token0());
    const balBefore = await t0.balanceOf(owner.address);
    await kitPool.adminWithdraw(await kitPool.token0(), E(100), owner.address);
    const [r0After] = await kitPool.getReserves();
    expect(r0Before - r0After).to.equal(E(100));                       // reserves synced
    expect((await t0.balanceOf(owner.address)) - balBefore).to.equal(E(100));
    await expect(kitPool.connect(player).adminWithdraw(await kitPool.token0(), E(1), player.address))
      .to.be.revertedWith("not owner");
    await expect(kitPool.adminWithdraw(await kitPool.token0(), E(1_000_000), owner.address))
      .to.be.reverted;                                                 // more than reserve -> underflow
  });

  it("renounceAdminWithdraw is ONE-WAY: withdraw dead forever, swaps unaffected", async () => {
    await expect(kitPool.connect(player).renounceAdminWithdraw()).to.be.revertedWith("not owner");
    await kitPool.renounceAdminWithdraw();
    expect(await kitPool.withdrawRenounced()).to.equal(true);
    await expect(kitPool.adminWithdraw(await kitPool.token0(), E(1), owner.address))
      .to.be.revertedWith("renounced");
    // no un-set exists on the contract; swaps still work
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await kitPool.token0());
    await t0.transfer(player.address, E(5));
    await t0.connect(player).approve(await kitPool.getAddress(), E(5));
    const expiry = (await now()) + 3600;
    const sig = await attest(gameSigner, await kitPool.getAddress(), player.address, DROP_HEX, expiry);
    await kitPool.connect(player).swap(true, E(5), 0, expiry, sig);
  });

  it("keeps V1 guards: cap, cooldown, open toggle, owner-only", async () => {
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token0());
    await t0.transfer(player.address, E(50));
    await t0.connect(player).approve(await pool.getAddress(), E(50));
    await pool.setParams(30, E(5), 0);
    let expiry = (await now()) + 3600;
    let sig = await attest(gameSigner, await pool.getAddress(), player.address, LOC, expiry);
    await expect(pool.connect(player).swap(true, E(10), 0, expiry, sig)).to.be.revertedWith("over cap");
    await pool.connect(player).swap(true, E(5), 0, expiry, sig);
    await pool.setParams(30, E(5), 100);
    expiry = (await now()) + 3600;
    sig = await attest(gameSigner, await pool.getAddress(), player.address, LOC, expiry);
    await expect(pool.connect(player).swap(true, E(5), 0, expiry, sig)).to.be.revertedWith("cooldown");
    await pool.setOpen(false);
    await expect(pool.connect(player).swap(true, E(1), 0, expiry, sig)).to.be.revertedWith("closed");
    await pool.setOpen(true);
    await expect(pool.connect(player).inject(true, E(1))).to.be.revertedWith("not owner");
    await expect(factory.connect(player).createPool(99n, await TKA.getAddress(), await TKB.getAddress(), 30, 0, 0))
      .to.be.revertedWith("not owner");
  });
});
