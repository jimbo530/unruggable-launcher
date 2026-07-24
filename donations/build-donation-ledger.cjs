#!/usr/bin/env node
/**
 * build-donation-ledger.cjs
 * -------------------------------------------------------------------------
 * Builds a permanent, auditable donation ledger from ON-CHAIN data (Base, 8453)
 * for the Meme-for-Trees charitable giving. Read-only. No keys, no transactions.
 *
 * SCOPE (per founder, 2026-07-15):
 *   - Base ONLY.
 *   - TREES is the ONLY external charity we actually send funds to.
 *   - Single recipient: TreeGens / Jimi Cohen (jimicohen.eth)
 *       0xfC9265A28f66CF4561D74A4E25D7Bbd3F482B8e6
 *   - Pull ALL incoming ERC20 + native ETH to that recipient, then LABEL the source:
 *       * from our OPS wallet / TREASURY / a Money CharityFund clone => "ours" (a donation)
 *       * from anyone else                                           => "external" (kept, flagged, excluded from OUR totals)
 *
 * DATA SOURCE: keyless Blockscout API (https://base.blockscout.com/api).
 *   - action=tokentx  -> incoming ERC20 transfers
 *   - action=txlist   -> native ETH transfers (value>0, to==recipient, isError==0)
 *   Both are paginated defensively (loop pages until a short/empty page).
 *
 * USD VALUATION: only stamped where it is TRUSTLESS.
 *   - USDC / USDbC (6-dec, $1 pegged dollars we send) => amount is the USD value 1:1.
 *   - Any other token (incl. ETH) => usd_value_if_known left BLANK. We do NOT
 *     hardcode a price. (There are currently zero non-USDC donations from us.)
 *
 * OUTPUTS (written next to this script):
 *   donation-ledger.csv / .json                 (combined, all recipients)
 *   donation-ledger-treegens.csv / .json        (per-recipient split)
 *
 * IDEMPOTENT: regenerates the whole ledger from chain every run. Safe to re-run
 * as new donations land. Loud failures — every network/parse error throws.
 *
 * RUN:  node "C:\\Users\\bigji\\Documents\\MfT-Launch\\donations\\build-donation-ledger.cjs"
 * -------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CONFIG — every address verified from repo source on 2026-07-15:
//   TreeGens recipient   : base-ecosystem-grant-mft.md L51, op-atlas L56, MfT-Addresses task
//   OPS wallet           : trees-food-funds.config.json (charityWallet of Money/BTC-T/ETH-T)
//   TREASURY / agent     : pump-deployment.json "deployer" 0xE2a4...
//   Money CharityFund clones: trees-food-funds.config.json baseInventory_allFactoryClones (idx 1,2)
//                             + MfT-Addresses.md (Money V2 mint 0x85C7...)
//   NEVER type an address from memory — all pulled from files above.
// ---------------------------------------------------------------------------

const CHAIN_ID = 8453;
const API_BASE = 'https://base.blockscout.com/api';

// Recipients we track (currently exactly one — TreeGens / trees).
const RECIPIENTS = [
  {
    key: 'treegens',
    name: 'TreeGens / Jimi Cohen (jimicohen.eth)',
    cause: 'trees',
    addr: '0xfC9265A28f66CF4561D74A4E25D7Bbd3F482B8e6',
  },
];

// OUR wallets/contracts. If a transfer's `from` is one of these, it's a donation from us.
// Value = human label for the ledger's source_label column.
const OUR_SOURCES = {
  '0x0780b1456d5e60cf26c8cd6541b85e805c8c05f2': 'ops-wallet (manual donation)',
  '0xe2a4a8b9d77080c57799a94ba8edeb2dd6e0ac10': 'treasury/agent',
  // Money CharityFund clones (their charity-third routes USDC out; charityWallet = ops).
  // Included so an automated harvest that ever pays TreeGens directly is caught + labeled.
  '0xe3dd3881477c20c17df080ceec0c1bd0c065a072': 'CharityFund clone: Money (primary)',
  '0x85c78b8104d874d17e698b8c5678e3b8072347b1': 'CharityFund clone: Money V2 mint',
  '0xb8389cacd0c7cff33ff095eb66044ed83a3528c1': 'CharityFund clone: Money (2nd, smaller)',
};

// Stablecoins we can value 1:1 (6-dec USD). Lower-cased contract addr -> symbol.
const USD_STABLES = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',   // native USDC (Base)
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDbC',  // bridged USDC (Base)
};

const OUT_DIR = __dirname;

// ---------------------------------------------------------------------------
// HTTP — keyless GET with retry. Loud: throws on exhausted retries or API error.
// Uses global fetch (Node 18+). Verified Node v24 in this env.
// ---------------------------------------------------------------------------

async function apiGet(params, { retries = 4 } = {}) {
  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      const json = await res.json();
      // Blockscout: message "OK" + result array on success. "No ... found" => empty (valid).
      if (json.message === 'OK' && Array.isArray(json.result)) return json.result;
      if (typeof json.message === 'string' && /no (transactions|token transfers)? *found/i.test(json.message)) {
        return [];
      }
      // Anything else is unexpected — surface it, do not silently swallow.
      throw new Error(`Unexpected API response (message="${json.message}") for ${url}`);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const backoff = 500 * attempt;
        console.warn(`  [retry ${attempt}/${retries - 1}] ${err.message} — waiting ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw new Error(`API GET failed after ${retries} attempts: ${lastErr && lastErr.message}`);
}

// Paginate a Blockscout account action until a short/empty page. Defensive against
// growth (default view caps ~10k rows; we page explicitly so the ledger stays complete).
async function fetchAllPages(baseParams) {
  const PAGE = 1000;
  const all = [];
  const seen = new Set(); // dedupe by hash+logIndex-ish key in case of page overlap
  for (let page = 1; page <= 1000; page++) {
    const rows = await apiGet({ ...baseParams, page: String(page), offset: String(PAGE) });
    for (const row of rows) {
      const k = `${row.hash}:${row.contractAddress || 'eth'}:${row.value}:${row.from}:${row.to}:${row.logIndex || ''}`;
      if (!seen.has(k)) { seen.add(k); all.push(row); }
    }
    if (rows.length < PAGE) break; // last page
    console.log(`    ...page ${page} full (${rows.length}); fetching next`);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function isoUtc(unixSecStr) {
  const n = Number(unixSecStr);
  if (!Number.isFinite(n)) throw new Error(`bad timestamp: ${unixSecStr}`);
  return new Date(n * 1000).toISOString();
}

// integer-string / 10^dec, kept as a decimal STRING (no float rounding of token amounts).
function formatUnits(valueStr, decimals) {
  const dec = Number(decimals);
  if (!Number.isFinite(dec) || dec < 0) throw new Error(`bad decimals: ${decimals}`);
  const neg = valueStr.startsWith('-');
  let v = neg ? valueStr.slice(1) : valueStr;
  if (!/^\d+$/.test(v)) throw new Error(`bad integer value: ${valueStr}`);
  v = v.padStart(dec + 1, '0');
  const whole = v.slice(0, v.length - dec);
  let frac = dec > 0 ? v.slice(v.length - dec) : '';
  frac = frac.replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return neg ? `-${out}` : out;
}

function csvCell(s) {
  const str = s == null ? '' : String(s);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const COLUMNS = [
  'timestamp_utc', 'cause', 'recipient_name', 'recipient_addr', 'source_label',
  'from_addr', 'token_symbol', 'token_addr', 'amount', 'usd_value_if_known',
  'tx_hash', 'block',
];

function toCsv(rows) {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

function writeOut(basename, rows) {
  const csvPath = path.join(OUT_DIR, `${basename}.csv`);
  const jsonPath = path.join(OUT_DIR, `${basename}.json`);
  fs.writeFileSync(csvPath, toCsv(rows), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf8');
  return { csvPath, jsonPath };
}

// ---------------------------------------------------------------------------
// Core: build ledger rows for one recipient
// ---------------------------------------------------------------------------

async function buildForRecipient(rcpt) {
  const recip = rcpt.addr.toLowerCase();
  console.log(`\n[${rcpt.key}] ${rcpt.name}  ${rcpt.addr}`);

  // 1) incoming ERC20
  console.log('  fetching ERC20 token transfers (tokentx)...');
  const tokentx = await fetchAllPages({
    module: 'account', action: 'tokentx', address: rcpt.addr,
    sort: 'asc', startblock: '0', endblock: '99999999',
  });
  console.log(`  tokentx rows: ${tokentx.length}`);

  // 2) native ETH
  console.log('  fetching native ETH transfers (txlist)...');
  const txlist = await fetchAllPages({
    module: 'account', action: 'txlist', address: rcpt.addr,
    sort: 'asc', startblock: '0', endblock: '99999999',
  });
  console.log(`  txlist rows: ${txlist.length}`);

  const rows = [];

  // ERC20: keep only transfers INTO the recipient.
  for (const t of tokentx) {
    if (!t.to || t.to.toLowerCase() !== recip) continue;
    const from = (t.from || '').toLowerCase();
    const tokenAddr = (t.contractAddress || '').toLowerCase();
    const isOurs = Object.prototype.hasOwnProperty.call(OUR_SOURCES, from);
    const sourceLabel = isOurs ? OUR_SOURCES[from] : 'external/other';

    const amount = formatUnits(t.value, t.tokenDecimal);

    // USD only for our donations in a known USD stablecoin (1:1). Never hardcode a price.
    let usd = '';
    if (isOurs && USD_STABLES[tokenAddr]) usd = amount;

    rows.push({
      timestamp_utc: isoUtc(t.timeStamp),
      cause: rcpt.cause,
      recipient_name: rcpt.name,
      recipient_addr: rcpt.addr,
      source_label: sourceLabel,
      from_addr: t.from,
      token_symbol: t.tokenSymbol || '',
      token_addr: t.contractAddress || '',
      amount,
      usd_value_if_known: usd,
      tx_hash: t.hash,
      block: Number(t.blockNumber),
      _ours: isOurs,
      _ts: Number(t.timeStamp),
    });
  }

  // Native ETH: incoming, value>0, not a failed tx.
  for (const t of txlist) {
    if (!t.to || t.to.toLowerCase() !== recip) continue;
    if (!t.value || t.value === '0') continue;
    if (t.isError && t.isError !== '0') continue;
    const from = (t.from || '').toLowerCase();
    const isOurs = Object.prototype.hasOwnProperty.call(OUR_SOURCES, from);
    const sourceLabel = isOurs ? OUR_SOURCES[from] : 'external/other';

    rows.push({
      timestamp_utc: isoUtc(t.timeStamp),
      cause: rcpt.cause,
      recipient_name: rcpt.name,
      recipient_addr: rcpt.addr,
      source_label: sourceLabel,
      from_addr: t.from,
      token_symbol: 'ETH',
      token_addr: '', // native
      amount: formatUnits(t.value, 18),
      usd_value_if_known: '', // no trustless price; we do not hardcode ETH/USD
      tx_hash: t.hash,
      block: Number(t.blockNumber),
      _ours: isOurs,
      _ts: Number(t.timeStamp),
    });
  }

  // chronological
  rows.sort((a, b) => (a._ts - b._ts) || (a.block - b.block));
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(72));
  console.log('MfT Donation Ledger — on-chain build (Base, chainId ' + CHAIN_ID + ')');
  console.log('Source: Blockscout keyless API. Read-only.');
  console.log('Generated (UTC):', new Date().toISOString());
  console.log('='.repeat(72));

  const combined = [];
  const perRecipientSummaries = [];

  for (const rcpt of RECIPIENTS) {
    const rows = await buildForRecipient(rcpt);

    // strip internal helper fields for the written artifacts
    const clean = rows.map(({ _ours, _ts, ...r }) => r);

    // per-recipient files
    const { csvPath, jsonPath } = writeOut(`donation-ledger-${rcpt.key}`, clean);

    // stats
    const ours = rows.filter((r) => r._ours);
    const external = rows.filter((r) => !r._ours);
    const usdTotal = ours.reduce((s, r) => s + (r.usd_value_if_known ? Number(r.usd_value_if_known) : 0), 0);
    const oursNoUsd = ours.filter((r) => !r.usd_value_if_known);

    const dates = rows.map((r) => r._ts).filter(Boolean);
    const range = dates.length
      ? `${new Date(Math.min(...dates) * 1000).toISOString()} .. ${new Date(Math.max(...dates) * 1000).toISOString()}`
      : '(none)';

    perRecipientSummaries.push({
      key: rcpt.key, name: rcpt.name, cause: rcpt.cause, addr: rcpt.addr,
      totalIncomingRows: rows.length,
      ourDonations: ours.length,
      externalTransfers: external.length,
      ourUsdTotal: usdTotal,
      ourDonationsWithoutUsd: oursNoUsd.length,
      dateRange: range,
      files: { csv: csvPath, json: jsonPath },
      ourDonationDetail: ours.map((r) => ({
        ts: r.timestamp_utc, from: r.from_addr, source: r.source_label,
        token: r.token_symbol, amount: r.amount, usd: r.usd_value_if_known, tx: r.tx_hash, block: r.block,
      })),
    });

    combined.push(...clean);
  }

  // combined (chronological across all recipients)
  combined.sort((a, b) => (Date.parse(a.timestamp_utc) - Date.parse(b.timestamp_utc)) || (a.block - b.block));
  const combinedFiles = writeOut('donation-ledger', combined);

  // ---- report to stdout ----
  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY');
  console.log('='.repeat(72));
  let grandUsd = 0;
  let grandOurs = 0;
  for (const s of perRecipientSummaries) {
    grandUsd += s.ourUsdTotal;
    grandOurs += s.ourDonations;
    console.log(`\nCause: ${s.cause.toUpperCase()}  —  ${s.name}`);
    console.log(`  recipient        : ${s.addr}`);
    console.log(`  incoming rows    : ${s.totalIncomingRows}  (ours: ${s.ourDonations}, external: ${s.externalTransfers})`);
    console.log(`  OUR donations    : ${s.ourDonations}`);
    console.log(`  OUR USD total    : $${s.ourUsdTotal.toFixed(2)}  (stablecoin 1:1; ${s.ourDonationsWithoutUsd} of ours have no trustless USD)`);
    console.log(`  date range (all) : ${s.dateRange}`);
    console.log(`  files            : ${s.files.csv}`);
    console.log(`                     ${s.files.json}`);
    if (s.ourDonationDetail.length) {
      console.log('  OUR donation(s):');
      for (const d of s.ourDonationDetail) {
        console.log(`    - ${d.ts}  ${d.amount} ${d.token}  ($${d.usd || '?'})  from ${d.source}`);
        console.log(`      tx ${d.tx}  block ${d.block}`);
      }
    }
  }

  console.log('\n' + '-'.repeat(72));
  console.log(`GRAND TOTAL — OUR donations: ${grandOurs}   OUR USD (stablecoin): $${grandUsd.toFixed(2)}`);
  console.log(`Combined ledger: ${combinedFiles.csvPath}`);
  console.log(`                 ${combinedFiles.jsonPath}`);

  // ---- sanity check: the known 2026-06-14 TreeGens $0.50 USDC donation must appear ----
  const KNOWN_TX = '0x80f855a6679f7552e80d50f2788afb9da9f18ed2efbb470b2b7786b216aa8fe2';
  const hit = combined.find((r) => r.tx_hash.toLowerCase() === KNOWN_TX);
  console.log('\n' + '-'.repeat(72));
  console.log('SANITY CHECK — documented 2026-06-14 TreeGens $0.50 USDC / 5 trees donation:');
  if (hit) {
    console.log(`  FOUND: ${hit.timestamp_utc}  ${hit.amount} ${hit.token_symbol}  ($${hit.usd_value_if_known})`);
    console.log(`         from ${hit.from_addr}  [${hit.source_label}]`);
    console.log(`         tx ${hit.tx_hash}  block ${hit.block}`);
    if (hit.amount !== '0.5' || hit.token_symbol !== 'USDC') {
      throw new Error(`Known donation found but amount/symbol mismatch: got ${hit.amount} ${hit.token_symbol}, expected 0.5 USDC`);
    }
    console.log('  OK — matches $0.50 USDC. Ledger integrity confirmed.');
  } else {
    // Hard failure: the pull is broken if it can't see a donation we KNOW exists.
    throw new Error(
      `SANITY CHECK FAILED: known TreeGens donation tx ${KNOWN_TX} not in ledger. ` +
      `The on-chain pull is incomplete or filtering is wrong — do NOT trust this ledger. Debug before use.`
    );
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFATAL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
