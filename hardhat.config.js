require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris"
    }
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts"
  }
};
