const { expect } = require("chai");
const { ethers } = require("hardhat");

// GearStore1155 — basic battle-grid gear, mocked unit tests.
//   - paymentToken = MockUSDC (6-dec)
//   - proceeds     = an impact sink (trees/LP/endowment) — a plain address here
//   - gear stats are off-chain; only id/price/active/name/uri live on-chain.

const BASE_URI = "https://tasern.quest/api/gear/";
const U = 1_000_000n; // 1 USDC (6-dec)

// Gear ids
const SWORD = 1n;
const SHIELD = 2n;

describe("GearStore1155 — basic gear store (mocked)", function () {
  let store, usdc;
  let owner, proceeds, buyer, burner, other;

  beforeEach(async function () {
    [owner, proceeds, buyer, burner, other] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const GearStore = await ethers.getContractFactory("GearStore1155", owner);
    store = await GearStore.deploy(await usdc.getAddress(), proceeds.address, BASE_URI);
  });

  async function fundAndApprove(signer, amount) {
    await usdc.mint(signer.address, amount);
    await usdc.connect(signer).approve(await store.getAddress(), amount);
  }

  it("owner registers gear and it is active with the right price/name", async function () {
    await expect(store.registerGear(SWORD, 5n * U, "Iron Sword"))
      .to.emit(store, "GearRegistered").withArgs(SWORD, 5n * U, "Iron Sword");

    const g = await store.gear(SWORD);
    expect(g.price).to.equal(5n * U);
    expect(g.active).to.equal(true);
    expect(g.exists).to.equal(true);
    expect(g.name).to.equal("Iron Sword");
    expect(await store.uri(SWORD)).to.equal(BASE_URI + "1");
  });

  it("buy() mints the gear and pulls EXACT USDC to proceeds", async function () {
    await store.registerGear(SWORD, 5n * U, "Iron Sword");
    await fundAndApprove(buyer, 15n * U);

    const proceedsBefore = await usdc.balanceOf(proceeds.address);
    await expect(store.connect(buyer).buy(SWORD, 3n))
      .to.emit(store, "GearBought").withArgs(buyer.address, SWORD, 3n, 15n * U);

    expect(await store.balanceOf(buyer.address, SWORD)).to.equal(3n);
    // Exact cost (5 * 3 = 15 USDC) went to proceeds; buyer's approval consumed.
    expect((await usdc.balanceOf(proceeds.address)) - proceedsBefore).to.equal(15n * U);
    expect(await usdc.balanceOf(buyer.address)).to.equal(0n);
  });

  it("buy() reverts if the gear is inactive", async function () {
    await store.registerGear(SWORD, 5n * U, "Iron Sword");
    await store.setActive(SWORD, false);
    await fundAndApprove(buyer, 5n * U);
    await expect(store.connect(buyer).buy(SWORD, 1n)).to.be.revertedWith("inactive");
  });

  it("buy() reverts if buyer hasn't approved USDC", async function () {
    await store.registerGear(SWORD, 5n * U, "Iron Sword");
    await usdc.mint(buyer.address, 5n * U); // balance but no approval
    await expect(store.connect(buyer).buy(SWORD, 1n)).to.be.reverted; // MockUSDC reverts on missing allowance
    expect(await store.balanceOf(buyer.address, SWORD)).to.equal(0n); // nothing minted
  });

  it("buy() reverts for an unregistered id", async function () {
    await fundAndApprove(buyer, 100n * U);
    await expect(store.connect(buyer).buy(999n, 1n)).to.be.revertedWith("not registered");
  });

  it("OPEN MINT: a large amount works (no supply cap)", async function () {
    await store.registerGear(SHIELD, 1n * U, "Wood Shield");
    const BIG = 1_000_000n;
    await fundAndApprove(buyer, BIG * U);
    await store.connect(buyer).buy(SHIELD, BIG);
    expect(await store.balanceOf(buyer.address, SHIELD)).to.equal(BIG);
    expect(await usdc.balanceOf(proceeds.address)).to.equal(BIG * U);
  });

  it("free gear (price 0) mints without pulling USDC", async function () {
    await store.registerGear(SWORD, 0n, "Starter Stick");
    await store.connect(buyer).buy(SWORD, 2n); // no approval needed
    expect(await store.balanceOf(buyer.address, SWORD)).to.equal(2n);
    expect(await usdc.balanceOf(proceeds.address)).to.equal(0n);
  });

  it("holder can burn their own gear", async function () {
    await store.registerGear(SWORD, 1n * U, "Iron Sword");
    await fundAndApprove(buyer, 3n * U);
    await store.connect(buyer).buy(SWORD, 3n);

    await store.connect(buyer).burn(buyer.address, SWORD, 2n);
    expect(await store.balanceOf(buyer.address, SWORD)).to.equal(1n);
  });

  it("a non-holder cannot burn someone else's gear without approval", async function () {
    await store.registerGear(SWORD, 1n * U, "Iron Sword");
    await fundAndApprove(buyer, 1n * U);
    await store.connect(buyer).buy(SWORD, 1n);
    await expect(store.connect(other).burn(buyer.address, SWORD, 1n)).to.be.reverted;
  });

  it("gameBurner can burnForLoss; a non-gameBurner cannot", async function () {
    await store.registerGear(SWORD, 1n * U, "Iron Sword");
    await fundAndApprove(buyer, 2n * U);
    await store.connect(buyer).buy(SWORD, 2n);

    // No gameBurner set yet → even owner cannot burnForLoss.
    await expect(store.burnForLoss(buyer.address, SWORD, 1n)).to.be.revertedWith("not game burner");

    await expect(store.setGameBurner(burner.address))
      .to.emit(store, "GameBurnerSet").withArgs(burner.address);

    // A random address still cannot.
    await expect(store.connect(other).burnForLoss(buyer.address, SWORD, 1n)).to.be.revertedWith("not game burner");

    // The gameBurner burns the player's lost gear.
    await expect(store.connect(burner).burnForLoss(buyer.address, SWORD, 1n))
      .to.emit(store, "GearBurnedForLoss").withArgs(buyer.address, SWORD, 1n);
    expect(await store.balanceOf(buyer.address, SWORD)).to.equal(1n);
  });

  it("non-owner cannot register, setPrice, setActive, setGameBurner, or setBaseURI", async function () {
    await store.registerGear(SWORD, 1n * U, "Iron Sword");
    await expect(store.connect(other).registerGear(SHIELD, 1n * U, "x")).to.be.reverted;
    await expect(store.connect(other).setPrice(SWORD, 2n * U)).to.be.reverted;
    await expect(store.connect(other).setActive(SWORD, false)).to.be.reverted;
    await expect(store.connect(other).setGameBurner(other.address)).to.be.reverted;
    await expect(store.connect(other).setBaseURI("http://evil/")).to.be.reverted;
  });

  it("owner setPrice changes the cost; setActive toggles buyability", async function () {
    await store.registerGear(SWORD, 5n * U, "Iron Sword");
    await store.setPrice(SWORD, 8n * U);
    expect((await store.gear(SWORD)).price).to.equal(8n * U);

    await fundAndApprove(buyer, 8n * U);
    await store.connect(buyer).buy(SWORD, 1n);
    expect(await usdc.balanceOf(proceeds.address)).to.equal(8n * U);
  });

  it("constructor rejects zero paymentToken / proceeds", async function () {
    const GearStore = await ethers.getContractFactory("GearStore1155", owner);
    await expect(GearStore.deploy(ethers.ZeroAddress, proceeds.address, BASE_URI)).to.be.revertedWith("zero paymentToken");
    await expect(GearStore.deploy(await usdc.getAddress(), ethers.ZeroAddress, BASE_URI)).to.be.revertedWith("zero proceeds");
  });

  it("proceeds is immutable and set to the impact sink at deploy", async function () {
    expect(await store.proceeds()).to.equal(proceeds.address);
    expect(await store.paymentToken()).to.equal(await usdc.getAddress());
  });
});
