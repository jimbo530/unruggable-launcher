// ============================================================
//  CharityVaultMorpho — local unit tests (no fork). Mocks the Morpho vault,
//  the meme token, and a V2-style router so we can prove BOTH:
//   - redemption honesty (illiquid redeem reverts clean, no leak), and
//   - the 3-way harvest split (web / cause / depositor) with honest reverts
//     when meme wiring is unset or a buy/add fails.
//  Run: npx hardhat test test/rh-charity-vault-unit.js
// ============================================================
const { expect } = require("chai");
const { ethers } = require("hardhat");

const U = (n) => ethers.parseUnits(n.toString(), 6);   // USDG / receipt (6 dec)
const M = (n) => ethers.parseUnits(n.toString(), 18);  // meme (18 dec)

describe("CharityVaultMorpho — honesty + 3-way split (mock)", function () {
  let usdg, meme, mock, router, vaultC, owner, user, charity, lpRec;

  beforeEach(async function () {
    [owner, user, charity, lpRec] = await ethers.getSigners();

    const MockUSDG = await ethers.getContractFactory("MockUSDG");
    usdg = await MockUSDG.deploy();
    const MockMeme = await ethers.getContractFactory("MockMeme");
    meme = await MockMeme.deploy();
    const Mock = await ethers.getContractFactory("MockMorphoVault");
    mock = await Mock.deploy(await usdg.getAddress());
    const MockRouter = await ethers.getContractFactory("MockRouter");
    router = await MockRouter.deploy(await usdg.getAddress(), await meme.getAddress());

    const Vault = await ethers.getContractFactory("CharityVaultMorpho");
    vaultC = await Vault.deploy(
      "Feeding People", "FTP",
      await usdg.getAddress(),
      await mock.getAddress(),
      charity.address,
      owner.address,
      "feeding people"
    );
    await vaultC.waitForDeployment();

    await usdg.mint(user.address, U(10000));
    await usdg.connect(user).approve(await vaultC.getAddress(), U(10000));
  });

  async function wireMeme() {
    await vaultC.connect(owner).setMemeWiring(await meme.getAddress(), await router.getAddress(), lpRec.address);
  }

  it("defaults to a 3333/3334/3333 split", async function () {
    expect(await vaultC.webBps()).to.equal(3333);
    expect(await vaultC.causeBps()).to.equal(3334);
    expect(await vaultC.depositorBps()).to.equal(3333);
    expect(await vaultC.memeWired()).to.equal(false);
  });

  it("deposit + redeem 1:1 when liquid", async function () {
    await vaultC.connect(user).deposit(U(1000));
    const before = await usdg.balanceOf(user.address);
    await vaultC.connect(user).redeem(U(1000));
    expect((await usdg.balanceOf(user.address)) - before).to.equal(U(1000));
    expect(await vaultC.totalSupply()).to.equal(0);
  });

  it("redeem reverts with the HONEST reason when the vault is illiquid", async function () {
    await vaultC.connect(user).deposit(U(1000));
    await mock.setLiquidityFrozen(true);
    await expect(vaultC.connect(user).redeem(U(500)))
      .to.be.revertedWith("insufficient vault liquidity - large redeems may queue, try smaller or retry later");
    // no leak: balance restored
    expect(await vaultC.balanceOf(user.address)).to.equal(U(1000));
  });

  it("harvest REVERTS honestly when meme wiring is unset", async function () {
    await vaultC.connect(user).deposit(U(1000));
    await mock.setSharePriceBps(11000); // ~100 USDG yield
    await expect(vaultC.harvest(M(1), M(1)))
      .to.be.revertedWith("meme wiring unset - cannot harvest until a meme LP + router exist");
  });

  it("3-way split: cause gets USDG, depositors get meme, web adds LP", async function () {
    await wireMeme();
    await vaultC.connect(user).deposit(U(1000));
    await mock.setSharePriceBps(11000); // backing ~1100 → ~100 USDG yield

    const pending = await vaultC.pendingYield();
    expect(pending).to.be.gt(U(90));

    const causeBefore = await usdg.balanceOf(charity.address);
    const lpBefore = await meme.balanceOf(lpRec.address);

    // minOut: rate is 1000 meme per USDG; leg-3 spends ~33 USDG → ~33k meme,
    // leg-1 buys with ~16 USDG → ~16k meme. Use small floors.
    await vaultC.connect(owner).harvest(M(1000), M(1000));

    // CAUSE leg (~1/3 of ~100 USDG) landed at charity as USDG
    const causeGot = (await usdg.balanceOf(charity.address)) - causeBefore;
    expect(causeGot).to.be.gt(U(30));
    expect(causeGot).to.be.lt(U(36));

    // WEB leg minted an LP receipt to lpRecipient
    expect((await meme.balanceOf(lpRec.address)) - lpBefore).to.be.gt(0);

    // DEPOSITOR leg credited the sole depositor with meme; they can claim it
    const pendingMeme = await vaultC.pendingMemeRewards(user.address);
    expect(pendingMeme).to.be.gt(M(30000)); // ~33 USDG * 1000
    const userMemeBefore = await meme.balanceOf(user.address);
    await vaultC.claimMeme(user.address);
    expect((await meme.balanceOf(user.address)) - userMemeBefore).to.equal(pendingMeme);
    expect(await vaultC.pendingMemeRewards(user.address)).to.equal(0);
  });

  it("harvest reverts honestly if the meme BUY fails (thin LP)", async function () {
    await wireMeme();
    await vaultC.connect(user).deposit(U(1000));
    await mock.setSharePriceBps(11000);
    await router.setSwapFrozen(true);
    await expect(vaultC.connect(owner).harvest(M(1000), M(1000)))
      .to.be.revertedWith("meme buy failed - no/thin meme LP or slippage; harvest reverted");
  });

  it("harvest reverts honestly if addLiquidity fails", async function () {
    await wireMeme();
    await vaultC.connect(user).deposit(U(1000));
    await mock.setSharePriceBps(11000);
    await router.setAddFrozen(true);
    await expect(vaultC.connect(owner).harvest(M(1000), M(1000)))
      .to.be.revertedWith("addLiquidity failed - meme LP venue issue; harvest reverted");
  });

  it("harvest reverts honestly if Morpho can't cover the yield withdrawal", async function () {
    await wireMeme();
    await vaultC.connect(user).deposit(U(1000));
    await mock.setSharePriceBps(11000);
    await mock.setLiquidityFrozen(true);
    await expect(vaultC.connect(owner).harvest(M(1000), M(1000)))
      .to.be.revertedWith("insufficient vault liquidity for harvest - retry later or harvest smaller");
  });

  it("rejects minOut=0 (no blind-slippage grief)", async function () {
    await wireMeme();
    await vaultC.connect(user).deposit(U(1000));
    await mock.setSharePriceBps(11000);
    // depositor leg runs first with minOut=0 → revert
    await expect(vaultC.connect(owner).harvest(M(1000), 0))
      .to.be.revertedWith("minOut=0 not allowed (set a real slippage bound)");
  });

  it("setSplit enforces sum==10000; owner-only", async function () {
    await expect(vaultC.connect(owner).setSplit(3000, 3000, 3000)).to.be.revertedWith("split must sum to 10000");
    await vaultC.connect(owner).setSplit(2000, 6000, 2000);
    expect(await vaultC.causeBps()).to.equal(6000);
    await expect(vaultC.connect(user).setSplit(3333, 3334, 3333)).to.be.revertedWith("not owner");
  });

  it("rejects a vault whose asset() != usdg at construction", async function () {
    const MockUSDG = await ethers.getContractFactory("MockUSDG");
    const otherToken = await MockUSDG.deploy();
    const Vault = await ethers.getContractFactory("CharityVaultMorpho");
    await expect(
      Vault.deploy("X", "X", await otherToken.getAddress(), await mock.getAddress(), charity.address, owner.address, "x")
    ).to.be.revertedWith("vault asset != usdg");
  });
});
