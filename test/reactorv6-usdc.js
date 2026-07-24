const { expect } = require("chai");
const { ethers } = require("hardhat");

// SporeReactorV6 — Money→USDC redemption → distributor → NFT accounting.
//
// We exercise the Money branch of processPool end-to-end using mocks:
//   - MockPositionManager.collect() is a no-op; the test pre-funds the reactor
//     with the "collected" TOKEN + Money so we control the amounts.
//   - MockMoney.redeem(amount) burns the caller's Money and pays USDC 1:1
//     (matches the live Money selector verified on the Base fork).
//   - The launched TOKEN is burned 100%; the collected Money is redeemed and the
//     resulting USDC is forwarded to the FeeShareDistributor (payout = USDC).
//
// The meme/buy/LP path needs a real Uniswap pool and is NOT exercised here; it
// is the unchanged V5/V4 behavior.

const BURN = "0xfd780B0aE569e15e514B819ecFDF46f804953a4B";

describe("SporeReactorV6 — Money→USDC fee-share", function () {
  let token, money, usdc, pm, factory, reactor, dist;
  let admin, launcher, alice, bob, upstream;

  const MONEY_ID = 1; // tokenId for the TOKEN/Money pool
  const TOTAL = 100n;
  const PRECISION = 10n ** 18n;
  const U = 10n ** 6n; // 6-dec unit (USDC / Money)

  beforeEach(async function () {
    [admin, launcher, alice, bob, upstream] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockMoney = await ethers.getContractFactory("MockMoney");
    const MockPM = await ethers.getContractFactory("MockPositionManager");
    const MockFactory = await ethers.getContractFactory("MockV3Factory");

    token = await MockERC20.deploy("Launch Token", "LT");
    usdc = await MockUSDC.deploy();
    money = await MockMoney.deploy(await usdc.getAddress());
    pm = await MockPM.deploy();
    factory = await MockFactory.deploy();

    // Pre-fund the Money mock with USDC so it can pay redemptions.
    await usdc.mint(await money.getAddress(), 1_000_000n * U);

    const Reactor = await ethers.getContractFactory("SporeReactorV6");
    reactor = await Reactor.deploy();

    // mft must be != token; we use a dummy meme address (alice) — meme branch
    // is not exercised in these tests.
    await reactor.initialize(
      await token.getAddress(),       // token
      alice.address,                  // mft (meme) — unused here
      await money.getAddress(),       // money
      await usdc.getAddress(),        // usdc
      await pm.getAddress(),          // pm
      alice.address,                  // router — unused on Money branch
      await factory.getAddress(),     // factory
      upstream.address,               // upstreamReactor — unused on Money branch
      launcher.address                // launcher
    );

    // Register the TOKEN/Money pool. token0=token, token1=money.
    await pm.setPosition(
      MONEY_ID,
      await token.getAddress(),
      await money.getAddress(),
      10000,
      await reactor.getAddress() // reactor must own the NFT
    );
    await reactor.addPool(MONEY_ID);

    // Deploy the distributor (PAYOUT = USDC), reactor = our reactor, mint to launcher.
    const FeeShareDistributor = await ethers.getContractFactory("FeeShareDistributor");
    dist = await FeeShareDistributor.deploy(
      await usdc.getAddress(),
      await reactor.getAddress(),
      launcher.address,
      "LT Fee Share",
      "LTFEE",
      "https://crew.tasern.quest/crew/meta/" // baseURI
    );
    await reactor.setDistributor(await dist.getAddress());
  });

  // Simulate "fees collected": fund the reactor with launched TOKEN + Money.
  async function seedFees(tokenAmt, moneyAmt) {
    await token.mint(await reactor.getAddress(), tokenAmt);
    await money.mint(await reactor.getAddress(), moneyAmt);
  }

  it("burns 100% of collected launched TOKEN", async function () {
    const tokenFees = 5000n * PRECISION;
    await seedFees(tokenFees, 0n);

    const burnBefore = await token.balanceOf(BURN);
    await reactor.execute();
    const burnAfter = await token.balanceOf(BURN);

    expect(burnAfter - burnBefore).to.equal(tokenFees);
    // Reactor holds no leftover TOKEN.
    expect(await token.balanceOf(await reactor.getAddress())).to.equal(0n);
  });

  it("redeems collected Money to USDC and lands it in the distributor as NFT pending", async function () {
    const moneyFees = 1000n * U; // divisible by 100
    await seedFees(0n, moneyFees);

    const distAddr = await dist.getAddress();
    expect(await usdc.balanceOf(distAddr)).to.equal(0n);

    await reactor.execute();

    // Money fully redeemed → USDC sits in the distributor.
    expect(await usdc.balanceOf(distAddr)).to.equal(moneyFees);
    // Money never leaked: reactor holds zero Money, distributor holds zero Money.
    expect(await money.balanceOf(await reactor.getAddress())).to.equal(0n);
    expect(await money.balanceOf(distAddr)).to.equal(0n);

    // Each NFT's pending = usdc/100.
    const perNft = moneyFees / TOTAL;
    expect(await dist.pending(0)).to.equal(perNft);
    expect(await dist.pending(99)).to.equal(perNft);
  });

  it("claim pays USDC to the NFT owner", async function () {
    const moneyFees = 1000n * U;
    await seedFees(0n, moneyFees);
    await reactor.execute();

    const perNft = moneyFees / TOTAL;
    const before = await usdc.balanceOf(launcher.address);
    await dist.connect(alice).claim(3); // anyone triggers; owner (launcher) is paid
    const after = await usdc.balanceOf(launcher.address);

    expect(after - before).to.equal(perNft);
    expect(await dist.pending(3)).to.equal(0n);
  });

  it("burns TOKEN and redeems Money in the same fire", async function () {
    const tokenFees = 2000n * PRECISION;
    const moneyFees = 500n * U;
    await seedFees(tokenFees, moneyFees);

    const burnBefore = await token.balanceOf(BURN);
    await reactor.execute();
    const burnAfter = await token.balanceOf(BURN);

    expect(burnAfter - burnBefore).to.equal(tokenFees);
    expect(await usdc.balanceOf(await dist.getAddress())).to.equal(moneyFees);
    expect(await dist.pending(0)).to.equal(moneyFees / TOTAL);
  });

  it("RedeemFailed path does not brick the fire (redeem reverts)", async function () {
    const tokenFees = 1000n * PRECISION;
    const moneyFees = 400n * U;
    await seedFees(tokenFees, moneyFees);

    await money.setFailNext(true); // make redeem() revert

    const burnBefore = await token.balanceOf(BURN);
    // The whole execute() must still succeed (no revert).
    await expect(reactor.execute()).to.not.be.reverted;
    const burnAfter = await token.balanceOf(BURN);

    // TOKEN still burned; no USDC distributed; Money NOT leaked (stays in reactor).
    expect(burnAfter - burnBefore).to.equal(tokenFees);
    expect(await usdc.balanceOf(await dist.getAddress())).to.equal(0n);
    expect(await dist.pending(0)).to.equal(0n);
    expect(await money.balanceOf(await reactor.getAddress())).to.equal(moneyFees);
  });

  it("RedeemZero path does not brick the fire (redeem yields no USDC)", async function () {
    const moneyFees = 400n * U;
    await seedFees(0n, moneyFees);

    await money.setPayZero(true); // redeem succeeds but delivers 0 USDC

    await expect(reactor.execute()).to.not.be.reverted;

    // Money was burned by redeem, but 0 USDC delta → nothing distributed.
    expect(await usdc.balanceOf(await dist.getAddress())).to.equal(0n);
    expect(await dist.pending(0)).to.equal(0n);
  });

  it("non-reactor cannot call notifyDeposit on the distributor", async function () {
    await usdc.mint(await dist.getAddress(), 100n * U);
    await expect(dist.connect(alice).notifyDeposit(100n * U)).to.be.revertedWith("not reactor");
    await expect(dist.connect(launcher).notifyDeposit(100n * U)).to.be.revertedWith("not reactor");
  });

  it("two fires accumulate USDC pending across deposits", async function () {
    await seedFees(0n, 300n * U);
    await reactor.execute();

    // bypass the 2h cooldown for the second fire
    await ethers.provider.send("evm_increaseTime", [2 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await seedFees(0n, 700n * U);
    await reactor.execute();

    const perNft = (1000n * U) / TOTAL;
    expect(await dist.pending(0)).to.equal(perNft);
  });
});
