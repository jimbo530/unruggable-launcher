const { expect } = require("chai");
const { ethers } = require("hardhat");

// Lightweight wiring tests for SporeReactorV5.setDistributor.
// We don't exercise the full processPool path here (that needs Uniswap V3
// infra and belongs in a fork test). We verify the new V5-only surface:
// distributor is admin-gated and settable exactly once.

describe("SporeReactorV5 — distributor wiring", function () {
  let reactor, admin, other, dummyA, dummyB;

  beforeEach(async function () {
    [admin, other, dummyA, dummyB] = await ethers.getSigners();

    const Reactor = await ethers.getContractFactory("SporeReactorV5");
    reactor = await Reactor.deploy();
    await reactor.waitForDeployment();

    // initialize with non-zero placeholder addresses (admin = deployer/admin).
    // token != mft is the only relational constraint enforced.
    await reactor.initialize(
      dummyA.address, // token
      dummyB.address, // mft
      dummyA.address, // pm
      dummyA.address, // router
      dummyA.address, // factory
      dummyA.address, // upstreamReactor
      other.address   // launcher
    );
  });

  it("admin can set the distributor once", async function () {
    expect(await reactor.distributor()).to.equal(ethers.ZeroAddress);
    await expect(reactor.setDistributor(dummyB.address))
      .to.emit(reactor, "DistributorSet")
      .withArgs(dummyB.address);
    expect(await reactor.distributor()).to.equal(dummyB.address);
  });

  it("non-admin cannot set the distributor", async function () {
    await expect(
      reactor.connect(other).setDistributor(dummyB.address)
    ).to.be.revertedWith("not admin");
  });

  it("distributor cannot be set twice", async function () {
    await reactor.setDistributor(dummyB.address);
    await expect(
      reactor.setDistributor(dummyA.address)
    ).to.be.revertedWith("distributor already set");
  });

  it("distributor cannot be set to the zero address", async function () {
    await expect(
      reactor.setDistributor(ethers.ZeroAddress)
    ).to.be.revertedWith("zero distributor");
  });
});
