// Multi-chain config for Unrugable Launcher (V5.9 — USDC → mftUSD → MfT floor + mftUSD walls)
export const CHAINS = {
  8453: {
    name: "Base",
    rpc:          "https://mainnet.base.org",
    mft:          "0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3",
    char:         "0x20b048fA035D5763685D695e66aDF62c5D9F5055",
    mftMoney:    "0xe3dd3881477c20C17Df080cEec0C1bD0C065A072",
    usdc:         "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    v3Factory:    "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    pm:           "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    router:       "0x2626664c2603336E57B271c5C0b26F421741e481",
    explorer:     "https://basescan.org",
    reactorImpl:  "0x82eC86F4536167A95eF302056162b1c8b9c7F4FA",
    factory:      "0x0cE80fC0Fb866aD807D6D24D01bd879ef79622E7"
  }
};

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function chainOptions() {
  return Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
}
