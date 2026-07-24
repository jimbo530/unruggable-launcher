// Gas estimate for the Charity Suite deploys, measured on the RH 4663 fork.
// Run: FORK_RH=1 npx hardhat test test/rh-gas-estimate.js
const { ethers, network } = require("hardhat");

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const VAULT = "0xBeEff033F34C046626B8D0A041844C5d1A5409dd";
const USDG_WHALE = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const PROJECT_WALLET = "0x0780b1456D5E60CF26C8Cd6541b85E805C8c05F2";
const U = (n) => ethers.parseUnits(n.toString(), 6);

describe("RH Charity Suite — gas", function () {
  this.timeout(180000);
  before(function () { if (process.env.FORK_RH !== "1") this.skip(); });

  it("measures deploy + op gas", async function () {
    const [dep] = await ethers.getSigners();
    const usdg = await ethers.getContractAt(["function transfer(address,uint256) returns (bool)","function approve(address,uint256) returns (bool)","function balanceOf(address) view returns (uint256)"], USDG);

    await network.provider.request({ method: "hardhat_impersonateAccount", params: [USDG_WHALE] });
    await network.provider.request({ method: "hardhat_setBalance", params: [USDG_WHALE, "0x56BC75E2D63100000"] });
    const whale = await ethers.getSigner(USDG_WHALE);
    await usdg.connect(whale).transfer(dep.address, U(2000));

    const rows = [];
    const Vault = await ethers.getContractFactory("CharityVaultMorpho");
    const vTx = await (await Vault.deploy("Money for Trees","RH",USDG,VAULT,PROJECT_WALLET,dep.address,"tree planting")).deploymentTransaction().wait();
    const vaultC = await ethers.getContractAt("CharityVaultMorpho", vTx.contractAddress);
    rows.push(["CharityVaultMorpho deploy (MfT)", vTx.gasUsed]);

    const Vault2 = await ethers.getContractFactory("CharityVaultMorpho");
    const v2Tx = await (await Vault2.deploy("Feeding People","FTP",USDG,VAULT,PROJECT_WALLET,dep.address,"feeding people")).deploymentTransaction().wait();
    rows.push(["CharityVaultMorpho deploy (FTP)", v2Tx.gasUsed]);

    const LJ = await ethers.getContractFactory("LittleJohn");
    const ljTx = await (await LJ.deploy(dep.address)).deploymentTransaction().wait();
    rows.push(["LittleJohn deploy", ljTx.gasUsed]);

    // ops
    await usdg.connect(dep).approve(await vaultC.getAddress(), U(1000));
    const depG = await (await vaultC.connect(dep).deposit(U(1000))).wait();
    rows.push(["deposit(1000 USDG)", depG.gasUsed]);
    const redG = await (await vaultC.connect(dep).redeem(U(500))).wait();
    rows.push(["redeem(500 USDG)", redG.gasUsed]);

    const feeData = await ethers.provider.getFeeData();
    const gwei = 0.108; // live RH maxFeePerGas ~0.108 gwei (probe)
    console.log("\n=== GAS (measured on 4663 fork) ===");
    let totalDeploy = 0n;
    for (const [name, g] of rows) {
      const ethCost = (Number(g) * gwei) / 1e9;
      console.log(name.padEnd(36), g.toString().padStart(9), "gas  ~", ethCost.toFixed(8), "ETH @0.108gwei");
      if (name.includes("deploy")) totalDeploy += g;
    }
    console.log("\nTOTAL DEPLOY GAS:", totalDeploy.toString(), "~", ((Number(totalDeploy)*gwei)/1e9).toFixed(8), "ETH");
  });
});
