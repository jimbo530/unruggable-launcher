const { expect } = require("chai");
const { ethers } = require("hardhat");

// BEACON end-to-end charity flow (mocked, contract-level dry run):
//   LP fees (Money) → SporeReactorV6 → redeem Money→USDC → CharityFeeRouter
//   (as the reactor's `distributor`) → flush() → THE SOLAR FOUNDATION address.
//
// Proves the cookie-cutter wiring actually pays the real charity, and that:
//   - the launched TOKEN is still burned 100% (deflationary),
//   - Money never leaks (only redeemed to USDC),
//   - the USDC lands at Solar's real Base recipient address,
//   - a charity-side problem can never brick the reactor (notifyDeposit no-op),
//   - if the charity ever buckles, funds fall back to trees.

const BURN = "0xfd780B0aE569e15e514B819ecFDF46f804953a4B";
// The Solar Foundation — verified Giveth Base (8453) recipient (isRecipient:true).
const SOLAR = "0xB936d993379e5f52b6b8fdcDFA380508F037A420";
const U = 10n ** 6n;          // 6-dec (USDC / Money)
const PRECISION = 10n ** 18n; // 18-dec (TOKEN)
const DELAY = 2 * 24 * 3600;

describe("BEACON — fees → reactor → USDC → CharityFeeRouter → Solar Foundation", function () {
  let token, money, usdc, pm, factory, reactor, router;
  let admin, launcher, alice, trees, upstream;

  const MONEY_ID = 1;

  beforeEach(async function () {
    [admin, launcher, alice, trees, upstream] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockMoney = await ethers.getContractFactory("MockMoney");
    const MockPM = await ethers.getContractFactory("MockPositionManager");
    const MockFactory = await ethers.getContractFactory("MockV3Factory");

    token = await MockERC20.deploy("Beacon", "BEACON");
    usdc = await MockUSDC.deploy();
    money = await MockMoney.deploy(await usdc.getAddress());
    pm = await MockPM.deploy();
    factory = await MockFactory.deploy();

    // Money mock needs USDC to pay redemptions.
    await usdc.mint(await money.getAddress(), 1_000_000n * U);

    const Reactor = await ethers.getContractFactory("SporeReactorV6");
    reactor = await Reactor.deploy();
    await reactor.initialize(
      await token.getAddress(),   // token (BEACON)
      alice.address,              // mft (meme) — unused on Money branch
      await money.getAddress(),   // money
      await usdc.getAddress(),    // usdc
      await pm.getAddress(),      // pm
      alice.address,              // router — unused on Money branch
      await factory.getAddress(), // factory
      upstream.address,           // upstreamReactor — unused
      launcher.address            // launcher
    );

    // TOKEN/Money pool, owned by the reactor.
    await pm.setPosition(MONEY_ID, await token.getAddress(), await money.getAddress(), 10000, await reactor.getAddress());
    await reactor.addPool(MONEY_ID);

    // The cookie-cutter router IS the distributor. Beneficiary = the real Solar
    // Foundation address (auto-verified in the ctor).
    const Router = await ethers.getContractFactory("CharityFeeRouter", admin);
    router = await Router.deploy(await usdc.getAddress(), trees.address, SOLAR, DELAY, admin.address);
    await reactor.setDistributor(await router.getAddress());
  });

  async function seedFees(tokenAmt, moneyAmt) {
    if (tokenAmt) await token.mint(await reactor.getAddress(), tokenAmt);
    if (moneyAmt) await money.mint(await reactor.getAddress(), moneyAmt);
  }

  it("end-to-end: collected Money becomes USDC at the router, then flushes to the Solar Foundation address", async function () {
    const tokenFees = 5000n * PRECISION;
    const moneyFees = 1000n * U;
    await seedFees(tokenFees, moneyFees);

    const burnBefore = await token.balanceOf(BURN);
    const solarBefore = await usdc.balanceOf(SOLAR);

    // Fire the reactor: burns TOKEN, redeems Money→USDC, hands USDC to the router.
    await reactor.execute();

    // TOKEN burned 100% (deflationary).
    expect((await token.balanceOf(BURN)) - burnBefore).to.equal(tokenFees);
    // Money never leaked — fully redeemed.
    expect(await money.balanceOf(await reactor.getAddress())).to.equal(0n);
    expect(await money.balanceOf(await router.getAddress())).to.equal(0n);
    // USDC now parked in the router awaiting flush.
    expect(await router.pending()).to.equal(moneyFees);

    // Anyone flushes → the real Solar Foundation address gets the USDC.
    await expect(router.connect(alice).flush())
      .to.emit(router, "Flushed").withArgs(SOLAR, moneyFees, false);
    expect((await usdc.balanceOf(SOLAR)) - solarBefore).to.equal(moneyFees);
    expect(await router.totalRouted()).to.equal(moneyFees);
    expect(await router.pending()).to.equal(0n);
  });

  it("a charity-side issue never bricks the reactor (notifyDeposit is a no-op)", async function () {
    await seedFees(0n, 500n * U);
    // Even though the router does nothing on notify, execute() must succeed and
    // the USDC must still be sitting in the router for a later flush.
    await expect(reactor.execute()).to.not.be.reverted;
    expect(await router.pending()).to.equal(500n * U);
  });

  it("if Solar buckles (de-verified), a flush falls back to trees — funds never strand", async function () {
    await seedFees(0n, 400n * U);
    await reactor.execute();

    // Governance de-verifies the charity (simulating it going dark).
    await router.setVerifiedCharity(SOLAR, false);

    const treesBefore = await usdc.balanceOf(trees.address);
    await expect(router.flush()).to.emit(router, "Flushed").withArgs(trees.address, 400n * U, true);
    expect((await usdc.balanceOf(trees.address)) - treesBefore).to.equal(400n * U);
  });

  it("multiple fires accumulate, one flush pays Solar the total", async function () {
    await seedFees(0n, 300n * U);
    await reactor.execute();
    await ethers.provider.send("evm_increaseTime", [2 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await seedFees(0n, 700n * U);
    await reactor.execute();

    const before = await usdc.balanceOf(SOLAR);
    await router.flush();
    expect((await usdc.balanceOf(SOLAR)) - before).to.equal(1000n * U);
  });
});
