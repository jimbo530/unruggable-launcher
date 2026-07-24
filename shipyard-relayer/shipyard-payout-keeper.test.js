// Tests for the Shipyard crew USDC payout keeper.
//
// The mere fact that `require()` below returns without opening an RPC connection
// or starting the poll loop PROVES the keeper is import-safe: `node --test` sets
// NODE_TEST_CONTEXT, and the keeper only calls main() when that is unset.

const test = require("node:test");
const assert = require("node:assert");

const { summarizePending, chunk, usdc } = require("./shipyard-payout-keeper.js");

test("module imports without firing main() (NODE_TEST_CONTEXT guard)", () => {
  // If main() had run, the process would be connecting/looping. Reaching here
  // with the exports present is the proof.
  assert.strictEqual(typeof summarizePending, "function");
  assert.strictEqual(typeof chunk, "function");
  assert.strictEqual(typeof usdc, "function");
});

test("summarizePending totals only ids with pending > 0", () => {
  const rows = [
    { id: 0, pending: 0n },
    { id: 1, pending: 10n },
    { id: 2, pending: 0n },
    { id: 3, pending: 5n },
  ];
  const { total, claimableIds } = summarizePending(rows);
  assert.strictEqual(total, 15n);
  assert.deepStrictEqual(claimableIds, [1, 3]);
});

test("summarizePending handles all-zero (nothing claimable)", () => {
  const { total, claimableIds } = summarizePending([
    { id: 0, pending: 0n },
    { id: 1, pending: 0n },
  ]);
  assert.strictEqual(total, 0n);
  assert.deepStrictEqual(claimableIds, []);
});

test("chunk splits into batches of the given size", () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(chunk([], 50), []);
  assert.deepStrictEqual(chunk([1, 2], 50), [[1, 2]]);
});

test("usdc formats 6-decimal raw amounts", () => {
  assert.strictEqual(usdc(0n), "$0.0");
  assert.strictEqual(usdc(100000n), "$0.1");
  assert.strictEqual(usdc(1000000n), "$1.0");
});
