// Multi-chain config for Unrugable Launcher (V5.8 — ecosystem-native)
export const CHAINS = {
  8453: {
    name: "Base",
    rpc:          "https://mainnet.base.org",
    teth:         "0x7D545427c8f548F3A00C1c09B5360BF3D4B842ef",
    tbtc:         "0x53B6De1726856c4615dc3B05d45993Bc1aa3403c",
    mft:          "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
    char:         "0x20b048fA035D5763685D695e66aDF62c5D9F5055",
    mftStable:    "0x85C78B8104D874d17e698b8c5678e3B8072347B1",
    usdc:         "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth:         "0x4200000000000000000000000000000000000006",
    btcLabel:     "TBTC",
    ethLabel:     "TETH",
    v3Factory:    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    pm:           "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    router:       "0x2626664c2603336E57B271c5C0b26F421741e481",
    wethUsdcFee:  500,
    mftWethFee:   10000,
    explorer:     "https://basescan.org",
    reactorImpl:  "0x9c7005Ba0b56e345CCF6CFa03B0c4C58bE0c9b86",
    factory:      "0xC7b8e67f9e3bEf5A4fc5BC2a7445a547DD635797"
  }
};

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function chainOptions() {
  return Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
}
