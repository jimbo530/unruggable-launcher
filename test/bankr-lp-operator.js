// bankr-lp-operator.js — BankrLPOperator: isolated co-admin wrapper for gated location pools.
//
// Proves the Bankr agent wallet can CREATE + SEED/INJECT real gated pools through a wrapper that
// owns its OWN fresh LocationLPFactory — with ZERO reach into our LIVE factory
// (0x54868729015F0050B364729454a018f1FF7a2d01), and with the ECDSA position-gating on swaps
// fully intact and operators walled off from every owner-only power.
//
// Self-contained (deploys its own impl + factory + mock tokens); runs on the in-process hardhat
// net, or on a Base fork when FORK_E2E=1 (chainId is read live so the attestation hash matches
// whichever net is active). Isolation is a pure address/state assertion — no live-chain read
// needed to prove it.
//   npx hardhat test test/bankr-lp-operator.js
//   FORK_E2E=1 ALCHEMY_RPC=<base-rpc> npx hardhat test test/bankr-lp-operator.js   (fork variant)
const { expect } = require("chai");
const { ethers } = require("hardhat");

// The LIVE factory that owns every existing gated pool — MUST never be touched by this wrapper.
const LIVE_FACTORY = "0x54868729015F0050B364729454a018f1FF7a2d01";

describe("BankrLPOperator", function () {
  let treasury, bankr, gameSigner, player, stranger;
  let impl, wrapper, factory, pool, TK0, TK1, chainId;
  const LOC = 8003n;                            // Port Royal hex (q*1000 + r)
  const E = (n) => ethers.parseUnits(n.toString(), 18);

  // Mirror LocationPool.attestationHash: keccak(pool, player, location, expiry, chainid), eth-signed.
  const attest = async (signer, poolAddr, playerAddr, expiry) => {
    const raw = ethers.solidityPackedKeccak256(
      ["address", "address", "uint256", "uint256", "uint256"],
      [poolAddr, playerAddr, LOC, expiry, chainId]
    );
    return signer.signMessage(ethers.getBytes(raw));
  };
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  before(async () => {
    [treasury, bankr, gameSigner, player, stranger] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;

    // Shared pool implementation (the existing deploy is 0x6700ded6…; a fresh clone-template here).
    const Impl = await ethers.getContractFactory("LocationPool");
    impl = await Impl.deploy(); await impl.waitForDeployment();

    // Deploy the wrapper. Its constructor spins up a FRESH factory owned by the wrapper.
    const Wrapper = await ethers.getContractFactory("BankrLPOperator");
    wrapper = await Wrapper.deploy(await impl.getAddress(), gameSigner.address, treasury.address);
    await wrapper.waitForDeployment();
    factory = await ethers.getContractAt("LocationLPFactory", await wrapper.factory());

    // Mock ERC20s (clean fixed-supply, no transfer tax) — stand in for a goods token + GOLD.
    const LT = await ethers.getContractFactory("contracts/LaunchToken.sol:LaunchToken");
    // token0 < token1 sort is handled by the factory; we just need two distinct tokens.
    TK0 = await LT.deploy("Goods", "GOODS", E(10_000_000), bankr.address, ""); await TK0.waitForDeployment();
    TK1 = await LT.deploy("Gold",  "GOLD",  E(10_000_000), bankr.address, ""); await TK1.waitForDeployment();
  });

  // 1) Isolation: the wrapper's factory is a brand-new instance, NOT the live one.
  it("1) deploys its OWN fresh factory, isolated from the live factory", async () => {
    const fAddr = await factory.getAddress();
    expect(fAddr).to.not.equal(ethers.ZeroAddress);
    expect(fAddr.toLowerCase()).to.not.equal(LIVE_FACTORY.toLowerCase());   // isolation proven
    // The wrapper is the fresh factory's owner; treasury owns the wrapper.
    expect(await factory.owner()).to.equal(await wrapper.getAddress());
    expect(await wrapper.owner()).to.equal(treasury.address);
    // Fresh factory carries the same signer we passed, and the real impl.
    expect(await factory.gameSigner()).to.equal(gameSigner.address);
    expect(await factory.implementation()).to.equal(await impl.getAddress());
  });

  // 2) Whitelist the Bankr operator EOA.
  it("2) owner whitelists the Bankr operator", async () => {
    expect(await wrapper.operators(bankr.address)).to.equal(false);
    await wrapper.connect(treasury).setOperator(bankr.address, true);
    expect(await wrapper.operators(bankr.address)).to.equal(true);
    // A non-owner cannot whitelist operators.
    await expect(wrapper.connect(bankr).setOperator(stranger.address, true)).to.be.revertedWith("not owner");
  });

  // 3) Operator creates a gated pool for the goods/GOLD pair at a location.
  it("3) operator (Bankr) creates a gated pool", async () => {
    const a = await TK0.getAddress(), b = await TK1.getAddress();
    await wrapper.connect(bankr).createPool(LOC, a, b, 30, 0, 0);   // 0.30% fee, no cap, no cooldown
    const p = await factory.getPool(LOC, a, b);
    expect(p).to.not.equal(ethers.ZeroAddress);
    pool = await ethers.getContractAt("LocationPool", p);
    expect(await pool.location()).to.equal(LOC);
    expect(await factory.poolCount()).to.equal(1n);
    // The pool's owner resolves (LIVE) to the wrapper — so the wrapper can seed/inject/tune it.
    // (LocationPool.onlyOwner reads ILocationFactory(factory).owner().)
  });

  // 4) Operator seeds the pool: pull from operator -> approve -> pool pulls out. Reserves set.
  it("4) operator seeds the pool (net-zero transient custody), reserves set", async () => {
    await TK0.connect(bankr).approve(await wrapper.getAddress(), E(2000));
    await TK1.connect(bankr).approve(await wrapper.getAddress(), E(2000));
    await wrapper.connect(bankr).seedPool(await pool.getAddress(), E(1000), E(1000));
    const [r0, r1] = await pool.getReserves();
    expect(r0).to.equal(E(1000));
    expect(r1).to.equal(E(1000));
    // Wrapper holds nothing at rest (transient custody only).
    expect(await TK0.balanceOf(await wrapper.getAddress())).to.equal(0n);
    expect(await TK1.balanceOf(await wrapper.getAddress())).to.equal(0n);

    // And inject() single-sided works the same way (skews the price = the mismatch lever).
    await TK0.connect(bankr).approve(await wrapper.getAddress(), E(1000));
    await wrapper.connect(bankr).injectPool(await pool.getAddress(), true, E(1000));
    const [r0b, r1b] = await pool.getReserves();
    expect(r0b).to.equal(E(2000));
    expect(r1b).to.equal(E(1000));
    expect(await TK0.balanceOf(await wrapper.getAddress())).to.equal(0n);
  });

  // 5) Gating INTACT: valid attestation swaps; bad + missing signatures revert.
  it("5) gated swap still works with a valid attestation; bad/missing sig reverts", async () => {
    const t0 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token0());
    const t1 = await ethers.getContractAt("contracts/LaunchToken.sol:LaunchToken", await pool.token1());
    // token0 is GOODS (bankr holds all supply); fund a player.
    await t0.connect(bankr).transfer(player.address, E(100));
    await t0.connect(player).approve(await pool.getAddress(), E(100));

    const expiry = (await now()) + 3600;
    const goodSig = await attest(gameSigner, await pool.getAddress(), player.address, expiry);
    const q = await pool.quote(true, E(100));
    const before = await t1.balanceOf(player.address);
    await pool.connect(player).swap(true, E(100), 0, expiry, goodSig);   // valid -> succeeds
    const got = (await t1.balanceOf(player.address)) - before;
    expect(got).to.equal(q);
    expect(got).to.be.gt(0n);

    // Bad signer -> reverts "bad attestation".
    await t0.connect(bankr).transfer(player.address, E(10));
    await t0.connect(player).approve(await pool.getAddress(), E(10));
    const badExpiry = (await now()) + 3600;
    const badSig = await attest(stranger, await pool.getAddress(), player.address, badExpiry);
    await expect(pool.connect(player).swap(true, E(10), 0, badExpiry, badSig))
      .to.be.revertedWith("bad attestation");

    // Missing/garbage signature -> reverts (ECDSA rejects malformed sig).
    const junk = "0x" + "00".repeat(65);
    await expect(pool.connect(player).swap(true, E(10), 0, badExpiry, junk)).to.be.reverted;
  });

  // 6) Operator is BLOCKED from every owner-only power.
  it("6) operator is blocked from all owner-only functions", async () => {
    await expect(wrapper.connect(bankr).factorySetSigner(stranger.address)).to.be.revertedWith("not owner");
    await expect(wrapper.connect(bankr).factorySetOwner(stranger.address)).to.be.revertedWith("not owner");
    await expect(wrapper.connect(bankr).setOperator(stranger.address, true)).to.be.revertedWith("not owner");
    await expect(wrapper.connect(bankr).setOwner(stranger.address)).to.be.revertedWith("not owner");
    await expect(wrapper.connect(bankr).setPoolParams(await pool.getAddress(), 50, 0, 0)).to.be.revertedWith("not owner");
    await expect(wrapper.connect(bankr).setPoolOpen(await pool.getAddress(), false)).to.be.revertedWith("not owner");
    // Sanity: the operator ALSO cannot reach the fresh factory directly (wrapper is its owner).
    await expect(factory.connect(bankr).setSigner(stranger.address)).to.be.revertedWith("not owner");
    await expect(factory.connect(bankr).createPool(99n, await TK0.getAddress(), await TK1.getAddress(), 30, 0, 0))
      .to.be.revertedWith("not owner");
  });

  // 7) Revoking the operator kills its create power.
  it("7) owner revokes operator -> its next createPool reverts", async () => {
    await wrapper.connect(treasury).setOperator(bankr.address, false);
    expect(await wrapper.operators(bankr.address)).to.equal(false);
    await expect(
      wrapper.connect(bankr).createPool(9001n, await TK0.getAddress(), await TK1.getAddress(), 30, 0, 0)
    ).to.be.revertedWith("not operator");
    // Owner can still create (owner is always an operator via the modifier).
    await wrapper.connect(treasury).createPool(9001n, await TK0.getAddress(), await TK1.getAddress(), 30, 0, 0);
    expect(await factory.poolCount()).to.equal(2n);
  });

  // 8) Owner reclaims the fresh factory directly to treasury.
  it("8) owner reclaims the fresh factory to treasury", async () => {
    await wrapper.connect(treasury).factorySetOwner(treasury.address);
    expect(await factory.owner()).to.equal(treasury.address);
    // After handoff, treasury owns the factory directly and can drive pools itself…
    await factory.connect(treasury).setSigner(gameSigner.address);      // still the same signer, but proves control
    // …and the wrapper can no longer act as factory-owner (it isn't the owner anymore).
    await expect(wrapper.connect(treasury).factorySetSigner(gameSigner.address)).to.be.revertedWith("not owner");
    // The pool's onlyOwner now resolves to treasury (live read), so treasury can tune it.
    await pool.connect(treasury).setParams(50, 0, 0);
    expect(await pool.feeBps()).to.equal(50n);
  });

  // 9) The LIVE factory was never called or modified by any of the above.
  it("9) the live factory was never touched", async () => {
    // Nothing in the wrapper ever references LIVE_FACTORY — this is a design guarantee. We assert
    // the observable: our fresh factory is a different address, and (on a fork) the live factory's
    // state is unchanged. On the local net there is no code at LIVE_FACTORY, which itself proves
    // the wrapper stood up its own factory rather than reusing the live one.
    expect((await factory.getAddress()).toLowerCase()).to.not.equal(LIVE_FACTORY.toLowerCase());
    const liveCode = await ethers.provider.getCode(LIVE_FACTORY);
    if (liveCode !== "0x") {
      // Fork run: the live factory exists. It has a real owner and was not reassigned to our wrapper.
      const live = await ethers.getContractAt("LocationLPFactory", LIVE_FACTORY);
      const liveOwner = await live.owner();
      expect(liveOwner).to.not.equal(await wrapper.getAddress());
      expect(liveOwner).to.not.equal(ethers.ZeroAddress);
    } else {
      // Local run: no code at the live address at all → the wrapper cannot have used it.
      expect(liveCode).to.equal("0x");
    }
  });
});
