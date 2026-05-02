// Multi-chain config for MfT Launch Platform
export const CHAINS = {
  8453: {
    name: "Base",
    weth:       "0x4200000000000000000000000000000000000006",
    usdc:       "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    wrappedBtc: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    btcLabel:   "cbBTC",
    v3Factory:  "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    pm:         "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    router:     "0x2626664c2603336E57B271c5C0b26F421741e481",
    wethUsdcFee: 500,
    wethBtcFee:  3000,
    explorer:   "https://basescan.org"
  },
  1: {
    name: "Ethereum",
    weth:       "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    usdc:       "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    wrappedBtc: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    btcLabel:   "WBTC",
    v3Factory:  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    pm:         "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    router:     "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    wethUsdcFee: 500,
    wethBtcFee:  3000,
    explorer:   "https://etherscan.io"
  },
  42161: {
    name: "Arbitrum",
    weth:       "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    usdc:       "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    wrappedBtc: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    btcLabel:   "WBTC",
    v3Factory:  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    pm:         "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    router:     "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    wethUsdcFee: 500,
    wethBtcFee:  500,
    explorer:   "https://arbiscan.io"
  },
  10: {
    name: "Optimism",
    weth:       "0x4200000000000000000000000000000000000006",
    usdc:       "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    wrappedBtc: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    btcLabel:   "WBTC",
    v3Factory:  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    pm:         "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    router:     "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    wethUsdcFee: 500,
    wethBtcFee:  3000,
    explorer:   "https://optimistic.etherscan.io"
  },
  137: {
    name: "Polygon",
    weth:       "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    usdc:       "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    wrappedBtc: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    btcLabel:   "WBTC",
    v3Factory:  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    pm:         "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    router:     "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    wethUsdcFee: 500,
    wethBtcFee:  3000,
    explorer:   "https://polygonscan.com"
  }
};

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function chainOptions() {
  return Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name} (${id})</option>`).join("");
}
