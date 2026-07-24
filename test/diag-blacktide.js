// ─────────────────────────────────────────────────────────────────────────
// DIAGNOSIS + FIX PROOF — the "first launch reverts" incident (2026-06-23).
//
// Run:  FORK_E2E=1 FORK_BLOCK=<recent> npx hardhat test test/diag-blacktide.js
//
// FINDING: the live Dock.fulfill(0) does NOT have a logic/state bug. It reverts
// only because of a GAS CLIFF: the buy-in's nested `try this.executeBuyIn{63/64
// gas}()` self-call makes fulfill revert below ~17.2M gas, so `eth_estimateGas`
// (binary search) reverts — but a FIXED gasLimit above the cliff SUCCEEDS.
//
// This test reproduces both halves on a fresh snapshot each time:
//   - estimateGas(fulfill(0)) → reverts (the symptom the keeper hit)
//   - fulfill(0) at a fixed gas BELOW the cliff → reverts
//   - fulfill(0) at the keeper's fixed FULFILL_GAS (24M) → SUCCEEDS (the fix)
// ─────────────────────────────────────────────────────────────────────────

const { expect } = require("chai");
const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");

const DOCK = "0x5A9185666551012B1ef381dA4cA309599AdF85D4";
const FULFILL_GAS = 24_000_000n; // the keeper's fixed gas (above the cliff)
const FORK = process.env.FORK_E2E === "1";

(FORK ? describe : describe.skip)("DIAG — Black Tide fulfill gas-cliff", function () {
  this.timeout(600000);

  let dock, relayer;

  before(async function () {
    await ethers.provider.send("evm_mine", []);
    [relayer] = await ethers.getSigners();
    await helpers.setBalance(relayer.address, ethers.parseEther("100"));
    dock = new ethers.Contract(
      DOCK,
      [
        "function fulfill(uint256 id)",
        "function requests(uint256) view returns (address,string,string,address,uint256,bool,uint256)",
      ],
      relayer
    );
    const r = await dock.requests(0);
    console.log("    request[0]: name=%s symbol=%s fulfilled=%s", r[1], r[2], r[5]);
  });

  it("SYMPTOM (informational): estimateGas behavior near the cliff", async function () {
    // NOTE: the LIVE Alchemy eth_estimateGas REVERTS ("execution reverted",
    // verified via raw RPC) because its binary search probes below the ~17.2M
    // gas cliff. Hardhat's local estimator uses a different search and may return
    // a value instead — so this is reported, not asserted. The load-bearing proof
    // is the two tests below (below-cliff reverts, fixed-24M succeeds).
    const snap = await helpers.takeSnapshot();
    try {
      const est = await dock.fulfill.estimateGas(0);
      console.log("    hardhat estimateGas =", est.toString(), "(live Alchemy estimateGas REVERTS — that's the keeper symptom)");
    } catch (e) {
      console.log("    estimateGas reverted (matches live):", (e.shortMessage || e.message || "").slice(0, 70));
    }
    await snap.restore();
  });

  it("SYMPTOM: a gas limit BELOW the cliff reverts (17M)", async function () {
    const snap = await helpers.takeSnapshot();
    let reverted = false;
    try { const tx = await dock.fulfill(0, { gasLimit: 17_000_000 }); await tx.wait(); }
    catch (e) { reverted = true; }
    await snap.restore();
    expect(reverted, "fulfill should revert below the ~17.2M cliff").to.equal(true);
  });

  it("FIX: a FIXED gas limit ABOVE the cliff (keeper's 24M) SUCCEEDS", async function () {
    const snap = await helpers.takeSnapshot();
    const tx = await dock.fulfill(0, { gasLimit: FULFILL_GAS });
    const rcpt = await tx.wait();
    console.log("    fulfill(0) @24M gas → status=%s gasUsed=%s", rcpt.status, rcpt.gasUsed.toString());
    expect(rcpt.status).to.equal(1);
    expect(rcpt.gasUsed).to.be.lessThan(FULFILL_GAS); // real usage well under the limit
    await snap.restore();
  });
});
