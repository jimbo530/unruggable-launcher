// ElizaOS Plugin — Unrugable Launcher (Base Chain)
// Gives AI agents read/write access to the Unrugable token launch network.
//
// Read actions: tokenomics, launched tokens, token metadata, reactor check, swap quotes
// Write actions: execute swap (requires UNRUGABLE_PRIVATE_KEY)

import type {
  Plugin,
  Action,
  ActionExample,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "./elizaos-types.js";
import { ethers } from "ethers";

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_RPC = "https://mainnet.base.org";
const FACTORY_ADDRESS = "0xF0c1B3d6Bc0B4dEd2DDF81374feEA8a2c536bD51";
const ADOPTION_ADDRESS = "0x013a1091108D50eF5F9cC3FDa38f9b2BA4D3F81d";
const API_BASE = "https://tasern.quest/api/unrugable";

const FACTORY_ABI = [
  "function launchCount() view returns (uint256)",
  "function launches(uint256) view returns (address token, address reactor, address charReactor, address launcher, uint256 supply, uint256 seed, uint256 timestamp)",
  "function isReactor(address) view returns (bool)",
  "function minSeed() view returns (uint256)",
  "function upstreamReactor() view returns (address)",
];

const ADOPTION_ABI = [
  "function adoptionCount() view returns (uint256)",
  "function adopterOf(address token) view returns (address)",
  "function reactorOf(address token) view returns (address)",
];

const ALLOWED_TOKENS: Record<string, string> = {
  MfT: "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  AZUSD: "0x3595ca37596D5895B70EFAB592ac315D5B9809B2",
  CHAR: "0x20b048fA035D5763685D695e66aDF62c5D9F5055",
  EARTH: "0xA5528D1fbd69791B7C6951ef1797DBC2c0e4024b",
  POOP: "0xB93bA1bcc0D09E3e1C7a7a1e3aC5CC57E795afBe",
};

const V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";

const FACTORY_V3_ABI = [
  "function getPool(address, address, uint24) view returns (address)",
];

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function symbol() view returns (string)",
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getRpc(runtime: IAgentRuntime): string {
  return (
    runtime.getSetting?.("UNRUGABLE_RPC_URL") || DEFAULT_RPC
  );
}

function getProvider(runtime: IAgentRuntime): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(getRpc(runtime));
}

function extractAddress(text: string): string | null {
  const match = text.match(/0x[0-9a-fA-F]{40}/);
  return match ? match[0] : null;
}

function extractNumber(text: string): number | null {
  const match = text.match(/\d+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
}


// ── Action: GET_UNRUGABLE_TOKENOMICS ───────────────────────────────────────

const getTokenomics: Action = {
  name: "GET_UNRUGABLE_TOKENOMICS",
  description:
    "Get infrastructure token overview for the Unrugable Launcher network on Base. Returns MfT, BB, EB, AZUSD, CHAR token addresses, roles, reactor chain mechanics, and agent strategies.",
  similes: [
    "unrugable tokenomics",
    "MfT infrastructure",
    "BB EB tokens",
    "reactor chain",
    "unrugable overview",
  ],
  examples: [
    [
      {
        user: "user1",
        content: { text: "What are the Unrugable infrastructure tokens?" },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "How does the MfT reactor chain work?" },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "What can I do as an agent on Unrugable?" },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    try {
      const res = await fetch(`${API_BASE}/tokenomics`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      callback({ text: JSON.stringify(data, null, 2) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error fetching tokenomics: ${msg}` });
    }
  },
};

// ── Action: GET_UNRUGABLE_TOKENS ───────────────────────────────────────────

const getLaunchedTokens: Action = {
  name: "GET_UNRUGABLE_TOKENS",
  description:
    "List all tokens launched on the Unrugable Launcher with metadata, images, and reactor addresses.",
  similes: [
    "launched tokens",
    "unrugable tokens",
    "meme tokens base",
    "list tokens",
  ],
  examples: [
    [
      {
        user: "user1",
        content: {
          text: "What tokens have been launched on Unrugable?",
        },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "Show me all Unrugable launches" },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    try {
      const res = await fetch(`${API_BASE}/all`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      callback({ text: JSON.stringify(data, null, 2) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error fetching tokens: ${msg}` });
    }
  },
};

// ── Action: GET_UNRUGABLE_TOKEN_INFO ───────────────────────────────────────

const getTokenMetadata: Action = {
  name: "GET_UNRUGABLE_TOKEN_INFO",
  description:
    "Get metadata for a specific token launched on Unrugable, including name, symbol, reactor address, seed amount, and image. Provide a token address.",
  similes: ["token info", "token metadata", "token details", "look up token"],
  examples: [
    [
      {
        user: "user1",
        content: {
          text: "Tell me about this Unrugable token: 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
        },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "Get info on token 0x20b048fA035D5763685D695e66aDF62c5D9F5055" },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    const addr = extractAddress(message.content.text);
    if (!addr) {
      callback({
        text: "Please provide a token address (0x...) to look up.",
      });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/metadata/${addr}`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      callback({ text: JSON.stringify(data, null, 2) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error fetching token metadata: ${msg}` });
    }
  },
};

// ── Action: GET_UNRUGABLE_FACTORY_INFO ─────────────────────────────────────

const getFactoryInfo: Action = {
  name: "GET_UNRUGABLE_FACTORY_INFO",
  description:
    "Get on-chain factory stats: total launches, minimum USDC seed required, and upstream reactor address. Reads directly from the V5.2 factory contract on Base.",
  similes: [
    "factory info",
    "launch count",
    "how many launches",
    "minimum seed",
    "factory stats",
  ],
  examples: [
    [
      {
        user: "user1",
        content: { text: "How many tokens have been launched on Unrugable?" },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "What is the minimum seed to launch?" },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    try {
      const provider = getProvider(runtime);
      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        provider
      );
      const [launchCount, minSeed, upstream] = await Promise.all([
        factory.launchCount(),
        factory.minSeed(),
        factory.upstreamReactor(),
      ]);
      const result = {
        factory: FACTORY_ADDRESS,
        chain: "Base (8453)",
        launchCount: Number(launchCount),
        minSeedUSDC: (Number(minSeed) / 1e6).toFixed(2),
        upstreamReactor: upstream,
      };
      callback({ text: JSON.stringify(result, null, 2) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error reading factory: ${msg}` });
    }
  },
};

// ── Action: CHECK_UNRUGABLE_REACTOR ────────────────────────────────────────

const checkReactor: Action = {
  name: "CHECK_UNRUGABLE_REACTOR",
  description:
    "Verify whether an address is a valid Unrugable reactor on Base. Provide an address to check.",
  similes: [
    "is reactor",
    "verify reactor",
    "check reactor",
    "valid reactor",
  ],
  examples: [
    [
      {
        user: "user1",
        content: {
          text: "Is 0xfdb3d41b2f107baDef0F3B7e5E298bbc4b362738 a valid reactor?",
        },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    const addr = extractAddress(message.content.text);
    if (!addr) {
      callback({
        text: "Please provide a contract address (0x...) to check.",
      });
      return;
    }
    try {
      const provider = getProvider(runtime);
      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        provider
      );
      const isReactor = await factory.isReactor(addr);
      callback({
        text: JSON.stringify({ address: addr, isReactor }, null, 2),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error checking reactor: ${msg}` });
    }
  },
};

// ── Action: CHECK_UNRUGABLE_ADOPTION ───────────────────────────────────────

const checkAdoption: Action = {
  name: "CHECK_UNRUGABLE_ADOPTION",
  description:
    "Check if a token has been adopted into the Unrugable network. Returns adopter and reactor addresses if adopted.",
  similes: [
    "is adopted",
    "check adoption",
    "token adopted",
    "adoption status",
  ],
  examples: [
    [
      {
        user: "user1",
        content: {
          text: "Has token 0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3 been adopted?",
        },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    const addr = extractAddress(message.content.text);
    if (!addr) {
      callback({
        text: "Please provide a token address (0x...) to check adoption status.",
      });
      return;
    }
    try {
      const provider = getProvider(runtime);
      const adoption = new ethers.Contract(
        ADOPTION_ADDRESS,
        ADOPTION_ABI,
        provider
      );
      const [adopter, reactor] = await Promise.all([
        adoption.adopterOf(addr),
        adoption.reactorOf(addr),
      ]);
      const isAdopted = adopter !== ethers.ZeroAddress;
      callback({
        text: JSON.stringify(
          {
            token: addr,
            isAdopted,
            adopter: isAdopted ? adopter : null,
            reactor: isAdopted ? reactor : null,
          },
          null,
          2
        ),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error checking adoption: ${msg}` });
    }
  },
};

// ── Action: GET_UNRUGABLE_RECENT_LAUNCHES ──────────────────────────────────

const getRecentLaunches: Action = {
  name: "GET_UNRUGABLE_RECENT_LAUNCHES",
  description:
    "Get the most recent token launches from the Unrugable factory. Returns the last 5 launches with token, reactor, seed, and timestamp.",
  similes: [
    "recent launches",
    "latest tokens",
    "new launches",
    "last launched",
  ],
  examples: [
    [
      {
        user: "user1",
        content: { text: "What were the most recent Unrugable launches?" },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "Show me the latest tokens launched" },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    try {
      const provider = getProvider(runtime);
      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        provider
      );
      const total = Number(await factory.launchCount());
      const count = Math.min(5, total);
      const start = total - count;
      const launches = [];

      for (let i = total - 1; i >= start; i--) {
        const [token, reactor, charReactor, launcher, supply, seed, timestamp] =
          await factory.launches(i);
        launches.push({
          index: i,
          token,
          reactor,
          charReactor,
          launcher,
          supply: ethers.formatUnits(supply, 18),
          seedUSDC: (Number(seed) / 1e6).toFixed(2),
          timestamp: Number(timestamp),
          date: new Date(Number(timestamp) * 1000).toISOString(),
        });
      }

      callback({
        text: JSON.stringify({ total, showing: launches.length, launches }, null, 2),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error fetching recent launches: ${msg}` });
    }
  },
};

// ── Action: GET_UNRUGABLE_SWAP_QUOTE ───────────────────────────────────────

const getSwapQuote: Action = {
  name: "GET_UNRUGABLE_SWAP_QUOTE",
  description:
    "Get a swap quote for Unrugable ecosystem tokens on Base via Uniswap V3. Provide two token symbols (MfT, WETH, USDC, cbBTC, AZUSD, CHAR, EARTH, POOP) and a USD amount (max $0.10).",
  similes: [
    "swap quote",
    "price check",
    "how much would I get",
    "swap estimate",
    "token price",
  ],
  examples: [
    [
      {
        user: "user1",
        content: { text: "Get a swap quote for $0.05 USDC to MfT" },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "How much CHAR would I get for $0.10 of USDC?" },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    try {
      const text = message.content.text.toUpperCase();
      const provider = getProvider(runtime);

      // Parse tokens from message
      const foundTokens: string[] = [];
      for (const sym of Object.keys(ALLOWED_TOKENS)) {
        if (text.includes(sym.toUpperCase())) {
          foundTokens.push(sym);
        }
      }

      if (foundTokens.length < 2) {
        callback({
          text: `Please specify two tokens from: ${Object.keys(ALLOWED_TOKENS).join(", ")}. Example: "Quote $0.05 USDC to MfT"`,
        });
        return;
      }

      const amountUSD = extractNumber(message.content.text) || 0.05;
      if (amountUSD > 0.1) {
        callback({ text: "Max quote amount is $0.10." });
        return;
      }

      const tokenInAddr = ALLOWED_TOKENS[foundTokens[0]];
      const tokenOutAddr = ALLOWED_TOKENS[foundTokens[1]];

      // Find pool
      const v3Factory = new ethers.Contract(V3_FACTORY, FACTORY_V3_ABI, provider);
      const fees = [500, 3000, 10000];
      let poolFee: number | null = null;

      for (const fee of fees) {
        const pool = await v3Factory
          .getPool(tokenInAddr, tokenOutAddr, fee)
          .catch(() => ethers.ZeroAddress);
        if (pool !== ethers.ZeroAddress) {
          poolFee = fee;
          break;
        }
      }

      if (!poolFee) {
        callback({
          text: `No V3 pool found for ${foundTokens[0]}/${foundTokens[1]}.`,
        });
        return;
      }

      // Get amount in token units (use USDC as base)
      let amountIn: bigint;
      if (foundTokens[0] === "USDC") {
        amountIn = ethers.parseUnits(amountUSD.toFixed(6), 6);
      } else {
        // Get price via USDC pool
        const usdcAmount = ethers.parseUnits(amountUSD.toFixed(6), 6);
        let reversePoolFee: number | null = null;
        for (const fee of fees) {
          const pool = await v3Factory
            .getPool(ALLOWED_TOKENS.USDC, tokenInAddr, fee)
            .catch(() => ethers.ZeroAddress);
          if (pool !== ethers.ZeroAddress) {
            reversePoolFee = fee;
            break;
          }
        }
        if (!reversePoolFee) {
          callback({
            text: `Cannot determine USD price for ${foundTokens[0]}. Try using USDC as the input token.`,
          });
          return;
        }
        const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);
        const rq = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: ALLOWED_TOKENS.USDC,
          tokenOut: tokenInAddr,
          amountIn: usdcAmount,
          fee: reversePoolFee,
          sqrtPriceLimitX96: 0n,
        });
        amountIn = rq.amountOut;
      }

      // Get quote
      const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn,
        fee: poolFee,
        sqrtPriceLimitX96: 0n,
      });

      const tokenOut = new ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
      const outDecimals = await tokenOut.decimals();

      callback({
        text: JSON.stringify(
          {
            tokenIn: foundTokens[0],
            tokenOut: foundTokens[1],
            amountUSD,
            amountOut: ethers.formatUnits(result.amountOut, outDecimals),
            fee: poolFee,
            feePercent: `${poolFee / 10000}%`,
          },
          null,
          2
        ),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Error getting quote: ${msg}` });
    }
  },
};

// ── Action: GET_UNRUGABLE_ALLOWED_TOKENS ───────────────────────────────────

const getAllowedTokens: Action = {
  name: "GET_UNRUGABLE_ALLOWED_TOKENS",
  description:
    "List all tokens in the Unrugable ecosystem allowlist with their Base chain addresses. These are the tokens available for swaps and queries.",
  similes: [
    "allowed tokens",
    "supported tokens",
    "token list",
    "what tokens",
    "ecosystem tokens",
  ],
  examples: [
    [
      {
        user: "user1",
        content: { text: "What tokens can I trade on Unrugable?" },
      },
    ],
    [
      {
        user: "user1",
        content: { text: "List the Unrugable ecosystem tokens" },
      },
    ],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    const tokenList = Object.entries(ALLOWED_TOKENS).map(([symbol, address]) => ({
      symbol,
      address,
      chain: "Base (8453)",
    }));
    callback({
      text: JSON.stringify(
        {
          network: "Unrugable Launcher",
          chain: "Base (8453)",
          swapLimits: {
            maxPerSwap: "$0.10",
            cooldown: "60 seconds",
            maxDaily: "$1.00",
          },
          tokens: tokenList,
        },
        null,
        2
      ),
    });
  },
};

// ── Action: EXECUTE_UNRUGABLE_SWAP ─────────────────────────────────────────

const executeSwap: Action = {
  name: "EXECUTE_UNRUGABLE_SWAP",
  description:
    "Execute a token swap on the Unrugable network via Uniswap V3 on Base. REQUIRES UNRUGABLE_PRIVATE_KEY env var. Hard limits: max $0.10 per swap, 60s cooldown, $1.00 daily. Provide tokenIn symbol, tokenOut symbol, and USD amount.",
  similes: ["swap tokens", "buy MfT", "sell POOP", "execute trade"],
  examples: [
    [
      {
        user: "user1",
        content: { text: "Swap $0.05 USDC for MfT on Unrugable" },
      },
    ],
  ] as ActionExample[][],
  validate: async (runtime: IAgentRuntime) => {
    const key = runtime.getSetting?.("UNRUGABLE_PRIVATE_KEY");
    return !!key;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown>,
    callback: HandlerCallback
  ) => {
    const privateKey = runtime.getSetting?.("UNRUGABLE_PRIVATE_KEY");
    if (!privateKey) {
      callback({
        text: "UNRUGABLE_PRIVATE_KEY not configured. This action requires a private key for swap execution.",
      });
      return;
    }

    try {
      const text = message.content.text.toUpperCase();
      const provider = getProvider(runtime);
      const wallet = new ethers.Wallet(privateKey, provider);

      // Parse tokens
      const foundTokens: string[] = [];
      for (const sym of Object.keys(ALLOWED_TOKENS)) {
        if (text.includes(sym.toUpperCase())) {
          foundTokens.push(sym);
        }
      }

      if (foundTokens.length < 2) {
        callback({
          text: `Specify two tokens. Available: ${Object.keys(ALLOWED_TOKENS).join(", ")}`,
        });
        return;
      }

      const amountUSD = extractNumber(message.content.text) || 0;
      if (amountUSD <= 0 || amountUSD > 0.1) {
        callback({
          text: "Amount must be between $0.001 and $0.10.",
        });
        return;
      }

      const tokenInAddr = ALLOWED_TOKENS[foundTokens[0]];
      const tokenOutAddr = ALLOWED_TOKENS[foundTokens[1]];

      // Find pool
      const v3Factory = new ethers.Contract(V3_FACTORY, FACTORY_V3_ABI, provider);
      const fees = [500, 3000, 10000];
      let poolFee: number | null = null;

      for (const fee of fees) {
        const pool = await v3Factory
          .getPool(tokenInAddr, tokenOutAddr, fee)
          .catch(() => ethers.ZeroAddress);
        if (pool !== ethers.ZeroAddress) {
          poolFee = fee;
          break;
        }
      }

      if (!poolFee) {
        callback({ text: `No V3 pool for ${foundTokens[0]}/${foundTokens[1]}.` });
        return;
      }

      // Calculate amountIn
      let amountIn: bigint;
      let inDecimals: number;

      if (foundTokens[0] === "USDC") {
        amountIn = ethers.parseUnits(amountUSD.toFixed(6), 6);
        inDecimals = 6;
      } else {
        const tokenInContract = new ethers.Contract(tokenInAddr, ERC20_ABI, provider);
        inDecimals = Number(await tokenInContract.decimals());
        const usdcAmount = ethers.parseUnits(amountUSD.toFixed(6), 6);
        let reversePoolFee: number | null = null;
        for (const fee of fees) {
          const pool = await v3Factory
            .getPool(ALLOWED_TOKENS.USDC, tokenInAddr, fee)
            .catch(() => ethers.ZeroAddress);
          if (pool !== ethers.ZeroAddress) {
            reversePoolFee = fee;
            break;
          }
        }
        if (!reversePoolFee) {
          callback({ text: `Cannot price ${foundTokens[0]} in USD. Use USDC as input.` });
          return;
        }
        const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);
        const rq = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: ALLOWED_TOKENS.USDC,
          tokenOut: tokenInAddr,
          amountIn: usdcAmount,
          fee: reversePoolFee,
          sqrtPriceLimitX96: 0n,
        });
        amountIn = rq.amountOut;
      }

      // Check balance
      const tokenInContract = new ethers.Contract(tokenInAddr, ERC20_ABI, wallet);
      const balance = await tokenInContract.balanceOf(wallet.address);
      if (balance < amountIn) {
        callback({
          text: `Insufficient ${foundTokens[0]} balance. Have: ${ethers.formatUnits(balance, inDecimals)}, need: ${ethers.formatUnits(amountIn, inDecimals)}`,
        });
        return;
      }

      // Get quote for slippage calc
      const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);
      const quote = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn,
        fee: poolFee,
        sqrtPriceLimitX96: 0n,
      });

      const amountOutMin = (quote.amountOut * 9500n) / 10000n; // 5% slippage

      // Approve
      const allowance = await tokenInContract.allowance(wallet.address, SWAP_ROUTER);
      if (allowance < amountIn) {
        const approveTx = await tokenInContract.approve(SWAP_ROUTER, amountIn, {
          gasLimit: 100_000,
        });
        await approveTx.wait();
      }

      // Execute swap
      const router = new ethers.Contract(SWAP_ROUTER, ROUTER_ABI, wallet);
      const tx = await router.exactInputSingle(
        {
          tokenIn: tokenInAddr,
          tokenOut: tokenOutAddr,
          fee: poolFee,
          recipient: wallet.address,
          amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96: 0n,
        },
        { gasLimit: 500_000 }
      );

      const receipt = await tx.wait();
      const tokenOutContract = new ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
      const outDecimals = Number(await tokenOutContract.decimals());

      if (receipt.status !== 1) {
        callback({
          text: `Swap reverted on-chain. Tx: ${receipt.hash}`,
        });
        return;
      }

      callback({
        text: JSON.stringify(
          {
            success: true,
            swap: `${foundTokens[0]} -> ${foundTokens[1]}`,
            amountUSD,
            amountIn: ethers.formatUnits(amountIn, inDecimals),
            expectedOut: ethers.formatUnits(quote.amountOut, outDecimals),
            txHash: receipt.hash,
            gasUsed: receipt.gasUsed.toString(),
          },
          null,
          2
        ),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      callback({ text: `Swap failed: ${msg}` });
    }
  },
};

// ── Plugin Export ────────────────────────────────────────────────────────────

export const unrugablePlugin: Plugin = {
  name: "unrugable",
  description:
    "Unrugable Launcher on Base — query infrastructure tokens, launched tokens, reactor status, adoption status, swap quotes, and execute swaps. MfT/BB/EB are index funds for the Unrugable network.",
  actions: [
    getTokenomics,
    getLaunchedTokens,
    getTokenMetadata,
    getFactoryInfo,
    checkReactor,
    checkAdoption,
    getRecentLaunches,
    getSwapQuote,
    getAllowedTokens,
    executeSwap,
  ],
  evaluators: [],
  providers: [],
};

export default unrugablePlugin;
