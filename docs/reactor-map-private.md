# Reactor Network — Private Map (experiments + bands)

## Band Tokens — v1 (1T supply, RENOUNCED)

### BTCband v1
- Reactor: 0x2879706E115150BBB9ffb5C432024264dEE0852F
- Token: 0x2988187BDa15c71eC8b3Eb9873457174733d2524
- 4 pools, feeds MycoPad:
  - BTCband/cbBTC
  - BTCband/USDC
  - BTCband/WETH
  - BTCband/MfT

### ETHband v1
- Reactor: 0x7018660EFBd7CfE3219388322417D405fC15b23B
- Token: 0x1248e04075b7a191931E6C8a2999d2Fae4d13BEa
- 4 pools, feeds MycoPad:
  - ETHband/WETH
  - ETHband/USDC
  - ETHband/cbBTC
  - ETHband/MfT

## Band Tokens — v2 (1M supply)

### BTCband v2
- Reactor: 0x038B87f2Abc1dcE269FF7DE4d3e721b5b57eD8cf
- Token: 0x11DFE729F1211904efB99F4d4a3f9FAF6C93CCB5
- 8 pools, feeds MycoPad:
  - BTCv2/cbBTC
  - BTCv2/USDC
  - BTCv2/WETH
  - BTCv2/MfT
  - BTCv2/AZUSD
  - BTCv2/TGN
  - BTCv2/POOP
  - BTCv2/BRUH

### ETHband v2
- Reactor: 0xeB02d1137342cD08C1c4bf61C188d86C5253b631
- Token: 0xd7ac547B8a5d7756F36b593287431Bad7Feb7864
- 7 pools, feeds MycoPad:
  - ETHv2/WETH
  - ETHv2/USDC
  - ETHv2/cbBTC
  - ETHv2/MfT
  - ETHv2/AZUSD
  - ETHv2/TGN
  - ETHv2/POOP

## Band Tokens — v3 (1M supply, SUPERSEDED)

### BB v3
- Reactor: 0x5375817c1798d43036d3b2DAAfaFB8e2247bAcF2
- Token: 0x4032bFe88eaeb0a9F5EBeFc14D66564DDf95CC29
- 6 pools, feeds MycoPad:
  - BB3/cbBTC
  - BB3/USDC
  - BB3/WETH
  - BB3/MfT
  - BB3/AZUSD
  - BB3/TGN

### EB v3
- Reactor: 0x361A4E356847c5a0C60B510b2531b640aC51f090
- Token: 0x73B98EA6359b1289306e0E16ad8d32d088ea1cC8
- 6 pools, feeds MycoPad:
  - EB3/WETH
  - EB3/USDC
  - EB3/cbBTC
  - EB3/MfT
  - EB3/AZUSD
  - EB3/TGN

## Band Tokens — v5 ($1 peg, 1M supply, RENOUNCED)

### BB v5
- Reactor: 0x3b31B8c9338ebFE2e737e5dd6361cEf0Bdc431e3
- Token: 0xf967bf3dccF8b6826F82de1781C98E61Bda3b106
- 10 pools, feeds EB relay:
  - BB/USDC ref
  - BB/cbBTC 500K sell wall
  - AZUSD/BB 50K sell wall
  - MfT/BB 50K sell wall
  - BB/EB cross 50K
  - BB/TGN 10K sell wall
  - POOP/BB 10K sell wall
  - BB/BRUH 10K sell wall
  - BURG/BB 10K sell wall
  - EGP/BB 10K sell wall

### EB v5
- Reactor: 0x2e06EB264dB2C7bcD8B9a216827b7D0eF3beACA2
- Token: 0x17a176Ab2379b86F1E65D79b03bD8c75981244D8
- 10 pools, feeds EB relay:
  - EB/USDC ref
  - WETH/EB 500K sell wall
  - EB/AZUSD 50K sell wall
  - EB/MfT 50K sell wall
  - BB/EB cross 50K
  - EB/TGN 10K sell wall
  - POOP/EB 10K sell wall
  - EB/BRUH 10K sell wall
  - BURG/EB 10K sell wall
  - EB/EGP 10K sell wall

## Tight Bands — BBT/EBT ($1 peg, 1M supply, 4 pools each)

### BBT (BTC Band Tight)
- Reactor: 0x6853679E3240E207031dDddDeaA8d131dEc0EC92
- Token: 0xc9435B119ebc921Ae75056C2871DFDDDca1b4a86
- 4 pools, feeds V1 Prime:
  - BBT/cbBTC — 600K, ticks -343000 to -342400
  - BBT/MfT — 200K, ticks -153200 to -152600
  - BBT/USDC — 100K, ticks 275800 to 276200
  - BBT/WETH — 100K, ticks 77000 to 77600

### EBT (ETH Band Tight)
- Reactor: 0xFA6823332D2Bc882a62Ceb4029Dde2573709698B
- Token: 0xF021001e98CaE23eb8E72EA8384F8D7b3FCeA59D
- 4 pools, feeds V1 Prime:
  - EBT/WETH — 600K, ticks 77000 to 77600
  - EBT/MfT — 200K, ticks -153200 to -152600
  - EBT/USDC — 100K, ticks 275600 to 276200
  - EBT/cbBTC — 100K, ticks 342400 to 343000

## WALL Experiment (single-tick BTC wall + USDC full-range)

### WALL
- Reactor: 0xBEe606A4Dd8c7027613FA300C517782A14A56490
- Token: 0x89B689462Cd57f14d5d1a714d102B3EE5F0dCEF2
- 1M supply, ~400K in wallet
- 3 pools, feeds V1 Prime:
  - WALL/cbBTC — 600K single tick sell wall (~$1), ticks -342800 to -342600, NFT #5063331
  - WALL/USDC — $1+1 WALL full range, NFT #5063361
  - WALL/USDC — $42+42 WALL full range, NFT #5063412
- Thesis: reactor buys WALL with cbBTC fees, ratchets price up toward sell wall. Once through, WALL runs.
- Has depositLiquidity() — can add to existing positions

## Broken Clones (SporeReactorV3 — _locked=0, permanently bricked)

### BRUH
- Reactor: 0xE9679341527B0e062F08c9efEa8764D46030Bfaf
- Token: 0xe61B190c0F0070E07De3Bb4829FE5Fdcf7d934F1
- 4 pools, CANNOT FIRE:
  - BRUH/AZUSD
  - BRUH/cbBTC
  - BRUH/WETH
  - BRUH/MfT

### ILM
- Reactor: 0x885f90b0fcc10AD6d3257Df851eda4c78f38c5A4
- Token: 0x2C74505c50f5db70DAeD7422D2F31615c78f485c
- 4 pools, CANNOT FIRE:
  - ILM/AZUSD
  - ILM/BB_v3
  - ILM/EB_v3
  - ILM/MfT

### RT
- Reactor: 0x3FE916c7CB6354eAF8ee49427380740bEe2b061a
- Token: 0x161CB0EA398D52a3177a12b26d8c2be8782DCcEC
- 4 pools, CANNOT FIRE:
  - RT/AZUSD
  - RT/BB_v5
  - RT/EB_v5
  - RT/MfT

### SC
- Reactor: 0xB7C5b050E0545b5b2b3015111E4f197641F0D3Fa
- Token: 0x640AEB7263EDBAd0A840F2F8C751949Fc1d48B18
- 4 pools, CANNOT FIRE:
  - SC/AZUSD
  - SC/BB_v5
  - SC/EB_v5
  - SC/MfT

## Private Flow
```
BTCband v1 (4p) ──┐
ETHband v1 (4p) ──┤
BTCband v2 (8p) ──┤
ETHband v2 (7p) ──┼──> MycoPad (5p)
BB v3 (6p) ───────┤
EB v3 (6p) ───────┘

BB v5 (10p) ──┐
              ├──> EB relay (10p) -> MycoPad
EB v5 (10p) ──┘

BBT (4p) ──┐
EBT (4p) ──┼──> V1 Prime
WALL (3p) ─┘

BRUH (4p) -> V1 Prime (BRICKED)
ILM/RT/SC (4p each) -> MycoPad (BRICKED)
```

## Unused
- Reactor Prime V2: 0xB4dD1350738Ce8c01Cc229F14d7135a60a51634a (0 pools, UNUSED)
