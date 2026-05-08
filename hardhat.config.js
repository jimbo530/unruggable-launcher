require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 1 },
          evmVersion: "paris",
          debug: { revertStrings: "strip" }
        }
      },
      {
        version: "0.8.26",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris"
        }
      },
      {
        version: "0.8.34",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris"
        }
      }
    ],
    overrides: {
      "contracts/MycoPadV4.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } } },
      "contracts/LaunchToken.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } } },
    }
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts"
  },
  networks: {
    base: {
      url: process.env.ALCHEMY_RPC || "https://mainnet.base.org",
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : []
    }
  },
  sourcify: {
    enabled: true,
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || ""
    },
    customChains: [{
      network: "base",
      chainId: 8453,
      urls: {
        apiURL: "https://api.basescan.org/api",
        browserURL: "https://basescan.org"
      }
    }]
  }
};
