// Multi-chain config for Unrugable Launcher (V7 — Free launch, 2 pools, 1 reactor)
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
    reactorImpl:  "0x891587AD62bcBc6aceE9061D9C4306b9aB16cE45",
    factory:      "0x90297A8a1F9A7E35bbC9DF8C35Aa7F3FFBe9BDb2"
  }
};

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function chainOptions() {
  return Object.entries(CHAINS).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join("");
}
