#!/usr/bin/env node
/**
 * Try different solcjs settings to match on-chain SporeReactorV4 creation bytecode
 * On-chain: solc 0.8.26, 28950 hex chars, no constructor args
 */
const fs = require("fs");

// Need solc 0.8.26 - reinstall it
const solcPath = require.resolve("solc");
console.log("Using solc at:", solcPath);

const solc = require("solc");
console.log("solcjs version:", solc.version());

if (!solc.version().startsWith("0.8.26")) {
  console.log("WRONG VERSION - need 0.8.26, got", solc.version());
  console.log("Run: npm install solc@0.8.26 --no-save");
  process.exit(1);
}

const onchain = fs.readFileSync("verify/onchain_reactor_creation.txt", "utf8").trim();
console.log("Target on-chain creation bytecode:", onchain.length, "hex chars");

const reactorSol = fs.readFileSync("contracts/SporeReactorV4.sol", "utf8");

function trySettings(label, settings) {
  const input = JSON.stringify({
    language: "Solidity",
    sources: {
      "SporeReactorV4.sol": { content: reactorSol },
    },
    settings: {
      viaIR: true,
      optimizer: { enabled: true, ...settings.optimizer },
      ...(settings.evmVersion ? { evmVersion: settings.evmVersion } : {}),
      ...(settings.debug ? { debug: settings.debug } : {}),
      ...(settings.noViaIR ? { viaIR: false } : {}),
      outputSelection: { "*": { "*": ["evm.bytecode.object"] } },
    },
  });

  const output = JSON.parse(solc.compile(input));
  if (output.errors) {
    const errs = output.errors.filter(e => e.severity === "error");
    if (errs.length > 0) {
      console.log(label, "-> COMPILE ERROR:", errs[0].message.substring(0, 80));
      return;
    }
  }

  const contracts = output.contracts["SporeReactorV4.sol"];
  const bc = contracts["SporeReactorV4"].evm.bytecode.object;
  const match = bc === onchain;

  let metadataOnly = false;
  if (bc.length === onchain.length && !match) {
    let diffs = 0;
    for (let i = 0; i < bc.length; i++) {
      if (bc[i] !== onchain[i]) diffs++;
    }
    if (diffs <= 200) metadataOnly = true;
    console.log(label, "->", bc.length, "chars", metadataOnly ? `METADATA-ONLY (${diffs} chars)` : `${diffs} diffs`);
  } else {
    console.log(label, "->", bc.length, "chars", match ? "*** EXACT MATCH ***" : "");
  }
}

const combos = [
  { label: "runs=200", optimizer: { runs: 200 } },
  { label: "runs=200 shanghai", optimizer: { runs: 200 }, evmVersion: "shanghai" },
  { label: "runs=200 cancun", optimizer: { runs: 200 }, evmVersion: "cancun" },
  { label: "runs=200 paris", optimizer: { runs: 200 }, evmVersion: "paris" },
  { label: "runs=1", optimizer: { runs: 1 } },
  { label: "runs=1 paris", optimizer: { runs: 1 }, evmVersion: "paris" },
  { label: "runs=200 strip", optimizer: { runs: 200 }, debug: { revertStrings: "strip" } },
  { label: "runs=200 paris strip", optimizer: { runs: 200 }, evmVersion: "paris", debug: { revertStrings: "strip" } },
  { label: "runs=1 strip", optimizer: { runs: 1 }, debug: { revertStrings: "strip" } },
  { label: "runs=1 paris strip", optimizer: { runs: 1 }, evmVersion: "paris", debug: { revertStrings: "strip" } },
  { label: "runs=200 shanghai strip", optimizer: { runs: 200 }, evmVersion: "shanghai", debug: { revertStrings: "strip" } },
  { label: "runs=1 shanghai strip", optimizer: { runs: 1 }, evmVersion: "shanghai", debug: { revertStrings: "strip" } },
];

for (const c of combos) {
  trySettings(c.label, c);
}
