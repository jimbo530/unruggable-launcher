# base-crew-meta — dynamic Base crew NFTs + ship flags

Additive, **local** Base variant of the live Solana `crew-render` paper-doll service.
No chain writes, no VPS edits, no deploy. Reuses the same compositor + closet + catalog
concepts so a Base ship's 100-NFT crew can render as **dynamic paper-doll characters**,
and launched ships can serve an **uploaded flag** as their token metadata image.

```
node src/selftest.js      # no-server smoke test (all flows)
npm run server            # http://localhost:8791
```

Crew id scheme (Base): `"<distributorAddress>:<tokenId>"`, e.g. `0xabc…def:7`.
Each ship deploys its own `FeeShareDistributor` (ERC-721, ids 0..99), so the crew key
is the distributor address + the NFT token id.

## Endpoints

Crew (dynamic ERC-721 NFT):
- `GET  /crew/render/<dist>:<id>.png` — composited paper-doll PNG (the NFT image)
- `GET  /crew/meta/<dist>:<id>` — ERC-721 metadata JSON (`image` = the render URL)
- `GET  /crew/look|inventory|catalog`
- `POST /crew/base|color|equip|stickers|grant|stats|name|shipflag`

Gear → look (GearStore1155 bridge):
- `POST /crew/gear/grant {buyer,gearId}` — grant the look the gear unlocks
- `POST /crew/gear/equip {key,gearId,owner?}` — equip it onto a crew member

Ship flag (ship-token metadata):
- `POST /ship/flag/:address {image}` — store/replace the ship's flag (base64/data URL)
- `GET  /ship/flag/:address.png` — the stored flag PNG
- `GET  /ship/meta/:address` — EIP-7572 ship metadata (`image` = the flag)

## Assets

The compositor loads art from `assets/<bucket>/<file>` (bucket = base | items | gear
| stickers), same filenames as `crew-render-ref`. Real Grok art lives at
`D:\grok-sprites\acorn\`; `src/asset-manifest.js` maps catalog ids onto it and flags
what still needs a colorkey cutout.

```
npm run stage-assets            # copy READY art into assets/, print the cutout TODO
npm run stage-assets -- --dry   # report only, copy nothing
```

Status (probed 2026-06-22):
- **items + stickers — READY & STAGED** (19 files). `items/cut/*` and `stickers/cut/*`
  are already cut out (RGBA, transparent corners); `stage-assets` copies them in and
  re-checks alpha, refusing to copy any opaque mislabel.
- **gear — NEEDS CUTOUT** (13 files on magenta bg + dark rounded corners): the two
  catalog pieces (`crown-king`, `cape-royal`) plus 11 extras (a mayor/royal/reeve
  wardrobe). `stage-assets` prints the exact `ffmpeg` colorkey command per file.
- **base (acorn boy/girl) — NEEDS CUTOUT** (`acornboy-new-raw.png`, `girl-clean.png`,
  opaque tan bg). After cutout, run the live `alpha-repair` step too (cap/face matte).
  Until then the crew renders a **labelled placeholder** body. FASTEST PATH: reuse the
  already-transparent acorn base from `crew-render-ref` (same character).

Extra ready-cut items (`backpack`, `cowboy-hat`, `flower-crown`, `headphones`,
`fishing-rod`, `pickaxe`, `wand`, `watering-can`) are in the manifest's `ITEMS_EXTRA`
— one-line catalog adds when wanted. Crew flag badge art goes in `flags/<slug>.png`;
ship flags are stored as `flags/ship-<address>.png` by the `/ship/flag` endpoint.

## FeeShareDistributor URI verdict

`FeeShareDistributor` is a plain OpenZeppelin v5 `ERC721` with **no `tokenURI`
override, no `_baseURI`, and no setter**. Its `tokenURI(id)` therefore returns an
**empty string**, and there is no admin path to change it. **Already-deployed crew
NFTs are frozen and CANNOT be pointed at this render service.** Dynamic crew art
requires the **NEXT Shipyard version** whose distributor either (a) overrides
`tokenURI(id) => baseURI + dist + ":" + id` against this service, or (b) exposes an
owner-settable `baseURI`. See the task report for the exact go-live wiring.

## Ship flag flow (works now, no redeploy)

`ShipToken.contractURI()` returns `METADATA_BASE + tokenAddress`
(`https://tasern.quest/api/unruggable/metadata/…`). Point that path (or the launcher
UI's metadata POST) at `/ship/meta/:address` and POST the uploaded flag to
`/ship/flag/:address`. The ship is mutiny-capable, so the flag store **allows
overwrite** (audit-logged) — re-flagging after a mutiny just re-POSTs the image.
