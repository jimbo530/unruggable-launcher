// Multi-chain config for Unruggable Launcher
export const CHAINS = {
  8453: {
    name: "Base",
    weth:         "0x4200000000000000000000000000000000000006",
    usdc:         "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    azusd:        "0x3595ca37596D5895B70EFAB592ac315D5B9809B2",
    wrappedBtc:   "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    mft:          "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
    char:         "0x20b048fA035D5763685D695e66aDF62c5D9F5055",
    btcLabel:     "BTC",
    ethLabel:     "ETH",
    v3Factory:    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    pm:           "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    router:       "0x2626664c2603336E57B271c5C0b26F421741e481",
    aeroRouter:   "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5",
    wethUsdcFee:  500,
    aeroTickSpacing: 50,
    wethBtcFee:   500,
    mftPriceFee:  10000,
    explorer:     "https://basescan.org",
    reactorImpl:  "0x82eC86F4536167A95eF302056162b1c8b9c7F4FA",
    factory:      "0x2e0b20a4FFEaCAcB8D3CD0cF6b9bBE6660c4262e"
  }
};

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function chainOptions() {
  return Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
}
