// ─────────────────────────────────────────────────────────────────────────
// END-TO-END FORK TEST — Base mainnet (read-only fork, NO live broadcast)
//
// Run with:  FORK_E2E=1 npx hardhat test test/e2e-fork-v9.js
//
// Proves, against REAL Base bytecode at pinned block 47510000:
//   P1 (GATE): the real Money contract's redemption converts Money -> USDC when
//              called by the holder (the reactor). Records the function name and
//              the rate.
//   P2:        a full MycoPadV9 launch wires token + 2 pools + V6 reactor +
//              FeeShareDistributor (100 NFTs to launcher) + reactor.distributor.
//   P3:        real Money dealt to the reactor is redeemed THROUGH the reactor's
//              own execute() to USDC, forwarded to the distributor, and claimable.
//
// KEY EMPIRICAL FINDING (P1): the live Money uses redeem(uint256), NOT
// withdraw(uint256). SporeReactorV6 has been corrected to call redeem(uint256)
// (verified-on-fork). P3 now drives the AS-BUILT reactor's own execute() against
// the real Money and asserts NO RedeemFailed, USDC lands in the distributor,
// pending == usdcDelta/100, and claim() pays USDC.
// ─────────────────────────────────────────────────────────────────────────

const { expect } = require("chai");
const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");

// Real Base addresses (verbatim from deploy/deploy-v7.js — verified below).
const MEME    = "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3"; // MfT 18dec
const MONEY   = "0xe3dd3881477c20C17Df080cEec0C1bD0C065A072"; // 6dec
const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const PM      = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const ROUTER  = "0x2626664c2603336E57B271c5C0b26F421741e481";
const UPSTREAM = "0xA97af9770B79C3f0467ec8b3AD7e464154dbc9BA";
const USDC_LITERAL = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Fund a holder with an ERC20 by locating its balanceOf storage slot
// (solidity mapping at slot N: key = keccak256(abi.encode(holder, N))).
async function fundToken(tokenAddr, holder, amount, maxSlot = 40) {
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

// Fund a holder with USDC (Base USDC balanceOf is slot 9).
async function fundUSDC(usdcAddr, holder, amount) {
  return fundToken(usdcAddr, holder, amount);
}

// Mint real Money to `holder` by funding USDC then depositing into Money.
async function mintMoney(signer, usdcAddr, amount) {
  const usdc = new ethers.Contract(usdcAddr, erc20, signer);
  const money = new ethers.Contract(MONEY, [
    "function deposit(uint256 amount)",
    "function balanceOf(address) view returns (uint256)",
  ], signer);
  await fundUSDC(usdcAddr, signer.address, amount);
  await usdc.approve(MONEY, amount);
  await (await money.deposit(amount)).wait();
  return await money.balanceOf(signer.address);
}

// Fork-only: requires FORK_E2E=1 (wires networks.hardhat.forking). When the flag
// is absent the default `npx hardhat test` runs against a non-forked local node
// where the real Base addresses don't exist — so we skip cleanly instead of
// failing. Run with: FORK_E2E=1 npx hardhat test test/e2e-fork-v9.js
const FORK = process.env.FORK_E2E === "1";

(FORK ? describe : describe.skip)("E2E fork — MycoPadV9 / SporeReactorV6 vs REAL Money", function () {
  this.timeout(600000);

  let signer, usdcAddr;

  before(async function () {
    await ethers.provider.send("evm_mine", []); // advance past the fork block
    [signer] = await ethers.getSigners();
    await helpers.setBalance(signer.address, ethers.parseEther("100"));
    // Read USDC straight off the Money contract — do NOT trust the literal.
    const moneyView = new ethers.Contract(MONEY, ["function usdc() view returns (address)"], ethers.provider);
    usdcAddr = await moneyView.usdc();
  });

  // ── PRIORITY 1 — THE GATE ────────────────────────────────────────────────
  describe("P1 — Money redemption gate (real bytecode)", function () {
    it("Money.usdc() IS the real Base USDC", async function () {
      expect(usdcAddr.toLowerCase()).to.equal(USDC_LITERAL.toLowerCase());
      const u = new ethers.Contract(usdcAddr, erc20, ethers.provider);
      expect(await u.symbol()).to.equal("USDC");
      console.log("    Money.usdc() =", usdcAddr, "(USDC) — confirmed");
    });

    it("deposit(uint256) mints Money 1:1 from USDC", async function () {
      const amount = 1_000_000n; // 1 USDC
      const moneyBal = await mintMoney(signer, usdcAddr, amount);
      expect(moneyBal).to.equal(amount); // 1:1
      console.log("    deposit(1 USDC) -> Money:", moneyBal.toString(), "(1:1)");
    });

    it("the REAL redemption function is redeem(uint256), and withdraw(uint256) is NOT it", async function () {
      const amount = 2_000_000n; // 2 USDC -> 2 Money
      await mintMoney(signer, usdcAddr, amount);

      const usdc = new ethers.Contract(usdcAddr, erc20, signer);

      // (a) withdraw(uint256): the selector the SporeReactorV6 spec ASSUMED.
      const moneyWithdraw = new ethers.Contract(MONEY, ["function withdraw(uint256)"], signer);
      let withdrawWorks = false;
      try {
        await (await moneyWithdraw.withdraw(1_000_000n)).wait();
        withdrawWorks = true;
      } catch (e) {
        console.log("    withdraw(uint256) ->", (e.shortMessage || e.message).slice(0, 60));
      }
      expect(withdrawWorks, "withdraw(uint256) unexpectedly worked").to.equal(false);

      // (b) redeem(uint256): the REAL function — must deliver USDC 1:1.
      const moneyRedeem = new ethers.Contract(MONEY, [
        "function redeem(uint256)",
        "function balanceOf(address) view returns (uint256)",
      ], signer);
      const moneyBal = await moneyRedeem.balanceOf(signer.address);
      const usdcBefore = await usdc.balanceOf(signer.address);
      await (await moneyRedeem.redeem(moneyBal)).wait();
      const usdcDelta = (await usdc.balanceOf(signer.address)) - usdcBefore;

      expect(usdcDelta).to.equal(moneyBal); // 1:1
      expect(await moneyRedeem.balanceOf(signer.address)).to.equal(0n);
      console.log("    redeem(", moneyBal.toString(), "Money) -> USDC delta:", usdcDelta.toString(), "(1:1) — GATE PASSES via redeem()");
    });
  });

  // ── PRIORITY 2 — full V9 launch ──────────────────────────────────────────
  describe("P2 — full MycoPadV9 launch on the fork", function () {
    let factory, reactorImpl, token, reactor, dist;

    it("deploys V6 impl + MycoPadV9 and launches a token", async function () {
      const V6 = await ethers.getContractFactory("SporeReactorV6", signer);
      reactorImpl = await V6.deploy();
      await reactorImpl.waitForDeployment();

      const V9 = await ethers.getContractFactory("UnrugableV9", signer);
      // moneyMemeFee: the fee tier of the live Money/Meme V3 pool. Discover it.
      const fc = new ethers.Contract(FACTORY, [
        "function getPool(address,address,uint24) view returns (address)"
      ], ethers.provider);
      let moneyMemeFee = 0;
      for (const f of [100, 500, 3000, 10000]) {
        const p = await fc.getPool(MONEY, MEME, f);
        if (p !== ethers.ZeroAddress) { moneyMemeFee = f; break; }
      }
      expect(moneyMemeFee, "no live Money/Meme pool found").to.be.greaterThan(0);
      console.log("    Money/Meme pool fee tier:", moneyMemeFee);

      factory = await V9.deploy(
        MEME, MONEY, usdcAddr, FACTORY, PM, ROUTER,
        await reactorImpl.getAddress(), UPSTREAM, moneyMemeFee
      );
      await factory.waitForDeployment();

      const tx = await factory.launch("ForkTest", "FORK", ethers.ZeroAddress);
      const rcpt = await tx.wait();

      // Pull launched addresses from TokenLaunched event.
      const ev = rcpt.logs
        .map(l => { try { return factory.interface.parseLog(l); } catch { return null; } })
        .find(e => e && e.name === "TokenLaunched");
      expect(ev, "TokenLaunched not emitted").to.not.be.null;

      const tokenAddr = ev.args.token;
      const reactorAddr = ev.args.reactor;
      const distAddr = ev.args.distributor;
      console.log("    token:", tokenAddr);
      console.log("    reactor:", reactorAddr);
      console.log("    distributor:", distAddr);

      token = new ethers.Contract(tokenAddr, erc20, ethers.provider);
      reactor = await ethers.getContractAt("SporeReactorV6", reactorAddr, signer);
      dist = await ethers.getContractAt("FeeShareDistributor", distAddr, signer);

      // Assertions
      expect((await ethers.provider.getCode(tokenAddr)).length).to.be.greaterThan(2);
      expect(await reactor.poolCount()).to.equal(2n);
      expect(await reactor.distributor()).to.equal(distAddr);
      expect(await reactor.token()).to.equal(tokenAddr);
      expect(await reactor.money()).to.equal(MONEY);
      expect(await reactor.usdc()).to.equal(usdcAddr);

      // distributor: 100 NFTs to launcher (signer)
      expect(await dist.balanceOf(signer.address)).to.equal(100n);
      expect(await dist.ownerOf(0)).to.equal(signer.address);
      expect(await dist.ownerOf(99)).to.equal(signer.address);
      expect(await dist.token()).to.equal(usdcAddr); // payout = USDC

      // reactor owns both position NFTs (verified via pool struct tokenIds)
      const pmC = new ethers.Contract(PM, ["function ownerOf(uint256) view returns (address)"], ethers.provider);
      const p0 = await reactor.pools(0);
      const p1 = await reactor.pools(1);
      expect(await pmC.ownerOf(p0.tokenId)).to.equal(reactorAddr);
      expect(await pmC.ownerOf(p1.tokenId)).to.equal(reactorAddr);
      console.log("    both V3 position NFTs owned by reactor; 100 fee-share NFTs to launcher");
    });
  });

  // ── PRIORITY 3 — real redeem THROUGH the reactor ─────────────────────────
  describe("P3 — Money dealt to reactor, redeemed through its branch", function () {
    let token, reactor, dist, moneyMemeFee;

    async function freshLaunch() {
      const V6 = await ethers.getContractFactory("SporeReactorV6", signer);
      const impl = await V6.deploy(); await impl.waitForDeployment();
      const V9 = await ethers.getContractFactory("UnrugableV9", signer);
      const fc = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
      moneyMemeFee = 0;
      for (const f of [100, 500, 3000, 10000]) {
        const p = await fc.getPool(MONEY, MEME, f);
        if (p !== ethers.ZeroAddress) { moneyMemeFee = f; break; }
      }
      const fac = await V9.deploy(MEME, MONEY, usdcAddr, FACTORY, PM, ROUTER, await impl.getAddress(), UPSTREAM, moneyMemeFee);
      await fac.waitForDeployment();
      const rcpt = await (await fac.launch("ForkP3", "FP3", ethers.ZeroAddress)).wait();
      const ev = rcpt.logs.map(l => { try { return fac.interface.parseLog(l); } catch { return null; } }).find(e => e && e.name === "TokenLaunched");
      return {
        token: new ethers.Contract(ev.args.token, erc20, ethers.provider),
        reactor: await ethers.getContractAt("SporeReactorV6", ev.args.reactor, signer),
        dist: await ethers.getContractAt("FeeShareDistributor", ev.args.distributor, signer),
      };
    }

    it("AS-BUILT reactor redeems real Money through execute(): USDC -> distributor -> claim, NO RedeemFailed", async function () {
      ({ token, reactor, dist } = await freshLaunch());

      const distAddr = await dist.getAddress();
      const reactorAddr = await reactor.getAddress();

      // Deal real Money directly to the launched reactor (simulates the Money
      // fees it would hold after collect()). The reactor's OWN execute() must
      // call the real Money.redeem(), receive USDC, forward to the distributor,
      // and notifyDeposit — entirely inside its corrected redeem branch.
      const moneyAmt = 1_000_000n; // 1 Money
      const m = await mintMoney(signer, usdcAddr, moneyAmt);
      const money = new ethers.Contract(MONEY, erc20, signer);
      await (await money.transfer(reactorAddr, m)).wait();

      const usdc = new ethers.Contract(usdcAddr, erc20, ethers.provider);
      const distUsdcBefore = await usdc.balanceOf(distAddr);

      // Fire the reactor itself.
      const rcpt = await (await reactor.execute()).wait();
      const names = rcpt.logs
        .map(l => { try { return reactor.interface.parseLog(l).name; } catch { return null; } })
        .filter(Boolean);
      console.log("    reactor events:", names.join(", "));

      // The corrected selector must NOT hit the failure branches.
      expect(names, "RedeemFailed should not fire").to.not.include("RedeemFailed");
      expect(names, "RedeemZero should not fire").to.not.include("RedeemZero");
      expect(names).to.include("MoneyRedeemed");
      expect(names).to.include("DistributorFunded");

      // USDC delta from the redemption landed in the distributor (1:1).
      const usdcDelta = (await usdc.balanceOf(distAddr)) - distUsdcBefore;
      expect(usdcDelta).to.equal(m);
      // Money never leaked: reactor holds zero Money, distributor holds zero Money.
      const moneyView = new ethers.Contract(MONEY, erc20, ethers.provider);
      expect(await moneyView.balanceOf(reactorAddr)).to.equal(0n);
      expect(await moneyView.balanceOf(distAddr)).to.equal(0n);

      // pending == usdcDelta/100 for every NFT.
      const perNft = usdcDelta / 100n;
      expect(await dist.pending(0)).to.equal(perNft);
      expect(await dist.pending(99)).to.equal(perNft);

      // claim() pays USDC to the NFT owner (launcher == signer).
      const ownerBefore = await usdc.balanceOf(signer.address);
      await (await dist.claim(0)).wait();
      const paid = (await usdc.balanceOf(signer.address)) - ownerBefore;
      expect(paid).to.equal(perNft);
      expect(await dist.pending(0)).to.equal(0n);
      console.log("    AS-BUILT reactor.execute() redeemed real Money -> USDC -> distributor -> claim. per-NFT USDC:", perNft.toString());
    });
  });

  // ── PRIORITY 4 — Meme side is LP-ONLY (no upstream fuel) ──────────────────
  describe("P4 — Meme branch deepens LP with NO fuel routing", function () {
    async function freshLaunch(name, sym) {
      const V6 = await ethers.getContractFactory("SporeReactorV6", signer);
      const impl = await V6.deploy(); await impl.waitForDeployment();
      const V9 = await ethers.getContractFactory("UnrugableV9", signer);
      const fc = new ethers.Contract(FACTORY, ["function getPool(address,address,uint24) view returns (address)"], ethers.provider);
      let fee = 0;
      for (const f of [100, 500, 3000, 10000]) {
        if ((await fc.getPool(MONEY, MEME, f)) !== ethers.ZeroAddress) { fee = f; break; }
      }
      const fac = await V9.deploy(MEME, MONEY, usdcAddr, FACTORY, PM, ROUTER, await impl.getAddress(), UPSTREAM, fee);
      await fac.waitForDeployment();
      const rcpt = await (await fac.launch(name, sym, ethers.ZeroAddress)).wait();
      const ev = rcpt.logs.map(l => { try { return fac.interface.parseLog(l); } catch { return null; } }).find(e => e && e.name === "TokenLaunched");
      return {
        tokenAddr: ev.args.token,
        reactor: await ethers.getContractAt("SporeReactorV6", ev.args.reactor, signer),
      };
    }

    it("dealt MfT fees deepen the TOKEN/Meme LP; no FuelSent/FuelFailed/Fueled; Executed.fueled == 0; LP principal never reduced", async function () {
      const { tokenAddr, reactor } = await freshLaunch("ForkP4", "FP4");
      const reactorAddr = await reactor.getAddress();

      // Identify the Meme pool (xToken == MEME) and its position tokenId.
      let memeIdx = -1, memePos;
      const n = await reactor.poolCount();
      for (let i = 0n; i < n; i++) {
        const p = await reactor.pools(i);
        if (p.xToken.toLowerCase() === MEME.toLowerCase()) { memeIdx = Number(i); memePos = p; }
      }
      expect(memeIdx, "no Meme pool on reactor").to.be.greaterThan(-1);

      const pmLiq = new ethers.Contract(PM, [
        "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)"
      ], ethers.provider);
      const liqBefore = (await pmLiq.positions(memePos.tokenId))[7];

      // Deal real MfT directly to the reactor (simulates collected Meme fees).
      const memeAmt = ethers.parseEther("50"); // 50 MfT (18dec)
      await fundToken(MEME, reactorAddr, memeAmt);
      const meme = new ethers.Contract(MEME, erc20, ethers.provider);
      expect(await meme.balanceOf(reactorAddr)).to.equal(memeAmt);

      // Record the upstream reactor's MfT BEFORE — it must NOT change (no fuel).
      const upstreamMemeBefore = await meme.balanceOf(UPSTREAM);

      // Fire the reactor.
      const rcpt = await (await reactor.execute()).wait();
      const parsed = rcpt.logs
        .map(l => { try { return reactor.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean);
      const names = parsed.map(e => e.name);
      console.log("    reactor events:", names.join(", "));

      // LP-ONLY invariant: no fuel/upstream routing whatsoever.
      expect(names, "FuelSent must not fire").to.not.include("FuelSent");
      expect(names, "FuelFailed must not fire").to.not.include("FuelFailed");
      expect(names, "Fueled must not fire").to.not.include("Fueled");

      // Executed.fueled (4th arg) must be 0.
      const executed = parsed.find(e => e.name === "Executed");
      expect(executed, "Executed not emitted").to.not.be.undefined;
      expect(executed.args.fueled).to.equal(0n);

      // The Meme position liquidity INCREASED (LP deepened), never decreased.
      const liqAfter = (await pmLiq.positions(memePos.tokenId))[7];
      expect(liqAfter).to.be.greaterThan(liqBefore);

      // NO MfT was routed to the upstream reactor (fuel diversion is gone).
      expect(await meme.balanceOf(UPSTREAM)).to.equal(upstreamMemeBefore);

      // The reactor swapped the buy-half MfT into TOKEN (its MfT dropped by at
      // least ~half). The remainder is the un-deposited LP side of a single-sided
      // wall (geometry, not fuel) and stays in the reactor for the next deepen —
      // it is NOT diverted anywhere.
      const memeLeft = await meme.balanceOf(reactorAddr);
      expect(memeLeft).to.be.lessThanOrEqual(memeAmt / 2n);

      console.log("    Meme LP deepened: liquidity", liqBefore.toString(), "->", liqAfter.toString(),
        "| fueled=0, no fuel events, upstream MfT unchanged, MfT left in reactor:", memeLeft.toString());
    });
  });
});
