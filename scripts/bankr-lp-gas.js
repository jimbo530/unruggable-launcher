// Measures BankrLPOperator deploy gas (includes the nested `new LocationLPFactory`).
// npx hardhat run scripts/bankr-lp-gas.js
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  // Real mainnet addresses (verified from deploy/location-lp-deployed.json).
  const IMPL = "0x6700ded62e5f773729dcb1Eb8C93F2Da7fDD7A9F";
  const SIGNER = "0xF426fEfB83dbd8F7398C2e7559178CDEb4C17db8";
  const TREASURY = "0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10";

  const Wrapper = await ethers.getContractFactory("BankrLPOperator");
  const tx = await Wrapper.getDeployTransaction(IMPL, SIGNER, TREASURY);

  // eth_estimateGas on the deploy calldata (constructor deploys the nested factory too).
  const est = await ethers.provider.estimateGas({ from: deployer.address, data: tx.data });

  // Actual receipt gasUsed (ground truth).
  const w = await Wrapper.deploy(IMPL, SIGNER, TREASURY);
  const r = await (await w.deploymentTransaction()).wait();

  console.log("BankrLPOperator deploy gas");
  console.log("  init calldata bytes :", (tx.data.length - 2) / 2);
  console.log("  estimateGas         :", est.toString());
  console.log("  actual gasUsed      :", r.gasUsed.toString());
  console.log("  wrapper address     :", await w.getAddress());
  console.log("  fresh factory addr  :", await w.factory());
}
main().catch((e) => { console.error(e); process.exit(1); });
