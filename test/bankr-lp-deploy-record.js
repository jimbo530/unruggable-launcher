// Validates deploy/bankr-lp-deployed.json is well-formed for deploy-bankr-operator.cjs:
// every pinned address is checksum-loadable by ethers.getAddress (the exact call the script
// makes), the known constants match deploy/location-lp-deployed.json, and operator starts null.
//   npx hardhat test test/bankr-lp-deploy-record.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const rec = JSON.parse(fs.readFileSync(path.join(REPO, "deploy", "bankr-lp-deployed.json"), "utf8"));
const loc = JSON.parse(fs.readFileSync(path.join(REPO, "deploy", "location-lp-deployed.json"), "utf8"));

describe("bankr-lp-deployed.json (deploy record)", function () {
  it("every pinned address is checksum-valid (getAddress won't throw)", () => {
    for (const key of ["impl", "gameSigner", "owner", "bankrOperator", "liveFactoryDoNotTouch"]) {
      expect(rec[key], key + " present").to.be.a("string");
      expect(() => ethers.getAddress(rec[key]), key + " getAddress").to.not.throw();
    }
  });

  it("impl / gameSigner / owner match the live location-LP deploy record", () => {
    expect(ethers.getAddress(rec.impl)).to.equal(ethers.getAddress(loc.implementation));
    expect(ethers.getAddress(rec.gameSigner)).to.equal(ethers.getAddress(loc.gameSigner));
    expect(ethers.getAddress(rec.owner)).to.equal(ethers.getAddress(loc.treasury));
  });

  it("liveFactoryDoNotTouch matches the live factory address", () => {
    expect(ethers.getAddress(rec.liveFactoryDoNotTouch)).to.equal(ethers.getAddress(loc.factory));
  });

  it("bankrOperator is the founder-provided address, distinct from owner + live factory", () => {
    const bankr = ethers.getAddress(rec.bankrOperator);
    expect(bankr).to.equal(ethers.getAddress("0xd7dfc7fe6c2b582b142dbc23ad172f735106b598"));
    expect(bankr).to.not.equal(ethers.getAddress(rec.owner));
    expect(bankr).to.not.equal(ethers.getAddress(rec.liveFactoryDoNotTouch));
    expect(rec.bankrOperatorProvenance).to.be.a("string").and.match(/2026-07-15/);
  });

  it("starts unauthorized: operator null, bankrOperatorAuthorized false", () => {
    expect(rec.operator).to.equal(null);
    expect(rec.bankrOperatorAuthorized).to.equal(false);
    expect(rec.chainId).to.equal(8453);
  });

  it("the artifact the deploy script loads exists and has bytecode", () => {
    const p = path.join(REPO, "artifacts", "contracts", "BankrLPOperator.sol", "BankrLPOperator.json");
    expect(fs.existsSync(p), "artifact at " + p).to.equal(true);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(j.bytecode).to.be.a("string").and.not.equal("0x");
  });
});
