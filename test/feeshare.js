const { expect } = require("chai");
const { ethers } = require("hardhat");

// FeeShareDistributor unit tests.
// The reactor is mocked by a plain signer (reactorSigner) — the distributor
// only checks msg.sender == reactor and reads its own token balance, so an EOA
// "reactor" that transfers tokens in then calls notifyDeposit is sufficient.

describe("FeeShareDistributor", function () {
  let token, dist;
  let deployer, reactorSigner, launcher, alice, bob;

  const TOTAL = 100n;
  const PRECISION = 10n ** 18n;

  // Helper: reactor deposits `amount` (transfer in, then notifyDeposit).
  async function reactorDeposit(amount) {
    await token.mint(reactorSigner.address, amount);
    await token.connect(reactorSigner).transfer(await dist.getAddress(), amount);
    await dist.connect(reactorSigner).notifyDeposit(amount);
  }

  beforeEach(async function () {
    [deployer, reactorSigner, launcher, alice, bob] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Launch Token", "LT");
    await token.waitForDeployment();

    const FeeShareDistributor = await ethers.getContractFactory("FeeShareDistributor");
    dist = await FeeShareDistributor.deploy(
      await token.getAddress(),
      reactorSigner.address, // mock reactor
      launcher.address,
      "Launch Token Fee Share",
      "LTFEE",
      "https://crew.tasern.quest/crew/meta/" // baseURI
    );
    await dist.waitForDeployment();
  });

  it("mints exactly 100 NFTs (ids 0..99) to the launcher at launch", async function () {
    expect(await dist.balanceOf(launcher.address)).to.equal(100n);
    expect(await dist.ownerOf(0)).to.equal(launcher.address);
    expect(await dist.ownerOf(99)).to.equal(launcher.address);
    await expect(dist.ownerOf(100)).to.be.reverted; // no id 100
    expect(await dist.TOTAL_SHARES()).to.equal(100n);
  });

  it("a reactor deposit increases each NFT's pending by amount/100", async function () {
    const amount = 1000n * PRECISION; // 1000 tokens, divisible by 100
    await reactorDeposit(amount);

    const expectedPerNft = amount / TOTAL; // 10 tokens each
    expect(await dist.pending(0)).to.equal(expectedPerNft);
    expect(await dist.pending(50)).to.equal(expectedPerNft);
    expect(await dist.pending(99)).to.equal(expectedPerNft);
  });

  it("claim() pays the owner and zeroes pending", async function () {
    const amount = 1000n * PRECISION;
    await reactorDeposit(amount);

    const perNft = amount / TOTAL;
    const before = await token.balanceOf(launcher.address);

    await dist.connect(alice).claim(7); // anyone can trigger, owner gets paid
    const after = await token.balanceOf(launcher.address);

    expect(after - before).to.equal(perNft);
    expect(await dist.pending(7)).to.equal(0n);

    // Other unclaimed NFTs unaffected
    expect(await dist.pending(8)).to.equal(perNft);
  });

  it("claimAll pays the owner for several NFTs at once", async function () {
    const amount = 1000n * PRECISION;
    await reactorDeposit(amount);
    const perNft = amount / TOTAL;

    const before = await token.balanceOf(launcher.address);
    await dist.connect(launcher).claimAll([0, 1, 2, 3, 4]);
    const after = await token.balanceOf(launcher.address);

    expect(after - before).to.equal(perNft * 5n);
    for (const id of [0, 1, 2, 3, 4]) {
      expect(await dist.pending(id)).to.equal(0n);
    }
  });

  it("transfer preserves the SELLER's earned share (escrow); BUYER only earns future deposits", async function () {
    const amount = 1000n * PRECISION;
    await reactorDeposit(amount);
    const perNft = amount / TOTAL; // earned by id 0 before transfer

    // Launcher (seller) transfers NFT 0 to bob (buyer) WITHOUT claiming first.
    await dist.connect(launcher).transferFrom(launcher.address, bob.address, 0);

    // Seller's pre-transfer earnings settled to escrow.
    expect(await dist.escrow(launcher.address)).to.equal(perNft);
    // Buyer starts with zero pending on the bought NFT.
    expect(await dist.pending(0)).to.equal(0n);
    expect(await dist.ownerOf(0)).to.equal(bob.address);

    // Seller can withdraw the escrowed pre-transfer earnings.
    const sBefore = await token.balanceOf(launcher.address);
    await dist.connect(launcher).withdrawEscrow();
    const sAfter = await token.balanceOf(launcher.address);
    expect(sAfter - sBefore).to.equal(perNft);
    expect(await dist.escrow(launcher.address)).to.equal(0n);

    // A NEW deposit: buyer now earns on NFT 0, seller earns nothing more on it.
    await reactorDeposit(amount);
    expect(await dist.pending(0)).to.equal(perNft); // buyer's future share

    const bBefore = await token.balanceOf(bob.address);
    await dist.connect(bob).claim(0);
    const bAfter = await token.balanceOf(bob.address);
    expect(bAfter - bBefore).to.equal(perNft);
  });

  it("notifyDeposit reverts when called by non-reactor", async function () {
    await token.mint(await dist.getAddress(), 100n * PRECISION);
    await expect(dist.connect(alice).notifyDeposit(100n * PRECISION)).to.be.revertedWith("not reactor");
    await expect(dist.connect(launcher).notifyDeposit(100n * PRECISION)).to.be.revertedWith("not reactor");
  });

  it("notifyDeposit measures REAL balance delta, ignoring the reported amount", async function () {
    // Transfer in 500 tokens but lie and report 999999 — only the real 500 counts.
    const real = 500n * PRECISION;
    await token.mint(reactorSigner.address, real);
    await token.connect(reactorSigner).transfer(await dist.getAddress(), real);
    await dist.connect(reactorSigner).notifyDeposit(99999999n * PRECISION);

    expect(await dist.pending(0)).to.equal(real / TOTAL);
  });

  it("rounding dust from /100 stays in the contract", async function () {
    // 100*PRECISION + 57 wei: per-NFT = (amount*1e18/100)/1e18 floored.
    const amount = 100n * PRECISION + 57n;
    await reactorDeposit(amount);

    // accPerShare = amount*1e18/100; pending per NFT = that /1e18 = floor(amount/100)
    const perNft = amount / TOTAL; // floor
    expect(await dist.pending(0)).to.equal(perNft);

    // Claim all 100 and confirm leftover dust remains in contract.
    const ids = Array.from({ length: 100 }, (_, i) => i);
    await dist.connect(launcher).claimAll(ids);

    const leftover = await token.balanceOf(await dist.getAddress());
    expect(leftover).to.equal(amount - perNft * 100n); // the 57-wei-ish dust
    expect(leftover).to.be.greaterThan(0n);
  });

  it("multiple sequential deposits accumulate correctly", async function () {
    const a = 300n * PRECISION;
    const b = 700n * PRECISION;
    await reactorDeposit(a);
    await reactorDeposit(b);

    const perNft = (a + b) / TOTAL;
    expect(await dist.pending(0)).to.equal(perNft);

    const before = await token.balanceOf(launcher.address);
    await dist.connect(launcher).claim(0);
    const after = await token.balanceOf(launcher.address);
    expect(after - before).to.equal(perNft);
  });

  // ── Metadata (dynamic crew paper-doll resolution) ──────────────────────────
  describe("tokenURI / baseURI", function () {
    const BASE = "https://crew.tasern.quest/crew/meta/";

    it("tokenURI(id) returns `baseURI + <distributor>:<id>` (lowercased address)", async function () {
      const distAddr = (await dist.getAddress()).toLowerCase();
      expect(await dist.tokenURI(0)).to.equal(BASE + distAddr + ":0");
      expect(await dist.tokenURI(7)).to.equal(BASE + distAddr + ":7");
      expect(await dist.tokenURI(99)).to.equal(BASE + distAddr + ":99");
    });

    it("tokenURI reverts for a nonexistent id", async function () {
      await expect(dist.tokenURI(100)).to.be.reverted; // only ids 0..99 exist
    });

    it("setBaseURI is launcher-gated and updates tokenURI output", async function () {
      // non-launcher cannot move the metadata host
      await expect(dist.connect(alice).setBaseURI("https://evil/")).to.be.revertedWith("not launcher");

      const NEW = "https://crew2.tasern.quest/m/";
      await expect(dist.connect(launcher).setBaseURI(NEW))
        .to.emit(dist, "BaseURISet").withArgs(NEW);

      const distAddr = (await dist.getAddress()).toLowerCase();
      expect(await dist.baseURI()).to.equal(NEW);
      expect(await dist.tokenURI(3)).to.equal(NEW + distAddr + ":3");
    });

    it("baseURI is display-only — moving it never changes fee-share accounting", async function () {
      const amount = 1000n * PRECISION;
      await reactorDeposit(amount);
      const perNft = amount / TOTAL;
      // move the metadata host
      await dist.connect(launcher).setBaseURI("https://wherever/");
      // accounting is untouched
      expect(await dist.pending(0)).to.equal(perNft);
      const before = await token.balanceOf(launcher.address);
      await dist.connect(launcher).claim(0);
      expect((await token.balanceOf(launcher.address)) - before).to.equal(perNft);
    });
  });
});
