// Multi-chain config for MycoPad
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
    explorer:   "https://basescan.org",
    factory:    "0xbfE4fa5B630d662c375b8F06CF26e75f91CcA4d5"
  }
};

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function chainOptions() {
  return Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
}
