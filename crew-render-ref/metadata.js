// ============================================================
//  metadata.js — Metaplex dynamic-NFT metadata for a crew member.
//
//  The whole point of the paper-doll: `image` points at the LIVE render endpoint,
//  not a baked file. When the owner changes the look (equip a hat, recolour, add a
//  sticker), the same URL renders the new PNG — the NFT updates with NO re-mint.
//
//  This is standard Metaplex Token Metadata JSON (Fungible/NFT standard), the same
//  shape Metaplex Core / Bubblegum (compressed NFTs) serve. For LIVE NFTs the
//  `image` host MUST be publicly reachable (see server.js header + REPORT).
// ============================================================
const { renderCrew } = require('./render');
const { getLook, getDisplayName, getName } = require('./closet');

// baseUrl = the PUBLIC origin where the render endpoint is hosted,
//           e.g. https://crew.tasern.quest   (locally: http://localhost:8790)
function buildMetadata(crewId, baseUrl) {
  const look = getLook(crewId);
  // the NFT name = the owner-set name if there is one, else "Crew #<id>".
  // (dynamic metadata: when the owner names/renames the crew, this URL serves
  //  the new name with NO re-mint — same as the dynamic image.)
  const displayName = getDisplayName(crewId);
  // compute traits by doing a (cheap) trait pass — reuse renderCrew's trait logic
  // lazily here so metadata works even if you only want the JSON. We derive traits
  // from the look directly to avoid rendering a PNG just for metadata.
  const image = `${baseUrl.replace(/\/$/, '')}/crew/render/${encodeURIComponent(crewId)}.png`;

  return {
    name: displayName,
    symbol: 'CREW',
    description:
      'A Solana crew member with a living look. Equip hats, capes, boots, recolour the body, and laminate stickers — the art updates on-chain via a dynamic image, no re-mint needed.',
    image,
    external_url: `${baseUrl.replace(/\/$/, '')}/crew/${encodeURIComponent(crewId)}`,
    attributes: lookToAttributes(look, getName(crewId)),
    properties: {
      category: 'image',
      files: [{ uri: image, type: 'image/png' }],
      // dynamic flag is informational; marketplaces key off `image` being a live URL
      dynamic: true,
    },
  };
}

// Turn a stored look into Metaplex `attributes` (trait_type/value pairs).
// `name` (optional) = the owner-set crew name; surfaced as a "Named" trait so a
// marketplace shows whether the crew has been personalized.
const { colorDef, itemDef, parseVariant } = require('./cosmetics-config');
function lookToAttributes(look, name) {
  const a = [];
  a.push({ trait_type: 'Named', value: name ? 'Yes' : 'No' });
  a.push({ trait_type: 'Base', value: look.base === 'girl' ? 'Acorn Girl' : 'Acorn Boy' });
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
