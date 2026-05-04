// Multi-chain config for MycoPad
export const CHAINS = {
  8453: {
    name: "Base",
    weth:         "0x4200000000000000000000000000000000000006",
    usdc:         "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    azusd:        "0x3595ca37596D5895B70EFAB592ac315D5B9809B2",
    wrappedBtc:   "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    mft:          "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
    bb:           "0xf967bf3dccF8b6826F82de1781C98E61Bda3b106",
    eb:           "0x17a176Ab2379b86F1E65D79b03bD8c75981244D8",
    btcLabel:     "BB",
    ethLabel:     "EB",
    v3Factory:    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    pm:           "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    router:       "0x2626664c2603336E57B271c5C0b26F421741e481",
    aeroRouter:   "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5",
    wethUsdcFee:  500,
    aeroTickSpacing: 50,
    wethBtcFee:   500,
    btcBbFee:     10000,
    wethEbFee:    10000,
    mftPriceFee:  10000,
    explorer:     "https://basescan.org",
    reactorImpl:  "0x6E46Db4B596F4f1dc0d4b6A22B7F924FACd62709",
    factory:      "0x51eF41E0730c0e607950421e1EE113b089867d3e"
  }
};

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function chainOptions() {
  return Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
}
