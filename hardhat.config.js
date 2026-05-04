require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 1 },
      evmVersion: "paris",
      debug: { revertStrings: "strip" }
    }
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts"
  }
};
