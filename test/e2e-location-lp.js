// e2e-location-lp.js — LocationLPFactory + LocationPool: clone, seed, inject-skew,
// signed-attestation gated swap, and the guards (bad sig / expired / cap / cooldown /
// owner-only). Self-contained (no external deps) — runs on the in-process hardhat net.
//   npx hardhat test test/e2e-location-lp.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LocationLP", function () {
  let owner, player, gameSigner, stranger, factory, pool, TKA, TKB, chainId;
  const LOC = 36032n;                       // Kardov's Gate hex
  const E = (n) => ethers.parseUnits(n.toString(), 18);

  const attest = async (signer, poolAddr, playerAddr, expiry) => {
    const raw = ethers.solidityPackedKeccak256(
      ["address", "address", "uint256", "uint256", "uint256"],
      [poolAddr, playerAddr, LOC, expiry, chainId]
    );
    return signer.signMessage(ethers.getBytes(raw));
  };
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  before(async () => {
    [owner, player, gameSigner, stranger] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;
    const Impl = await ethers.getContractFactory("LocationPool");
    const impl = await Impl.deploy(); await impl.waitForDeployment();
    const Factory = await ethers.getContractFactory("LocationLPFactory");
    factory = await Factory.deploy(await impl.getAddress(), gameSigner.address); await factory.waitForDeployment();
    const LT = await ethers.getContractFactory("contracts/LaunchToken.sol:LaunchToken");
    TKA = await LT.deploy("TokenA", "TKA", E(1_000_000), owner.address, ""); await TKA.waitForDeployment();
    TKB = await LT.deploy("TokenB", "TKB", E(1_000_000), owner.address, ""); await TKB.waitForDeployment();
  });

  it("clones a location pool", async () => {
    const a = await TKA.getAddress(), b = await TKB.getAddress();
    await factory.createPool(LOC, a, b, 30, 0, 0);                 // 0.30% fee, no cap, no cooldown
    const p = await factory.getPool(LOC, a, b);
    expect(p).to.not.equal(ethers.ZeroAddress);
    pool = await ethers.getContractAt("LocationPool", p);
    expect(await pool.location()).to.equal(LOC);
    expect(await factory.poolCount()).to.equal(1n);
  });

  it("rejects a duplicate pool", async () => {
    await expect(factory.createPool(LOC, await TKA.getAddress(), await TKB.getAddress(), 30, 0, 0))
      .to.be.revertedWith("pool exists");
  });

  it("seeds 1:1, then inject() skews the price (the mismatch lever)", async () => {
    await TKA.approve(await pool.getAddress(), E(1_000_000));
    await TKB.approve(await pool.getAddress(), E(1_000_000));
    await pool.seed(E(1000), E(1000));
    let [r0, r1] = await pool.getReserves();
    expect(r0).to.equal(E(1000)); expect(r1).to.equal(E(1000));
    await pool.inject(true, E(1000));                             // +1000 token0 -> token0 cheaper here
    [r0, r1] = await pool.getReserves();
    expect(r0).to.equal(E(2000)); expect(r1).to.equal(E(1000));
  });

  it("gated swap works with a valid attestation + reflects the skew", async () => {
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token0());
    const t1 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token1());
    await t0.transfer(player.address, E(100));
    await t0.connect(player).approve(await pool.getAddress(), E(100));
    const expiry = (await now()) + 3600;
    const sig = await attest(gameSigner, await pool.getAddress(), player.address, expiry);
    const q = await pool.quote(true, E(100));                    // ~ 1000*99.7/(2000+99.7) ≈ 47.5
    const before = await t1.balanceOf(player.address);
    await pool.connect(player).swap(true, E(100), 0, expiry, sig);
    const got = (await t1.balanceOf(player.address)) - before;
    expect(got).to.equal(q);                                     // quote matches actual
    expect(got).to.be.gt(E(45)); expect(got).to.be.lt(E(49));    // < 100 (token0 is cheap here = the skew)
  });

  it("rejects a bad-signer attestation", async () => {
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token0());
    await t0.transfer(player.address, E(10));
    await t0.connect(player).approve(await pool.getAddress(), E(10));
    const expiry = (await now()) + 3600;
    const bad = await attest(stranger, await pool.getAddress(), player.address, expiry);
    await expect(pool.connect(player).swap(true, E(10), 0, expiry, bad)).to.be.revertedWith("bad attestation");
  });

  it("rejects an expired attestation", async () => {
    const expiry = (await now()) - 1;
    const sig = await attest(gameSigner, await pool.getAddress(), player.address, expiry);
    await expect(pool.connect(player).swap(true, E(10), 0, expiry, sig)).to.be.revertedWith("expired");
  });

  it("enforces per-tx cap and per-player cooldown", async () => {
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token0());
    await t0.transfer(player.address, E(50));
    await t0.connect(player).approve(await pool.getAddress(), E(50));
    await pool.setParams(30, E(5), 0);                           // cap 5, no cooldown yet
    let expiry = (await now()) + 3600;
    let sig = await attest(gameSigner, await pool.getAddress(), player.address, expiry);
    await expect(pool.connect(player).swap(true, E(10), 0, expiry, sig)).to.be.revertedWith("over cap");
    await pool.connect(player).swap(true, E(5), 0, expiry, sig);  // within cap -> ok (sets lastSwap)
    await pool.setParams(30, E(5), 100);                         // now cooldown 100s
    expiry = (await now()) + 3600;
    sig = await attest(gameSigner, await pool.getAddress(), player.address, expiry);
    await expect(pool.connect(player).swap(true, E(5), 0, expiry, sig)).to.be.revertedWith("cooldown");
  });

  it("only owner can seed / inject / create / setParams", async () => {
    await expect(pool.connect(player).inject(true, E(1))).to.be.revertedWith("not owner");
    await expect(pool.connect(player).setOpen(false)).to.be.revertedWith("not owner");
    await expect(factory.connect(player).createPool(99n, await TKA.getAddress(), await TKB.getAddress(), 30, 0, 0))
      .to.be.revertedWith("not owner");
  });

  it("respects the open/close (siege) toggle", async () => {
    await pool.setOpen(false);
    const expiry = (await now()) + 3600;
    const sig = await attest(gameSigner, await pool.getAddress(), player.address, expiry);
    await expect(pool.connect(player).swap(true, E(1), 0, expiry, sig)).to.be.revertedWith("closed");
    await pool.setOpen(true);
  });
});
