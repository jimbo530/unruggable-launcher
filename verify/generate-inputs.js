#!/usr/bin/env node
/**
 * generate-inputs.js — Create Basescan verification inputs for all contracts
 *
 * Generates:
 *   1. Standard JSON input files for each contract
 *   2. ABI-encoded constructor arguments
 *   3. Console summary with Basescan URLs
 *
 * Usage: node verify/generate-inputs.js
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const OUT_DIR = __dirname;

// ── Read source files ──────────────────────────────────────────────────────
function readSol(name) {
  return fs.readFileSync(path.join(CONTRACTS_DIR, name), "utf8");
}

// ── Standard JSON input builder ────────────────────────────────────────────
function buildStdInput(sources, settings) {
  return JSON.stringify({
    language: "Solidity",
    sources,
    settings: {
      viaIR: true,
      optimizer: { enabled: true, ...settings.optimizer },
      ...(settings.evmVersion ? { evmVersion: settings.evmVersion } : {}),
      ...(settings.debug ? { debug: settings.debug } : {}),
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  }, null, 2);
}

// ── ABI-encode constructor args ────────────────────────────────────────────
function encodeArgs(types, values) {
  return ethers.AbiCoder.defaultAbiCoder().encode(types, values).slice(2); // no 0x prefix
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Factory V5.2 — Unruggable2 (0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51)
//     solc 0.8.24, viaIR, optimizer enabled
// ═══════════════════════════════════════════════════════════════════════════

const v52Source = {
  "contracts/MycoPadV5_2.sol": { content: readSol("MycoPadV5_2.sol") },
  "contracts/LaunchToken.sol": { content: readSol("LaunchToken.sol") },
};

const v52Args = {
  types: [
    "address", "address", "address", "address", "address", "address",
    "address", "address", "address", "address", "address", "address",
    "uint24", "int24", "uint24", "uint24", "uint24",
  ],
  values: [
    "0x4200000000000000000000000000000000000006", // weth
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // usdc
    "0x3595ca37596D5895B70EFAB592ac315D5B9809B2", // azusd
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // wrappedBtc
    "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3", // mft
    "0x20b048fA035D5763685D695e66aDF62c5D9F5055", // char
    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", // v3Factory
    "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1", // positionManager
    "0x2626664c2603336E57B271c5C0b26F421741e481", // swapRouter
    "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5", // aeroRouter
    "0x82eC86F4536167A95eF302056162b1c8b9c7F4FA", // reactorImpl
    "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045", // upstreamReactor
    500,   // wethUsdcFee
    50,    // aeroTickSpacing
    10000, // mftPriceFee
    3000,  // charUsdcFee
    500,   // usdcBtcFee
  ],
};

// Try both optimizer settings — the deploy HTML may have used either
const v52Settings = [
  { optimizer: { runs: 200 }, evmVersion: "paris" },
  { optimizer: { runs: 1 }, evmVersion: "paris", debug: { revertStrings: "strip" } },
  { optimizer: { runs: 200 } },
];

// ═══════════════════════════════════════════════════════════════════════════
//  2. Factory V4.3 — MycoPadV4 (0x51eF41E0730c0e607950421e1EE113b089867d3e)
//     solc 0.8.26, viaIR, optimizer enabled
// ═══════════════════════════════════════════════════════════════════════════

const v43Source = {
  "contracts/MycoPadV4.sol": { content: readSol("MycoPadV4.sol") },
  "contracts/LaunchToken.sol": { content: readSol("LaunchToken.sol") },
};

const v43Args = {
  types: [
    "address", "address", "address", "address", "address", "address",
    "address", "address", "address", "address", "address", "address",
    "address", "address", "address",
    "uint24", "int24", "uint24", "uint24", "uint24", "uint24",
  ],
  values: [
    "0x4200000000000000000000000000000000000006", // weth
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // usdc
    "0x3595ca37596D5895B70EFAB592ac315D5B9809B2", // azusd
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // wrappedBtc
    "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3", // mft
    "0xf967bf3dccF8b6826F82de1781C98E61Bda3b106", // bb
    "0x17a176Ab2379b86F1E65D79b03bD8c75981244D8", // eb
    "0x20b048fA035D5763685D695e66aDF62c5D9F5055", // char
    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", // v3Factory
    "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1", // positionManager
    "0x2626664c2603336E57B271c5C0b26F421741e481", // swapRouter
    "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5", // aeroRouter
    "0xb9630280dc93c503aee06d1eca8e125fc19ab3c5", // reactorImpl (V4)
    "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045", // upstreamReactor
    "0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045", // charUpstream
    500,   // wethUsdcFee
    50,    // aeroTickSpacing
    500,   // wethBtcFee
    10000, // btcBbFee
    10000, // wethEbFee
    10000, // mftPriceFee
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
//  3. SporeReactorV4 Implementation — no constructor args
//     Two known impls: 0x82eC86...4FA (V5.2 factory) and 0xb963...3c5 (V4.3 factory)
//     solc 0.8.34, viaIR, optimizer enabled
// ═══════════════════════════════════════════════════════════════════════════

const reactorV4Source = {
  "contracts/SporeReactorV4.sol": { content: readSol("SporeReactorV4.sol") },
};

// ═══════════════════════════════════════════════════════════════════════════
//  Generate all files
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Basescan Verification Input Generator ===\n");

// V5.2 Factory
const v52Encoded = encodeArgs(v52Args.types, v52Args.values);
for (let i = 0; i < v52Settings.length; i++) {
  const fname = `v5_2_input_${i + 1}.json`;
  fs.writeFileSync(path.join(OUT_DIR, fname), buildStdInput(v52Source, v52Settings[i]));
  console.log(`Written: ${fname} (runs=${v52Settings[i].optimizer.runs}${v52Settings[i].evmVersion ? ", evmVersion=" + v52Settings[i].evmVersion : ""})`);
}
fs.writeFileSync(path.join(OUT_DIR, "v5_2_constructor_args.txt"), v52Encoded);
console.log(`Written: v5_2_constructor_args.txt (${v52Encoded.length / 2} bytes)`);

// V4.3 Factory
const v43Encoded = encodeArgs(v43Args.types, v43Args.values);
const v43Settings = [
  { optimizer: { runs: 200 }, evmVersion: "paris" },
  { optimizer: { runs: 1 }, evmVersion: "paris" },
];
for (let i = 0; i < v43Settings.length; i++) {
  const fname = `v4_3_input_${i + 1}.json`;
  fs.writeFileSync(path.join(OUT_DIR, fname), buildStdInput(v43Source, v43Settings[i]));
  console.log(`Written: ${fname} (runs=${v43Settings[i].optimizer.runs})`);
}
fs.writeFileSync(path.join(OUT_DIR, "v4_3_constructor_args.txt"), v43Encoded);
console.log(`Written: v4_3_constructor_args.txt (${v43Encoded.length / 2} bytes)`);

// SporeReactorV4 (no constructor args)
const reactorSettings = [
  { optimizer: { runs: 200 }, evmVersion: "paris" },
  { optimizer: { runs: 1 }, evmVersion: "paris" },
];
for (let i = 0; i < reactorSettings.length; i++) {
  const fname = `reactor_v4_input_${i + 1}.json`;
  fs.writeFileSync(path.join(OUT_DIR, fname), buildStdInput(reactorV4Source, reactorSettings[i]));
  console.log(`Written: ${fname}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n=== Verification Steps ===\n");

console.log("1. Factory V5.2 (Unruggable2)");
console.log("   Address: 0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51");
console.log("   URL: https://basescan.org/address/0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51#code");
console.log("   Compiler: v0.8.24+commit.e11b9ed9");
console.log("   Contract: contracts/MycoPadV5_2.sol:Unruggable2");
console.log("   Try input files: v5_2_input_1.json (runs=200), then v5_2_input_2.json (runs=1)");
console.log("   Constructor args: copy from v5_2_constructor_args.txt");

console.log("\n2. Factory V4.3 (MycoPadV4)");
console.log("   Address: 0x51eF41E0730c0e607950421e1EE113b089867d3e");
console.log("   URL: https://basescan.org/address/0x51eF41E0730c0e607950421e1EE113b089867d3e#code");
console.log("   Compiler: v0.8.26+commit.8a97fa7a");
console.log("   Contract: contracts/MycoPadV4.sol:MycoPadV4");
console.log("   Try input files: v4_3_input_1.json (runs=200), then v4_3_input_2.json (runs=1)");
console.log("   Constructor args: copy from v4_3_constructor_args.txt");

console.log("\n3. SporeReactorV4 Implementation (used by V5.2 factory)");
console.log("   Address: 0x82eC86F4536167A95eF302056162b1c8b9c7F4FA");
console.log("   URL: https://basescan.org/address/0x82eC86F4536167A95eF302056162b1c8b9c7F4FA#code");
console.log("   Compiler: v0.8.34+commit.1c8745a5");
console.log("   Contract: contracts/SporeReactorV4.sol:SporeReactorV4");
console.log("   No constructor arguments");
console.log("   Try input files: reactor_v4_input_1.json (runs=200), then reactor_v4_input_2.json (runs=1)");

console.log("\n4. SporeReactorV4 Implementation (used by V4.3 factory)");
console.log("   Address: 0xb9630280dc93c503aee06d1eca8e125fc19ab3c5");
console.log("   URL: https://basescan.org/address/0xb9630280dc93c503aee06d1eca8e125fc19ab3c5#code");
console.log("   Same source as #3, same compiler, no constructor args");

console.log("\n=== Basescan Manual Verification ===");
console.log("Go to each address > Contract > Verify & Publish");
console.log('Choose "Solidity (Standard-JSON-Input)"');
console.log("Select compiler version, upload the .json input file");
console.log("Paste constructor args (if any) from the .txt file");
console.log("");
