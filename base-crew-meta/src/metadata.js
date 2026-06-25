// ============================================================
//  metadata.js — ERC-721 dynamic-NFT metadata for a Base crew member.
//
//  EVM marketplaces (OpenSea, Blur, Zora, Rarible) read the ERC-721 / ERC-1155
//  "Metadata JSON Schema": { name, description, image, external_url, attributes }.
//  Confirmed field shape (this is the de-facto OpenSea standard, ERC-721 §"Metadata
//  JSON"): `image` is a URL to the art, `attributes` is an array of
//  { trait_type, value } objects. It is SHAPE-COMPATIBLE with Metaplex (same keys),
//  with these EVM specifics:
//    - use `external_url` (NOT Metaplex's `external_url`/`properties.files` is
//      optional on EVM; we still include `properties` for parity but EVM ignores it)
//    - numeric traits may add { display_type: 'number' } for nicer rendering
//
//  The dynamic trick is identical to the Solana service: `image` points at the LIVE
//  render endpoint, not a baked file. Change the look (equip/recolour/flag) and the
//  same token URI serves new art + new attributes — NO re-mint.
//
//  IMPORTANT (see REPORT): the DEPLOYED FeeShareDistributor returns an EMPTY
//  tokenURI and has no setter, so existing crew NFTs cannot point here. This
//  endpoint is what the NEXT Shipyard's distributor (with a settable baseURI) must
//  resolve `tokenURI(id)` to.
// ============================================================
const { getLook, getDisplayName, getName, crewKey, tokenIdOf } = require('./closet');
const { colorDef, itemDef, parseVariant } = require('./cosmetics-config');
const { speciesName } = require('./asset-manifest');
const { speciesForCrewKey } = require('./ship-species');
const { statsToAttributes, getStats } = require('./stats');

// baseUrl = the PUBLIC origin where the render endpoint is hosted, e.g.
//           https://crew.tasern.quest  (locally: http://localhost:8791)
// crewRef = a crewKey ("0xdist:7") OR (distributor, tokenId) — canonicalised here.
function buildMetadata(crewRef, baseUrl, maybeTokenId) {
  const key = crewKey(crewRef, maybeTokenId);
  const look = getLook(key);
  const displayName = getDisplayName(key);
  const root = baseUrl.replace(/\/$/, '');
  // dynamic image = the live render endpoint for this crew key
  const image = `${root}/crew/render/${encodeURIComponent(key)}.png`;

  return {
    name: displayName,
    description:
      'A Base crew member with a living look. Equip hats, capes, boots, recolour the body, ' +
      'laminate stickers, and fly your ship\'s flag — the art and traits update via a dynamic ' +
      'token URI, no re-mint needed. Part of a ship\'s 100-NFT fee-share crew.',
    image,
    external_url: `${root}/crew/${encodeURIComponent(key)}`,
    attributes: lookToAttributes(look, getName(key), key),
    // `properties` is Metaplex-style and harmless on EVM (ignored by OpenSea); kept
    // so the same JSON validates for any cross-listed Solana tooling.
    properties: {
      category: 'image',
      files: [{ uri: image, type: 'image/png' }],
      dynamic: true,
    },
  };
}

// Turn a stored look (+ name + stats) into ERC-721 `attributes`.
function lookToAttributes(look, name, key) {
  const a = [];
  a.push({ trait_type: 'Named', value: name ? 'Yes' : 'No' });
  // class / level / STR.. (deterministic or game-override; see stats.js)
  for (const s of statsToAttributes(key)) a.push(s);
  const species = look.species ? look.species : speciesForCrewKey(key);
  a.push({ trait_type: 'Species', value: speciesName(species) });
  a.push({ trait_type: 'Base', value: look.base === 'girl' ? 'Girl' : 'Boy' });
  a.push({ trait_type: 'Color', value: colorDef(look.color || 'natural').name });
  const items = look.items || {};
  for (const slot of ['hat', 'face', 'neck', 'feet', 'gear']) {
    if (!items[slot]) continue;
    const { itemId, color } = parseVariant(items[slot]);
    const def = itemDef(itemId);
    if (!def) continue;
    a.push({
      trait_type: slot.charAt(0).toUpperCase() + slot.slice(1),
      value: (color && color !== 'natural' ? colorDef(color).name + ' ' : '') + def.name,
    });
  }
  if (look.shipFlag) a.push({ trait_type: 'Ship Flag', value: look.shipFlag });
  const stickers = Array.isArray(look.stickers) ? look.stickers : [];
  if (stickers.length) a.push({ trait_type: 'Stickers', value: stickers.length });
  return a;
}

module.exports = { buildMetadata, lookToAttributes };
