// ─────────────────────────────────────────────────────────────────────────
// END-TO-END FORK TEST — CharityLaunchpad (BEACON → The Solar Foundation)
//
// Run:  FORK_E2E=1 npx hardhat test test/e2e-fork-charity-launchpad.js
//
// Proves against REAL Base bytecode that:
//   1. CharityLaunchpad.launch() works on live state (real Uniswap V3, the live
//      Money/Meme pool, CharityFund.registerV3Position) — token + 2 pools + a V6
//      reactor wired to a CharityFeeRouter.
//   2. A real Money→BEACON swap generates fees; the keeper's execute() burns
//      BEACON, redeems the Money fee to USDC, and forwards it to the router.
//   3. flush() pays the USDC to The Solar Foundation's real Base address.
// ─────────────────────────────────────────────────────────────────────────

const { expect } = require("chai");
const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");

const MEME    = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3";
const MONEY   = "0xe3dd3881477c20C17Df080cEec0C1bD0C065A072";
const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const PM      = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const ROUTER  = "0x2626664c2603336E57B271c5C0b26F421741e481";
const UPSTREAM = "0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA";
// The Solar Foundation — verified Giveth Base recipient.
const SOLAR   = "0xB936d993379e5f52b6b8fdcDFA380508F037A420";
const DELAY   = 2 * 24 * 3600;

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const swapAbi = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
];

async function fundToken(tokenAddr, holder, amount, maxSlot = 60) {
  const t = new ethers.Contract(tokenAddr, erc20, ethers.provider);
  for (let slot = 0; slot < maxSlot; slot++) {
    const key = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holder, slot])
    );
    const before = await t.balanceOf(holder);
    await helpers.setStorageAt(tokenAddr, key, ethers.toBeHex(amount, 32));
    if ((await t.balanceOf(holder)) === BigInt(amount)) return slot;
    await helpers.setStorageAt(tokenAddr, key, ethers.toBeHex(before, 32));
  }
  throw new Error("balanceOf slot not found for " + tokenAddr);
}

const FORK = process.env.FORK_E2E === "1";

(FORK ? describe : describe.skip)("E2E fork — CharityLaunchpad: BEACON → Solar Foundation", function () {
  this.timeout(600000);

  let signer, trees, usdcAddr, pad, router, token, reactor;

  before(async function () {
    await ethers.provider.send("evm_mine", []);
    [signer, trees] = await ethers.getSigners();
    await helpers.setBalance(signer.address, ethers.parseEther("100"));

    const moneyView = new ethers.Contract(MONEY, ["function usdc() view returns (address)"], ethers.provider);
    usdcAddr = await moneyView.usdc();

    // Reuse a V6 impl (mirrors prod: the impl is deployed once, cloned per launch).
    const V6 = await ethers.getContractFactory("SporeReactorV6", signer);
    const impl = await V6.deploy(); await impl.waitForDeployment();

    // Find the live Money/Meme fee tier.
    const fc = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
    let moneyMemeFee = 0;
    for (const f of [100, 500, 3000, 10000]) {
      if ((await fc.getPool(MONEY, MEME, f)) !== ethers.ZeroAddress) { moneyMemeFee = f; break; }
    }
    expect(moneyMemeFee, "no live Money/Meme pool").to.be.greaterThan(0);

    // Deploy the factory.
    const Pad = await ethers.getContractFactory("CharityLaunchpad", signer);
    pad = await Pad.deploy(MEME, MONEY, usdcAddr, FACTORY, PM, ROUTER, await impl.getAddress(), UPSTREAM, moneyMemeFee);
    await pad.waitForDeployment();

    // Deploy BEACON's router → The Solar Foundation (trees fallback).
    const Router = await ethers.getContractFactory("CharityFeeRouter", signer);
    router = await Router.deploy(usdcAddr, trees.address, SOLAR, DELAY, signer.address);
    await router.waitForDeployment();

    // Launch BEACON (free launch — gas only). Heavy tx: explicit gas limit.
    const rcpt = await (await pad.launch("Beacon", "BEACON", await router.getAddress(), { gasLimit: 28_000_000 })).wait();
    const ev = rcpt.logs.map(l => { try { return pad.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "CharityTokenLaunched");
    expect(ev, "CharityTokenLaunched not emitted").to.not.be.null;
    token = ev.args.token;
    reactor = await ethers.getContractAt("SporeReactorV6", ev.args.reactor, signer);
    console.log("    BEACON token  :", token);
    console.log("    reactor       :", ev.args.reactor);
    console.log("    charity router:", ev.args.charityRouter);
  });

  it("launch wired the V6 reactor to BEACON's charity router with 2 pools", async function () {
    expect(await reactor.token()).to.equal(token);
    expect((await reactor.money()).toLowerCase()).to.equal(MONEY.toLowerCase());
    expect((await reactor.usdc()).toLowerCase()).to.equal(usdcAddr.toLowerCase());
    expect(await reactor.distributor()).to.equal(await router.getAddress());
    expect(await reactor.poolCount()).to.equal(2n);
  });

  it("router points at The Solar Foundation and nowhere else", async function () {
    expect(await router.beneficiary()).to.equal(SOLAR);
    const [dest, toTrees] = await router.destination();
    expect(dest).to.equal(SOLAR);
    expect(toTrees).to.equal(false);
  });

  it("CROWN JEWEL: a real swap → execute → flush pays USDC to Solar's real address", async function () {
    // Buy BEACON with Money to push price into the sell wall and accrue fees.
    const buyMoney = 5000n * 1_000_000n; // 5000 Money (6-dec)
    await fundToken(MONEY, signer.address, buyMoney);
    const money = new ethers.Contract(MONEY, erc20, signer);
    await (await money.approve(ROUTER, buyMoney)).wait();

    const swap = new ethers.Contract(ROUTER, swapAbi, signer);
    await (await swap.exactInputSingle({
      tokenIn: MONEY, tokenOut: token, fee: 10000, recipient: signer.address,
      amountIn: buyMoney, amountOutMinimum: 0, sqrtPriceLimitX96: 0,
    }, { gasLimit: 5_000_000 })).wait();

    // Fire the reactor: burns BEACON, redeems collected Money → USDC → router.
    await (await reactor.execute()).wait();

    const pendingUsdc = await router.pending();
    console.log("    USDC at router after execute:", pendingUsdc.toString());
    expect(pendingUsdc, "no USDC reached the router").to.be.greaterThan(0n);

    // Flush → Solar's real Base address receives the USDC.
    const usdc = new ethers.Contract(usdcAddr, erc20, ethers.provider);
    const solarBefore = await usdc.balanceOf(SOLAR);
    await (await router.flush()).wait();
    const gained = (await usdc.balanceOf(SOLAR)) - solarBefore;
    console.log("    USDC delivered to Solar Foundation:", gained.toString());
    expect(gained).to.equal(pendingUsdc);
    expect(await router.totalRouted()).to.equal(pendingUsdc);
  });
});
