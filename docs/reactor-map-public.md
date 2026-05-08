# Reactor Network — Public Map

## MfT V1 Prime (top of chain)
- Address: 0xed3aE91b2bb22307c07438EEebA2500C18EABcFE
- Token: MfT
- 12 pools:
  - AZUSD/MfT (fee:500)
  - AZUSD/MfT (fee:10000)
  - MfT/TGN
  - MfT/cbBTC
  - ecowealth/MfT
  - CHAR/MfT
  - axlREGEN/MfT
  - BURGERS/MfT
  - MfT/EGP
  - POOP/MfT
  - BB/MfT
  - EB/MfT
- Receives fuel from: EGP, CHAR, BURGERS, AZUSD, WALL, BBT, EBT

## MycoPad Reactor (launch hub)
- Address: 0xF5B9Fc40080aAcC262f078eCE374A2268dcdb045
- Token: MfT
- 5 pools
- Receives fuel from: EB relay, all band reactors, launched tokens

## EB Relay
- Address: 0xC28e64551816535d9ef06CE95844F2b5317353bA
- 10 pools
- Receives fuel from: BB v5, EB v5
- Feeds: MycoPad

## Chain Reactors (feed V1 Prime)

### CHAR
- Address: 0xc2eBe90fB9bC7897f06DC00666951Fa9a49A397A
- Token: CHAR (0x20b048fA035D5763685D695e66aDF62c5D9F5055)
- 8 pools:
  - CHAR/AZUSD
  - POOP/CHAR
  - BURGERS/CHAR
  - CHAR/TGN
  - CHAR/EGP
  - CHAR/BB
  - CHAR/EB
  - CHAR/cbBTC

### BURGERS
- Address: 0xc858026Ec5D30280137032BC6EA86F46ea23C2CA
- Token: BURGERS (0x06A05043eb2C1691b19c2C13219dB9212269dDc5)
- 9 pools:
  - BURGERS/AZUSD
  - BURGERS/POOP
  - BURGERS/CHAR
  - BURGERS/TGN
  - BURGERS/EGP
  - BURGERS/BB
  - BURGERS/EB
  - BURGERS/cbBTC
  - (1 additional)

### EGP
- Address: 0x10A710fced92eB096F796F43BCCFb60884c13819
- Token: EGP (0xc1BA76771bbF0dD841347630E57c793F9d5ACcEe)
- 9 pools:
  - EGP/CHAR
  - EGP/BURGERS
  - TGN/EGP
  - AZUSD/EGP
  - POOP/EGP
  - BB/EGP
  - EB/EGP
  - EGP/cbBTC
  - (1 additional)

### AZUSD
- Address: 0xD8AFb7caD1f8A3Ddc4E16c1516a94949eb119281
- Token: AZUSD (0x3595ca37596D5895B70EFAB592ac315D5B9809B2)
- 5 pools:
  - MfT/AZUSD
  - POOP/AZUSD
  - cbBTC/AZUSD
  - AZUSD/BB
  - AZUSD/EB

### TGN (RENOUNCED)
- Address: 0xc3f09dAEF814177E52B4C04ec2872B564a36989D
- Token: TGN (0xD75dfa972C6136f1c594Fec1945302f885E1ab29)
- 4 pools
- Feeds: AZUSD

### ecowealth
- Address: 0xc7E739f223934C5F69EBA36BcDf808c4379b1985
- Token: ecowealth (0x170dc0ca26f1247ced627d8abcafa90ecf1e1519)
- 4 pools
- Feeds: BB v5

## Launched Token Reactors (feed MycoPad)

### MTEST (first V4 launch)
- Reactor: 0xAb2d...
- CHAR Reactor: 0x237E...
- 6+3 pools, WORKING

## EARTH (standalone)
- Reactor: 0x424D...
- 9 pools:
  - EARTH/WETH
  - EARTH/USDC
  - EARTH/cbBTC
  - EARTH/MfT
  - EARTH/CHAR
  - EARTH/POOP
  - EARTH/BURGERS
  - EARTH/TGN
  - EARTH/AZUSD
- Own VPS keeper, 2.4hr interval

## Flow
```
ecowealth -> BB v5 ─┐
                     ├─> EB relay -> MycoPad
             EB v5 ─┘

CHAR ────┐
BURGERS ─┤
EGP ─────┼──> V1 Prime (12 pools)
AZUSD ───┤
  ^      │
  TGN ───┘

Launched tokens -> MycoPad -> (fuel accumulates)

EARTH (standalone, own VPS keeper)
```
