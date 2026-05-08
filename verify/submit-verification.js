#!/usr/bin/env node
/**
 * submit-verification.js — Submit contract verification to Basescan API
 *
 * Prerequisites:
 *   1. Get a free API key at https://basescan.org/register
 *   2. Set BASESCAN_API_KEY in tools/.env or as env var
 *
 * Usage:
 *   node verify/submit-verification.js [v52|v43|reactor]
 *   node verify/submit-verification.js all
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "tools", ".env") });

const API_KEY = process.env.BASESCAN_API_KEY;
const API_URL = "https://api.etherscan.io/v2/api?chainid=8453";

if (!API_KEY) {
  console.error("ERROR: Set BASESCAN_API_KEY in tools/.env or as environment variable");
  console.error("Get a free key at: https://basescan.org/register");
  process.exit(1);
}

const CONTRACTS = {
  v52: {
    name: "Factory V5.2 (Unruggable2)",
    address: "0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51",
    compiler: "v0.8.24+commit.e11b9ed9",
    contractName: "contracts/MycoPadV5_2.sol:Unruggable2",
    inputFiles: ["v5_2_input_1.json", "v5_2_input_2.json", "v5_2_input_3.json"],
    argsFile: "v5_2_constructor_args.txt",
  },
  v43: {
    name: "Factory V4.3 (MycoPadV4)",
    address: "0x51eF41E0730c0e607950421e1EE113b089867d3e",
    compiler: "v0.8.24+commit.e11b9ed9",
    contractName: "MycoPadV4.sol:MycoPadV4",
    inputFiles: ["v4_3_input_CORRECT.json"],
    argsFile: "v4_3_constructor_args_REAL.txt",
  },
  reactor: {
    name: "SporeReactorV4 Implementation",
    address: "0x82eC86F4536167A95eF302056162b1c8b9c7F4FA",
    compiler: "v0.8.26+commit.8a97fa7a",
    contractName: "SporeReactorV4.sol:SporeReactorV4",
    inputFiles: ["reactor_v4_input_CORRECT.json"],
    argsFile: null,
  },
  reactor2: {
    name: "SporeReactorV4 Implementation (V4.3 factory)",
    address: "0xb9630280dc93c503aee06d1eca8e125fc19ab3c5",
    compiler: "v0.8.26+commit.8a97fa7a",
    contractName: "SporeReactorV4.sol:SporeReactorV4",
    inputFiles: ["reactor_v4_input_CORRECT.json"],
    argsFile: null,
  },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function submitVerification(contract, inputFile) {
  const sourceCode = fs.readFileSync(path.join(__dirname, inputFile), "utf8");
  const constructorArgs = contract.argsFile
    ? fs.readFileSync(path.join(__dirname, contract.argsFile), "utf8").trim()
    : "";

  const params = new URLSearchParams({
    apikey: API_KEY,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: contract.address,
    sourceCode,
    codeformat: "solidity-standard-json-input",
    contractname: contract.contractName,
    compilerversion: contract.compiler,
    constructorArguements: constructorArgs,
  });

  const resp = await fetch(API_URL, { method: "POST", body: params });
  const data = await resp.json();
  return data;
}

async function checkStatus(guid) {
  const url = `https://api.etherscan.io/v2/api?chainid=8453&apikey=${API_KEY}&module=contract&action=checkverifystatus&guid=${guid}`;
  const resp = await fetch(url);
  return resp.json();
}

async function verifyContract(key) {
  const contract = CONTRACTS[key];
  console.log(`\n=== ${contract.name} ===`);
  console.log(`Address: ${contract.address}`);
  console.log(`Compiler: ${contract.compiler}`);

  for (const inputFile of contract.inputFiles) {
    console.log(`\nTrying: ${inputFile}`);
    const result = await submitVerification(contract, inputFile);

    if (result.status === "1") {
      const guid = result.result;
      console.log(`Submitted! GUID: ${guid}`);
      console.log("Checking status...");

      for (let i = 0; i < 10; i++) {
        await sleep(5000);
        const status = await checkStatus(guid);
        console.log(`  Status: ${status.result}`);
        if (status.result === "Pass - Verified") {
          console.log(`SUCCESS: ${contract.name} verified!`);
          return true;
        }
        if (status.result.includes("Fail") && !status.result.includes("Pending")) {
          console.log(`Failed with this input file, trying next...`);
          break;
        }
      }
    } else {
      console.log(`API error: ${result.result}`);
      if (result.result.includes("Already Verified")) {
        console.log("Already verified!");
        return true;
      }
    }
    await sleep(2000);
  }

  console.log(`Could not verify ${contract.name} with any input file.`);
  console.log("Try manual verification at Basescan with different compiler settings.");
  return false;
}

async function main() {
  const arg = process.argv[2] || "all";
  const keys = arg === "all" ? Object.keys(CONTRACTS) : [arg];

  for (const key of keys) {
    if (!CONTRACTS[key]) {
      console.error(`Unknown contract: ${key}. Use: ${Object.keys(CONTRACTS).join(", ")}, or all`);
      continue;
    }
    await verifyContract(key);
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
