require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 1 },
          // cancun: Base supports it; OZ 5.6 ERC721/Strings/Bytes need mcopy.
          // Local-compile only; does not redeploy existing contracts.
          evmVersion: "cancun",
          debug: { revertStrings: "strip" }
        }
      },
      {
        version: "0.8.26",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun"
        }
      },
      {
        version: "0.8.34",
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun"
        }
      }
    ],
    overrides: {
      "contracts/MycoPadV4.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } } },
      "contracts/LaunchToken.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } } },
      // Fee-share NFT variant — OZ 5.6 ERC721 uses mcopy (Cancun). Base supports Cancun.
      "contracts/FeeShareDistributor.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      "contracts/SporeReactorV5.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      "contracts/MycoPadV8.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      "contracts/SporeReactorV6.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      "contracts/MycoPadV9.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      // Mutiny-capable ship + Shipyard factory (OZ ERC721 crew → Cancun).
      "contracts/ShipToken.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      // Shipyard inlines the full pool-creation math + buy-in; strip revert
      // strings + runs:1 to stay under the 24576-byte EIP-170 limit (matches the
      // V7 factory's strip convention). Revert-reason assertions for Shipyard
      // use `reverted` (not `revertedWith`) since strings are stripped.
      "contracts/Shipyard.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 1 }, evmVersion: "cancun", debug: { revertStrings: "strip" } } },
      // ShipyardV2 — same as Shipyard (full pool math + buy-in) plus a crewBaseURI;
      // same runs:1 + strip to stay under the 24576-byte EIP-170 limit.
      "contracts/ShipyardV2.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 1 }, evmVersion: "cancun", debug: { revertStrings: "strip" } } },
      // Dock — gasless-relay escrow (OZ ReentrancyGuard → Cancun). Keeps revert
      // strings (small contract, asserted in tests).
      "contracts/Dock.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      // GearStore — OZ 5.6 ERC1155 uses mcopy → Cancun.
      "contracts/GearStore1155.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      // Resilient endowment vault — OZ 5.6 (SafeERC20/Ownable) → Cancun.
      "contracts/ResilientEndowmentVault.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      // Charity fee router — cookie-cutter pass-through, OZ 5.6 (SafeERC20/Ownable) → Cancun.
      "contracts/CharityFeeRouter.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      // Open pawn marketplace — OZ 5.6 (SafeERC20/IERC721/ReentrancyGuard) → Cancun.
      "contracts/PawnMarket.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
      // Robinhood Charity Suite (chain 4663). Keep revert strings — the redemption
      // -honesty test asserts the clear "insufficient vault liquidity" reason.
      // paris evmVersion: Robinhood Orbit chain; avoid mcopy/cancun assumptions.
      "contracts/CharityVaultMorpho.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" } },
      "contracts/LittleJohn.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" } },
      "contracts/test/MockMorphoVault.sol": { version: "0.8.26", settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" } },
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
    },
    // Read-only Base mainnet fork for e2e tests (test/e2e-fork-v9.js).
    // Enabled only when FORK_E2E=1 so normal `npx hardhat test` stays local.
    // RPC: reads FORK_RPC, else ALCHEMY_RPC env — no key committed to source.
    // Set ALCHEMY_RPC (or FORK_RPC) in env to run the FORK_E2E=1 tests.
    // FORK_RPC env overrides (e.g. drpc fallback). Block pinned for determinism.
    hardhat: process.env.FORK_RH === "1" ? {
      // Robinhood Chain (4663) mainnet fork — for the Charity Suite fork-test.
      // Forks live 4663 state so the real Morpho Steakhouse USDG vault + USDG
      // are present. Orbit L2; declare paris active from genesis at the fork
      // height (we only execute at/after the fork block, never replay history).
      // The live Morpho VaultV2 is solc 0.8.28 (uses push0/mcopy) — execute under
      // Cancun so its bytecode runs on the fork. RH is an Orbit chain that
      // supports these opcodes (the vault is deployed & working there).
      chainId: 4663,
      hardfork: "cancun",
      chains: {
        4663: {
          hardforkHistory: {
            cancun: 0
          }
        }
      },
      forking: {
        url: process.env.RH_RPC || "https://rpc.mainnet.chain.robinhood.com",
        blockNumber: process.env.FORK_BLOCK ? parseInt(process.env.FORK_BLOCK) : undefined
      }
    } : process.env.FORK_E2E === "1" ? {
      chainId: 8453,
      hardfork: "cancun",
      // Base isn't in Hardhat's built-in hardfork history, so teach it that the
      // pinned fork block is post-Cancun (avoids "No known hardfork" error).
      chains: {
        8453: {
          hardforkHistory: {
            cancun: 0
          }
        }
      },
      forking: {
        url: process.env.FORK_RPC || process.env.ALCHEMY_RPC,
        blockNumber: process.env.FORK_BLOCK ? parseInt(process.env.FORK_BLOCK) : 47510000
      }
    } : {}
  },
  sourcify: {
    // Sourcify v1 API is in a scheduled brownout (2026-07 → 2027-01); the installed plugin still
    // calls v1, so leave it OFF and verify via Etherscan v2 (below). Re-enable when the plugin ships v2.
    enabled: false,
  },
  etherscan: {
    // Etherscan API v2 (multichain): ONE key, chain selected by chainId. Base (8453) is built-in, so no
    // customChains needed. BASESCAN_API_KEY is an Etherscan-family key and works across the v2 endpoint.
    apiKey: process.env.BASESCAN_API_KEY || "",
  }
};
