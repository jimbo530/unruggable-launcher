const { expect } = require("chai");
const { ethers } = require("hardhat");

// PawnMarket — open multi-seller marketplace for ship crew NFTs (pawns).
// Crew NFT = a real FeeShareDistributor (mints 100 to the recipient in its ctor).
// usdc = MockUSDC (6-dec).

const U = 1_000_000n; // $1 (6-dec)

describe("PawnMarket — open pawn marketplace", function () {
  let usdc, crewA, crewB, market;
  let seller, seller2, alice, bob, dummyReactor;

  beforeEach(async function () {
    [seller, seller2, alice, bob, dummyReactor] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Two ships' crews (each mints 100 NFTs to its recipient/captain).
    const Crew = await ethers.getContractFactory("FeeShareDistributor");
    crewA = await Crew.deploy(await usdc.getAddress(), dummyReactor.address, seller.address,  "Black Tide Crew", "BTC", "u/");
    crewB = await Crew.deploy(await usdc.getAddress(), dummyReactor.address, seller2.address, "Kraken Crew",     "KRC", "u/");

    const Market = await ethers.getContractFactory("PawnMarket");
    market = await Market.deploy(await usdc.getAddress());

    // Each captain approves the market for their crew.
    await crewA.connect(seller).setApprovalForAll(await market.getAddress(), true);
    await crewB.connect(seller2).setApprovalForAll(await market.getAddress(), true);
  });

  const A = () => crewA.getAddress();

  it("captain lists pawns; a buyer pays USDC and the pawn + money move correctly", async function () {
    await market.connect(seller).list(await A(), 5, 2n * U); // pawn #5 for $2
    await usdc.mint(alice.address, 10n * U);
    await usdc.connect(alice).approve(await market.getAddress(), 2n * U);

    const sBefore = await usdc.balanceOf(seller.address);
    await expect(market.connect(alice).buy(await A(), 5))
      .to.emit(market, "Sold").withArgs(await A(), 5, alice.address, seller.address, 2n * U, false);

    expect(await crewA.ownerOf(5)).to.equal(alice.address);          // pawn → buyer
    expect((await usdc.balanceOf(seller.address)) - sBefore).to.equal(2n * U); // money → that captain
  });

  it("free pawn (price 0) is one per address per ship", async function () {
    await market.connect(seller).listMany(await A(), [10, 11], 0); // two free pawns
    await market.connect(alice).buy(await A(), 10);
    expect(await crewA.ownerOf(10)).to.equal(alice.address);
    expect(await market.claimedFree(await A(), alice.address)).to.equal(true);

    // same address can't grab a second free one from the same ship
    await expect(market.connect(alice).buy(await A(), 11)).to.be.revertedWith("already claimed a free pawn from this ship");
    // but a different address can
    await market.connect(bob).buy(await A(), 11);
    expect(await crewA.ownerOf(11)).to.equal(bob.address);
  });

  it("free is per-SHIP — claiming free on ship A doesn't block free on ship B", async function () {
    await market.connect(seller).list(await A(), 1, 0);
    await market.connect(seller2).list(await crewB.getAddress(), 1, 0);
    await market.connect(alice).buy(await A(), 1);
    await market.connect(alice).buy(await crewB.getAddress(), 1); // different ship, allowed
    expect(await crewA.ownerOf(1)).to.equal(alice.address);
    expect(await crewB.ownerOf(1)).to.equal(alice.address);
  });

  it("any captain can list + UNDERCUT — two ships, two prices, both buyable", async function () {
    await market.connect(seller).list(await A(), 20, 5n * U);                 // ship A: $5
    await market.connect(seller2).list(await crewB.getAddress(), 20, 1n * U); // ship B undercuts: $1
    await usdc.mint(bob.address, 10n * U);
    await usdc.connect(bob).approve(await market.getAddress(), 10n * U);

    await market.connect(bob).buy(await crewB.getAddress(), 20); // bob takes the cheaper one
    expect(await crewB.ownerOf(20)).to.equal(bob.address);
    expect(await usdc.balanceOf(seller2.address)).to.equal(1n * U);
  });

  it("seller can reprice + delist; only the seller can", async function () {
    await market.connect(seller).list(await A(), 30, 3n * U);
    await expect(market.connect(alice).setPrice(await A(), 30, U)).to.be.revertedWith("not seller");
    await market.connect(seller).setPrice(await A(), 30, U);
    await market.connect(seller).delist(await A(), 30);
    await usdc.mint(alice.address, U); await usdc.connect(alice).approve(await market.getAddress(), U);
    await expect(market.connect(alice).buy(await A(), 30)).to.be.revertedWith("not for sale");
  });

  it("can't list a pawn you don't own", async function () {
    await expect(market.connect(alice).list(await A(), 40, U)).to.be.revertedWith("not your pawn");
  });

  it("availability view reports listed + price", async function () {
    await market.connect(seller).list(await A(), 50, 4n * U);
    const [ok, prices] = await market.availability(await A(), [50, 51]);
    expect(ok[0]).to.equal(true); expect(prices[0]).to.equal(4n * U);
    expect(ok[1]).to.equal(false);
  });
});
