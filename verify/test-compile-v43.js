#!/usr/bin/env node
/**
 * Try different solcjs 0.8.24 settings to match on-chain creation bytecode
 */
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const onchain = fs.readFileSync(path.join(__dirname, "onchain_v43_creation.txt"), "utf8").trim();
console.log("Target on-chain creation bytecode:", onchain.length, "hex chars");
console.log("solcjs version:", solc.version());

const mycoPad = fs.readFileSync(path.join(__dirname, "..", "contracts", "MycoPadV4.sol"), "utf8");
const launchToken = fs.readFileSync(path.join(__dirname, "..", "contracts", "LaunchToken.sol"), "utf8");

function trySettings(label, settings) {
  const input = JSON.stringify({
    language: "Solidity",
    sources: {
      "MycoPadV4.sol": { content: mycoPad },
      "LaunchToken.sol": { content: launchToken },
    },
    settings: {
      viaIR: true,
      optimizer: { enabled: true, ...settings.optimizer },
      ...(settings.evmVersion ? { evmVersion: settings.evmVersion } : {}),
      ...(settings.debug ? { debug: settings.debug } : {}),
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

  const bc = output.contracts["MycoPadV4.sol"]["MycoPadV4"].evm.bytecode.object;
  const match = bc === onchain;
  console.log(label, "->", bc.length, "chars", match ? "*** MATCH ***" : "");
}

// Test combinations
const combos = [
  { label: "runs=200", optimizer: { runs: 200 } },
  { label: "runs=200 shanghai", optimizer: { runs: 200 }, evmVersion: "shanghai" },
  { label: "runs=200 cancun", optimizer: { runs: 200 }, evmVersion: "cancun" },
  { label: "runs=200 paris", optimizer: { runs: 200 }, evmVersion: "paris" },
  { label: "runs=1", optimizer: { runs: 1 } },
  { label: "runs=1 shanghai", optimizer: { runs: 1 }, evmVersion: "shanghai" },
  { label: "runs=1 paris", optimizer: { runs: 1 }, evmVersion: "paris" },
  { label: "runs=200 strip", optimizer: { runs: 200 }, debug: { revertStrings: "strip" } },
  { label: "runs=200 shanghai strip", optimizer: { runs: 200 }, evmVersion: "shanghai", debug: { revertStrings: "strip" } },
  { label: "runs=1 strip", optimizer: { runs: 1 }, debug: { revertStrings: "strip" } },
  { label: "runs=1 shanghai strip", optimizer: { runs: 1 }, evmVersion: "shanghai", debug: { revertStrings: "strip" } },
  { label: "runs=1 paris strip", optimizer: { runs: 1 }, evmVersion: "paris", debug: { revertStrings: "strip" } },
  { label: "runs=200 cancun strip", optimizer: { runs: 200 }, evmVersion: "cancun", debug: { revertStrings: "strip" } },
  { label: "runs=1 cancun", optimizer: { runs: 1 }, evmVersion: "cancun" },
  { label: "runs=1 cancun strip", optimizer: { runs: 1 }, evmVersion: "cancun", debug: { revertStrings: "strip" } },
];

for (const c of combos) {
  trySettings(c.label, c);
}
