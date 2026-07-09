// @ts-check
/**
 * game.js — single ship-DECK HEX battle map. Hot-seat: player Barbarian vs enemy
 * Wizard. Renders an SVG HEX grid (reusing the ToT hexGrid primitives) over a
 * placeholder ship deck, and drives turns through the ported ToT d20 combat + spell
 * engine (tot-engine.js). Unit stats come from the class-engine via units.js.
 *
 * REUSE: all hex math + combat resolution is from tot-engine.js (ported from ToT).
 * This file only does the DECK rendering + the turn UI — i.e. it stands in for the
 * NOT-ported React renderers (HexBattle.tsx / CombatUI.tsx / useHexBattle.ts).
 *
 * ART HOOKS (founder fills in — all placeholders today):
 *   • drawDeck()        → ship-deck background (plank rectangles now → deck image)
 *   • drawUnit()        → unit token (emoji disc now → paper-doll crew-NFT sprite,
 *                         with `unit.cosmetics` layering the ToT closet item art)
 */

import { makeStarterUnits, SPELLS } from "./units.js";
import { readEncounter, resolveEncounter } from "./encounter.js";
import { ITEMS, SLOTS, equipItem, equippedList, ownedGear, applyEquipment } from "./items.js";
// P6 FAIRNESS LAYER: the SINGLE attack/cast chokepoint. game.js no longer calls the engine
// resolvers directly — strike()/castWrapped() own every swing + spell (so per-weapon crit ranges
// + forecast live in one place), and planIntent()/chooseTarget() drive the squad AI + telegraph.
import { strike, castWrapped, forecast, planIntent, chooseTarget, resolveOverboard } from "./combat-helpers.js";
// COMBAT-SETTLEMENT (seas): the headless single source of combat truth. We mint a per-fight
// SEED + a SEEDED rng here and thread that rng through every strike()/castWrapped()/resolveOverboard()
// so the live fight is fully DETERMINISTIC from { seed + actions } — the server can replay this exact
// codepath (resolver.resolveFight) and independently verify a claimed win. checkWin() delegates to the
// resolver's evaluateOutcome() so the win rule is one shared definition. See project_seas_combat_settlement.
import { makeRng, evaluateOutcome } from "./resolver.js";
// P7 CAMERA: pan / zoom / fit / follow-active viewport over the SVG board (viewBox only).
import { createCamera } from "./camera.js";
import { pawnCapacity, carriedWeight, loadState, LOAD } from "../../lib/weight.js";
import {
  HEX_SIZE, GRID_COLS, GRID_ROWS, hexToPixel, hexPolygonPoints,
  hexDistance, isAdjacent, isAlive, isConscious,
  isUnconscious, isDead,
} from "./tot-engine.js";
// P4 GRID-CONFIG SHADOW: the 4 grid-READING fns now come from the config-aware module so the
// board can be ANY size (squad/ship/boarding) without touching the verbatim engine. The
// hex/combat/spell primitives above still come straight from tot-engine.js. grid-parity.mjs
// proves these match the engine byte-for-byte at the default 9×7.
import {
  allHexes, gridPixelDimensions, hexNeighbors, hexesInRange,
  GRID, setGrid, GRID_PRESETS,
} from "./grid-config.js";
// MAP/TERRAIN DATA (COSMETIC): per-area deck terrain (cover/hazard/water-edge/wall/difficult)
// authored in maps/<id>.js + resolved by maps/index.js. Read by an additive, non-interactive
// overlay (drawTerrain) so a group fight reads its battlefield. Zero combat/engine impact; an
// unknown/absent map id → no data → the deck renders exactly as before.
import { getMap, terrainIndex, TERRAIN_TYPES } from "./maps/index.js";
// TERRAIN EFFECTS (DATA-DRIVEN, ADDITIVE): the rules that make that terrain MATTER — COVER → +AC
// (fed through the strike()/forecast() chokepoint), WALL → impassable (union'd into occupiedSet so
// move reachability excludes it), HAZARD → on-enter damage/status, WATER-EDGE → reflex-save fall.
// Pure + node-safe; no terrain data (duels/training) → every helper is a no-op (current behaviour).
import { coverACAt, blockedKeys, tileEntryEffect } from "./terrain-effects.js";
// P8 VISION · LINE-OF-SIGHT · FOG OF WAR — "your crew are your eyes." los.js computes the PLAYER
// side's SHARED, wall-limited vision (visibleHexes); game.js dims fogged hexes + HIDES foe tokens
// outside it, and gates RANGED attacks/spells on a clear line (losClear, completing the cut "cover
// blocks the ranged line" rule). Fog engages only on the bigger squad/ship boards
// (fogActiveForGrid); the 1v1 training/PVP duel stays fully visible. Additive + data-driven.
import { losClear, visibleHexes, fogActiveForGrid } from "./los.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const key = (h) => `${h.q},${h.r}`;

// ── DOM ─────────────────────────────────────────────────────────────────────────
const boardEl = document.getElementById("board");
const turnEl = document.getElementById("turn-indicator");
const statsEl = document.getElementById("stats");
const spellbarEl = document.getElementById("spellbar");
const equipbarEl = document.getElementById("equipbar");
const logEl = document.getElementById("log");
const bannerEl = document.getElementById("banner");
const btnMove = /** @type {HTMLButtonElement} */ (document.getElementById("btn-move"));
const btnAttack = /** @type {HTMLButtonElement} */ (document.getElementById("btn-attack"));
const btnEnd = /** @type {HTMLButtonElement} */ (document.getElementById("btn-end"));
const btnReset = /** @type {HTMLButtonElement} */ (document.getElementById("btn-reset"));

/** @type {{units:any[], turnIdx:number, round:number, phase:string, reachable:Set<string>, targets:Set<string>, pendingSpell:any, stakes:boolean, arena:string, mode:string, objective?:any, mapId?:any, mapData?:any, terrainIx?:Map<string,any>, groupName?:any, severed?:number, telegraph?:any[]}} */
let state;

// P7 CAMERA — created once on first init(), re-fit on each init / grid resize. Browser-only.
let cam = null;

// P8 FOG — the player side's currently-visible "q,r" keys (Set), recomputed each render(). null =
// NO fog (the small 1v1 duel/training board, or any board ≤ the verbatim 9×7) → everything visible.
let fogVisible = null;

// Kraken "break free" default: survive this many full rounds (no count in the encounter data).
const KRAKEN_SURVIVE_ROUNDS = 8;

// ── Log ───────────────────────────────────────────────────────────────────────
function log(text, cls = "info") {
  const d = document.createElement("div");
  d.className = `log-line ${cls}`;
  d.textContent = text;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const current = () => state.units[state.turnIdx];
const occupiedSet = (exclude) => {
  const s = new Set(state.units.filter((u) => isAlive(u) && u !== exclude).map((u) => key(u.position)));
  // TERRAIN: blocking tiles (walls) are solid too — union them so the move-range BFS can't enter
  // or path through one (→ unreachable) and the occupied set treats it as occupied. No terrain → no-op.
  if (state && state.terrainIx) for (const k of blockedKeys(state.terrainIx)) s.add(k);
  return s;
};
const unitAtHex = (h) => state.units.find((u) => isAlive(u) && u.position.q === h.q && u.position.r === h.r);

/** Record ONE player action into the verifiable log (move/attack/spell/end). Player-only by call
 *  site (onHexClick only fires on a player turn; endTurn records 'end' only for a player). The
 *  server replays this exact list — keep the shape EXACTLY what resolver.resolveEncounter expects. */
function recAct(a) { if (state && Array.isArray(state.actionLog)) state.actionLog.push(a); }

// ── Rendering ─────────────────────────────────────────────────────────────────
function ensureBoardSize() {
  const { width, height } = gridPixelDimensions();
  boardEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  boardEl.setAttribute("width", String(width));
  boardEl.setAttribute("height", String(height));
}

/** ART HOOK: ship-deck background — placeholder plank rows. Swap for a deck image. */
function drawDeck() {
  // a wood-toned rounded backdrop behind the hexes (the "deck")
  const { width, height } = gridPixelDimensions();
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width)); bg.setAttribute("height", String(height));
  bg.setAttribute("rx", "10");
  bg.setAttribute("fill", "#3d2b18");
  boardEl.appendChild(bg);
  // plank seams (horizontal bands)
  for (let y = 14; y < height; y += 26) {
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", "0"); ln.setAttribute("x2", String(width));
    ln.setAttribute("y1", String(y)); ln.setAttribute("y2", String(y));
    ln.setAttribute("stroke", "rgba(0,0,0,0.18)"); ln.setAttribute("stroke-width", "2");
    boardEl.appendChild(ln);
  }
}

function hexFill(h) {
  const k = key(h);
  if (state.targets.has(k)) return "rgba(231,76,60,0.55)";        // attack target
  if (state.reachable.has(k)) return "rgba(52,152,219,0.5)";      // reachable move
  // P8 FOG: a hex OUTSIDE the crew's shared vision is dimmed to near-black (foe tokens there are
  // hidden in render()). Move/attack highlights above keep priority so gameplay still reads first.
  if (fogVisible && !fogVisible.has(k)) return "rgba(6,4,2,0.82)";
  // deck tile checker
  return ((h.q + h.r) % 2 === 0) ? "rgba(120,82,45,0.55)" : "rgba(96,66,36,0.55)";
}

function drawHexes() {
  for (const h of allHexes()) {
    const { x, y } = hexToPixel(h);
    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", hexPolygonPoints(x, y));
    poly.setAttribute("fill", hexFill(h));
    poly.setAttribute("stroke", "rgba(20,12,4,0.6)");
    poly.setAttribute("stroke-width", "1.5");
    poly.style.cursor = "pointer";
    poly.addEventListener("click", () => onHexClick(h));
    boardEl.appendChild(poly);
  }
}

/** COSMETIC TERRAIN OVERLAY (maps/<id>.js). Paints the deck's authored features — cover · hazard ·
 *  water-edge · wall · difficult ground — as a subtle, NON-interactive layer so a group fight reads
 *  its battlefield (the legibility win the area docs call for). PURE RENDER: it never touches combat,
 *  units, or move math, and pointer-events stay OFF so clicks pass through to the hex below. No map
 *  data (every duel/training/pvp fight, or an un-authored deck) → nothing is drawn. */
function drawTerrain() {
  const ix = state.terrainIx;
  if (!ix || ix.size === 0) return;
  for (const h of allHexes()) {
    const cell = ix.get(key(h));
    if (!cell) continue;
    if (fogVisible && !fogVisible.has(key(h))) continue;   // P8: don't reveal terrain hidden in the fog
    const style = TERRAIN_TYPES[cell.type];
    if (!style) continue;
    const { x, y } = hexToPixel(h);
    // tinted hex face — skipped when the hex is a live move/attack highlight so gameplay reads first
    if (!state.reachable.has(key(h)) && !state.targets.has(key(h))) {
      const tile = document.createElementNS(SVG_NS, "polygon");
      tile.setAttribute("points", hexPolygonPoints(x, y));
      tile.setAttribute("fill", style.fill);
      tile.setAttribute("stroke", style.stroke);
      tile.setAttribute("stroke-width", "1.5");
      tile.style.pointerEvents = "none";
      boardEl.appendChild(tile);
    }
    // a small glyph so the feature stays legible even under a highlight or token edge
    const mark = document.createElementNS(SVG_NS, "text");
    mark.setAttribute("x", String(x));
    mark.setAttribute("y", String(y + HEX_SIZE * 0.33));
    mark.setAttribute("text-anchor", "middle");
    mark.setAttribute("dominant-baseline", "central");
    mark.setAttribute("font-size", String(HEX_SIZE * 0.5));
    mark.setAttribute("opacity", "0.85");
    mark.style.pointerEvents = "none";
    mark.textContent = style.glyph;
    boardEl.appendChild(mark);
  }
}

/** ART HOOK: unit token — emoji disc now → paper-doll crew-NFT sprite + cosmetics. */
function drawUnit(u) {
  const { x, y } = hexToPixel(u.position);
  const g = document.createElementNS(SVG_NS, "g");

  // friend/foe ring
  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", String(x)); ring.setAttribute("cy", String(y));
  ring.setAttribute("r", String(HEX_SIZE * 0.62));
  ring.setAttribute("fill", u.isPlayer ? "#1f3a24" : "#3a2410");
  ring.setAttribute("stroke", u.isPlayer ? "#2ecc71" : "#e67e22");
  ring.setAttribute("stroke-width", "3");
  if (u === current()) ring.setAttribute("stroke", "#f1c40f");
  g.appendChild(ring);

  // UNIT IMAGE = PAPER-DOLL CREW NFT (the convergence).
  // The emoji <text> is drawn FIRST as the always-present fallback — so the token is
  // NEVER blank even if the image never paints. The crew render (units.js imageUrl =
  // <CREW_SERVICE_URL>/crew/render/<crewId>.png) is then overlaid on top.
  // RELIABLE FALLBACK: SVG <image> error events are flaky across browsers, so we PRELOAD
  // with an HTML Image() (whose onload/onerror ARE reliable) and only add the SVG <image>
  // once it has actually loaded. If the crew service is down / the id is bad, the preload
  // errors, nothing is overlaid, and the emoji shows through.
  // Equipping different gear in the closet changes the render → this battle token, no code change.
  const emoji = document.createElementNS(SVG_NS, "text");
  emoji.setAttribute("x", String(x)); emoji.setAttribute("y", String(y + 2));
  emoji.setAttribute("text-anchor", "middle"); emoji.setAttribute("dominant-baseline", "central");
  emoji.setAttribute("font-size", String(HEX_SIZE * 0.8));
  emoji.textContent = u.imageEmoji || u.name[0];
  g.appendChild(emoji);

  if (u.imageUrl) {
    const sz = HEX_SIZE * 1.18;            // paper-doll is tall; size to ~fill the hex
    const pre = new Image();
    pre.onload = () => {
      // still on the board for this unit? (a re-render may have replaced the group)
      if (!g.isConnected) return;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttributeNS(null, "href", u.imageUrl);
      img.setAttribute("x", String(x - sz / 2)); img.setAttribute("y", String(y - sz / 2));
      img.setAttribute("width", String(sz)); img.setAttribute("height", String(sz));
      img.setAttribute("preserveAspectRatio", "xMidYMid meet");
      g.insertBefore(img, emoji.nextSibling); // overlay just above the emoji fallback
    };
    pre.onerror = () => { /* crew service down / bad id → leave the emoji showing */ };
    pre.src = u.imageUrl;
  }

  // mini HP bar
  const bw = HEX_SIZE * 1.1, bh = 6;
  const bx = x - bw / 2, by = y - HEX_SIZE * 0.62 - 11;
  const back = document.createElementNS(SVG_NS, "rect");
  back.setAttribute("x", String(bx)); back.setAttribute("y", String(by));
  back.setAttribute("width", String(bw)); back.setAttribute("height", String(bh));
  back.setAttribute("rx", "2"); back.setAttribute("fill", "#1a120a");
  g.appendChild(back);
  const frac = Math.max(0, u.currentHp) / u.maxHp;
  const fill = document.createElementNS(SVG_NS, "rect");
  fill.setAttribute("x", String(bx)); fill.setAttribute("y", String(by));
  fill.setAttribute("width", String(bw * frac)); fill.setAttribute("height", String(bh));
  fill.setAttribute("rx", "2"); fill.setAttribute("fill", frac > 0.33 ? "#2ecc71" : "#e74c3c");
  g.appendChild(fill);

  g.style.cursor = "pointer";
  g.addEventListener("click", () => onHexClick(u.position));
  boardEl.appendChild(g);
}

const samePos = (a, b) => a && b && a.q === b.q && a.r === b.r;

/** P6 — Into-the-Breach intent TELEGRAPH. Paints each pending enemy's planned MOVE (amber dashed
 *  path + destination outline) and its STRIKE hex(es) (red crosshair / blast zone) BEFORE the
 *  enemy phase resolves, so the player can read the threat. Cleared the instant the enemy acts. */
function drawTelegraph() {
  for (const intent of state.telegraph || []) {
    if (!intent) continue;
    // P8 FOG: don't telegraph an enemy the player can't see — its origin hex is hidden in the fog.
    if (fogVisible && intent.from && !fogVisible.has(key(intent.from))) continue;
    if (intent.moveTo && intent.from && !samePos(intent.from, intent.moveTo)) {
      const a = hexToPixel(intent.from), b = hexToPixel(intent.moveTo);
      const ln = document.createElementNS(SVG_NS, "line");
      ln.setAttribute("x1", String(a.x)); ln.setAttribute("y1", String(a.y));
      ln.setAttribute("x2", String(b.x)); ln.setAttribute("y2", String(b.y));
      ln.setAttribute("stroke", "#f1c40f"); ln.setAttribute("stroke-width", "3");
      ln.setAttribute("stroke-dasharray", "5,5"); ln.setAttribute("opacity", "0.85");
      boardEl.appendChild(ln);
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(b.x)); dot.setAttribute("cy", String(b.y));
      dot.setAttribute("r", String(HEX_SIZE * 0.5)); dot.setAttribute("fill", "none");
      dot.setAttribute("stroke", "#f1c40f"); dot.setAttribute("stroke-width", "2");
      dot.setAttribute("stroke-dasharray", "4,4"); dot.setAttribute("opacity", "0.8");
      boardEl.appendChild(dot);
    }
    for (const sh of intent.strikeHexes || []) {
      const p = hexToPixel(sh);
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("cx", String(p.x)); ring.setAttribute("cy", String(p.y));
      ring.setAttribute("r", String(HEX_SIZE * 0.55)); ring.setAttribute("fill", "rgba(231,76,60,0.16)");
      ring.setAttribute("stroke", "#e74c3c"); ring.setAttribute("stroke-width", "2.5"); ring.setAttribute("stroke-dasharray", "3,3");
      boardEl.appendChild(ring);
      for (const dx of [-1, 1]) {       // a small ✕ in the target hex
        const c = document.createElementNS(SVG_NS, "line");
        c.setAttribute("x1", String(p.x - dx * HEX_SIZE * 0.26)); c.setAttribute("y1", String(p.y - HEX_SIZE * 0.26));
        c.setAttribute("x2", String(p.x + dx * HEX_SIZE * 0.26)); c.setAttribute("y2", String(p.y + HEX_SIZE * 0.26));
        c.setAttribute("stroke", "#e74c3c"); c.setAttribute("stroke-width", "2"); c.setAttribute("opacity", "0.9");
        boardEl.appendChild(c);
      }
    }
  }
}

/** P6 — XCOM-style forecast HUD: a tiny hit% / damage (/ crit%) pill above each STRIKE target
 *  during the player's attack phase. Numbers are the EXACT, no-mutation forecast() read-out. */
function drawForecastBadges() {
  if (state.phase !== "attack") return;
  const u = current();
  if (!u || !u.isPlayer) return;
  for (const e of state.units) {
    if (!isAlive(e) || e.isPlayer === u.isPlayer || !state.targets.has(key(e.position))) continue;
    const f = forecast(u, e, { coverAC: coverACAt(state.terrainIx, e.position), terrainIx: state.terrainIx });   // TERRAIN: cover raises the foe's effective AC; P8: a walled-off ranged shot reads 0%
    const { x, y } = hexToPixel(e.position);
    const by = y - HEX_SIZE * 0.62 - 24;
    const label = `${Math.round(f.hitPct * 100)}% ⚔${f.flatDmg}` + (f.critPct >= 0.1 ? ` ✷${Math.round(f.critPct * 100)}%` : "");
    const w = Math.max(44, label.length * 6.6);
    const bg = document.createElementNS(SVG_NS, "rect");
    bg.setAttribute("x", String(x - w / 2)); bg.setAttribute("y", String(by - 9));
    bg.setAttribute("width", String(w)); bg.setAttribute("height", "16"); bg.setAttribute("rx", "4");
    bg.setAttribute("fill", "rgba(10,7,3,0.86)"); bg.setAttribute("stroke", "#e74c3c"); bg.setAttribute("stroke-width", "1");
    boardEl.appendChild(bg);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(x)); t.setAttribute("y", String(by));
    t.setAttribute("text-anchor", "middle"); t.setAttribute("dominant-baseline", "central");
    t.setAttribute("font-size", "11"); t.setAttribute("fill", "#ffe9c7"); t.setAttribute("font-weight", "bold");
    t.textContent = label;
    boardEl.appendChild(t);
  }
}

function render() {
  while (boardEl.firstChild) boardEl.removeChild(boardEl.firstChild);
  // P8 FOG: on the bigger squad/ship boards, compute the PLAYER side's SHARED vision = the UNION of
  // each conscious crew's wall-limited sight (los.js). The 1v1 duel/training board (≤9×7) gets none
  // → null = everything visible (NO regression). Recomputed each render so moving a pawn re-lights
  // the map, and because it's a UNION, spreading the crew (one per ship) reveals more — emergent.
  fogVisible = (state && fogActiveForGrid()) ? visibleHexes(state.units, true, state.terrainIx) : null;
  drawDeck();
  drawHexes();
  drawTerrain();                                         // cosmetic map terrain ABOVE tiles, UNDER tokens
  drawTelegraph();                                       // P6 intent ghosts UNDER the tokens
  for (const u of state.units) {
    if (!isAlive(u)) continue;
    // ALWAYS show your OWN pawns (even in fog / on another ship — the founder payoff). A FOE token
    // is drawn only when its hex is inside the crew's shared vision; otherwise it stays hidden.
    if (u.isPlayer || !fogVisible || fogVisible.has(key(u.position))) drawUnit(u);
  }
  drawForecastBadges();                                  // P6 hit%/dmg HUD OVER the attack targets
  renderSidebar();
}

// ── Sidebar (stat sheet + spell bar) ────────────────────────────────────────────
function renderSidebar() {
  const u = current();
  if (state.phase === "over") {
    turnEl.textContent = "Battle over";
  } else {
    turnEl.textContent = `Round ${state.round} — ${u.name} (${u.className}) · HP ${u.currentHp}/${u.maxHp} · ${phaseHint()}`;
  }
  const myTurn = u && u.isPlayer;
  btnMove.disabled = state.phase === "over" || !myTurn || u.hasMoved;
  btnAttack.disabled = state.phase === "over" || !myTurn || u.hasActed;
  btnEnd.disabled = state.phase === "over" || !myTurn;

  // spell bar only for casters with an action left, in act phase choices
  spellbarEl.innerHTML = "";
  if (state.phase !== "over" && u.role === "caster" && !u.hasActed) {
    for (const sid of u.availableSpells) {
      const sp = SPELLS[sid];
      if (!sp) continue;
      const b = document.createElement("button");
      b.className = "spell-btn" + (state.pendingSpell && state.pendingSpell.id === sid ? " active" : "");
      b.textContent = `${sp.name} (L${sp.level})`;
      b.addEventListener("click", () => beginSpell(sp));
      spellbarEl.appendChild(b);
    }
  }
  renderEquip();
  showStats(u);
}

/** Equip bar — the active unit's loadout, by slot. Click toggles an item; the unit's
 *  combat stats recompute from base (items.js) and the board re-renders. This is the
 *  in-battle stand-in for the dedicated equip page / general store. */
function renderEquip() {
  const u = current();
  equipbarEl.innerHTML = "";
  if (!u || state.phase === "over") return;
  const owned = ownedGear();           // only gear bought at the General Store is usable
  if (owned.size === 0) {
    const hint = document.createElement("div");
    hint.className = "equip-hint";
    hint.innerHTML = `No gear yet — buy some at the <a href="../store/" target="_blank">🏪 General Store</a>, then equip it here.`;
    equipbarEl.appendChild(hint);
    return;
  }
  for (const slot of SLOTS) {
    const row = document.createElement("div");
    row.className = "equip-slot";
    const lab = document.createElement("span");
    lab.className = "slot-label";
    lab.textContent = slot;
    row.appendChild(lab);
    for (const it of Object.values(ITEMS)) {
      if (it.slot !== slot) continue;
      const have = owned.has(it.id);
      const on = u.equipped[slot] === it.id;
      const b = document.createElement("button");
      b.className = "equip-btn" + (on ? " on" : "") + (have ? "" : " locked");
      b.title = have ? it.desc : `Buy at the General Store (${it.gold} gold)`;
      b.textContent = have ? `${it.emoji} ${it.name}` : `${it.emoji} ${it.name} 🔒`;
      b.addEventListener("click", () => {
        if (!have) { log(`${it.name} isn't in your kit — buy it at the General Store (${it.gold} gold).`, "info"); return; }
        const r = equipItem(u, it.id);
        if (r) log(`${u.name} ${r.equipped ? "equips" : "stows"} ${it.name} — ${it.desc}.`, "info");
        render();
      });
      row.appendChild(b);
    }
    equipbarEl.appendChild(row);
  }
}

function phaseHint() {
  if (state.phase === "move") return "click a blue hex to MOVE";
  if (state.phase === "attack") return "click a red hex to STRIKE";
  if (state.phase === "spell") return `casting ${state.pendingSpell.name}: click a target`;
  return "Move / Attack / cast a spell / End";
}

// ── Encumbrance (D&D item weights from gear-data.js, via weight.js) ──────────────
function loadOf(u) {
  const carried = carriedWeight({ items: equippedList(u) });
  const capacity = pawnCapacity(u.engineStats.STR);
  return { carried, capacity, ...loadState(carried, capacity) };
}
// Effective move after load: Light = full, Laden = −1 hex, Overloaded = crawl (1 hex).
function encMove(u) {
  const l = loadOf(u);
  if (l.tier === LOAD.OVERLOADED) return 1;
  if (l.tier === LOAD.LADEN) return Math.max(1, u.movementHexes - 1);
  return u.movementHexes;
}

function showStats(u) {
  const cls = u.qualified[0];
  const abilities = cls ? cls.availableAbilities.map((a) => a.name).join(", ") : "—";
  const endow = Object.entries(u.endowment).map(([k, v]) => `${k}:$${v}`).join("  ");
  const gear = equippedList(u);
  const gearStr = gear.length ? gear.map((g) => `${g.emoji} ${g.name}`).join(", ") : "—";
  const S = u.engineStats;
  const L = loadOf(u), eff = encMove(u);
  const loadColor = L.tier === LOAD.OVERLOADED ? "#e74c3c" : L.tier === LOAD.LADEN ? "#e6b422" : "#2ecc71";
  statsEl.innerHTML = `
    <div class="stat-head"><strong>${u.name}</strong> <span class="muted">${u.className}</span>
      <span class="badge ${u.isPlayer ? "ally" : "foe"}">${u.isPlayer ? "PLAYER" : "ENEMY"}</span></div>
    <div class="hpbar"><div class="hpfill" style="width:${(Math.max(0, u.currentHp) / u.maxHp) * 100}%"></div>
      <span class="hptext">${u.currentHp}/${u.maxHp} HP</span></div>
    <div class="grid6">
      <div>STR<b>${S.STR}</b></div><div>DEX<b>${S.DEX}</b></div><div>CON<b>${S.CON}</b></div>
      <div>INT<b>${S.INT}</b></div><div>WIS<b>${S.WIS}</b></div><div>CHA<b>${S.CHA}</b></div>
    </div>
    <div class="derived">
      <span>AC <b>${u.stats.ac}</b></span>
      <span>To-Hit <b>+${u.stats.atkBonus}</b></span>
      <span>Dmg <b>${u.stats.attack}</b></span>
      <span>Move <b>${eff} hex</b>${eff < u.movementHexes ? ` <span style="color:#e6b422">−${u.movementHexes - eff}</span>` : ""}</span>
      ${u.role === "caster" ? `<span>Spell DC <b>${u.spellDC}</b></span>` : ""}
    </div>
    <div class="muted small" style="margin-top:5px">⚖️ Load <b>${L.carried.toFixed(0)}/${L.capacity} lb</b> · <b style="color:${loadColor}">${L.tier}</b></div>
    <div style="height:6px;background:#1a120a;border-radius:3px;overflow:hidden;margin-top:2px;margin-bottom:4px">
      <div style="height:100%;width:${Math.min(100, L.pct)}%;background:${loadColor}"></div></div>
    <div class="muted small">Gear: ${gearStr}</div>
    <div class="muted small">Level ${u.totalLevel} · ${u.bracket}</div>
    <div class="muted small">Class abilities: ${abilities}</div>`;
}

// ── Phases ──────────────────────────────────────────────────────────────────────
function clearHighlights() { state.reachable = new Set(); state.targets = new Set(); state.pendingSpell = null; }

function enterMove() {
  const u = current();
  if (u.hasMoved || state.phase === "over") return;
  clearHighlights();
  state.phase = "move";
  const reach = hexesInRange(u.position, encMove(u), occupiedSet(u));   // encumbrance-aware
  state.reachable = new Set(reach.map(key));
  render();
}

function enterAttack() {
  const u = current();
  if (u.hasActed || state.phase === "over") return;
  clearHighlights();
  state.phase = "attack";
  state.targets = new Set(
    state.units
      .filter((e) => isAlive(e) && e.isPlayer !== u.isPlayer
        && hexDistance(u.position, e.position) <= u.attackRange
        // P8 LINE-OF-SIGHT: a RANGED strike (distance ≥ 2) needs a clear line — a foe behind a wall
        // is NOT a valid target. Melee (adjacent, distance 1) is unaffected (no hex between to block).
        && (hexDistance(u.position, e.position) <= 1 || losClear(u.position, e.position, state.terrainIx)))
      .map((e) => key(e.position)),
  );
  if (state.targets.size === 0) log(`${u.name}: no foe in range and line-of-sight to strike.`, "info");
  render();
}

function beginSpell(sp) {
  const u = current();
  if (u.hasActed || state.phase === "over") return;
  clearHighlights();
  state.phase = "spell";
  state.pendingSpell = sp;
  const range = sp.battle.hexRange ?? 1;
  // ALLY-TARGETING (deferred-spell wiring): a healing|buff spell targets ALLIES (incl. self —
  // and a DOWNED ally, who's still isAlive at 0..−10, so a cure can revive them via healUnit);
  // damage/control spells still target FOES. clicking an in-range highlighted unit resolves it.
  const ally = sp.battle.type === "healing" || sp.battle.type === "buff";
  state.targets = new Set(
    state.units
      .filter((e) => isAlive(e)
        && (ally ? e.isPlayer === u.isPlayer : e.isPlayer !== u.isPlayer)
        && hexDistance(u.position, e.position) <= range
        // P8 LINE-OF-SIGHT: you can't cast THROUGH a wall — a target at distance ≥ 2 needs a clear
        // line (heals/buffs included). Touch/adjacent (distance ≤ 1) casts are never gated.
        && (hexDistance(u.position, e.position) <= 1 || losClear(u.position, e.position, state.terrainIx)))
      .map((e) => key(e.position)),
  );
  if (state.targets.size === 0) log(`${u.name}: no ${ally ? "ally" : "target"} in range and line-of-sight for ${sp.name}.`, "info");
  render();
}

/**
 * Resolve a spell on a target through the CHOKEPOINT (castWrapped wraps the verbatim spell engine),
 * then APPLY the result game-side. Used by BOTH the player cast and the enemy AI so AoE + heals
 * behave identically either way:
 *   • damage  → applyDamage(); plus an AoE hexArea SPLASH (fireball / cone_of_cold / burning_hands)
 *               onto the caster's OTHER foes within hexArea of the struck hex (each rolls its own
 *               save inside castWrapped). Friendly-fire is spared to keep squad play readable.
 *   • healing → healUnit() (revives a downed ally from 0..−10, else tops HP up).
 *   • buff    → push res.effect into target.activeEffects (ToT durationRounds tick in startTurn).
 */
function castSpellAt(caster, sp, target) {
  const res = castWrapped(caster, target, sp, false, state.rng);
  log(`${caster.name} casts ${sp.name} at ${target.name}: ${res.breakdown}`, res.damage ? "hit" : "info");
  if (res.damage) {
    applyDamage(target, res.damage);
    const area = sp.battle && sp.battle.hexArea;
    if (area && area > 0) {
      for (const u2 of state.units) {
        if (state.phase === "over") break;
        if (!isAlive(u2) || u2 === target || u2.isPlayer === caster.isPlayer) continue;
        if (hexDistance(target.position, u2.position) <= area) {
          const r2 = castWrapped(caster, u2, sp, false, state.rng);
          log(`  ↳ ${sp.name} splash hits ${u2.name}: ${r2.breakdown}`, r2.damage ? "hit" : "info");
          if (r2.damage) applyDamage(u2, r2.damage);
        }
      }
    }
  } else if (res.healing) {
    const before = target.currentHp;
    if (!healUnit(target, res.healing)) {
      log(`${target.name} is healed ${Math.max(0, target.currentHp - before)} HP (${target.currentHp}/${target.maxHp}).`, "info");
    }
  } else if (res.effect) {
    target.activeEffects = target.activeEffects || [];
    target.activeEffects.push(res.effect);
    log(`${target.name} gains ${sp.name}.`, "info");
  }
}

// ── Click resolution ────────────────────────────────────────────────────────────
function onHexClick(h) {
  if (state.phase === "over") return;
  if (!current() || !current().isPlayer) return;   // ignore clicks during the enemy's turn
  const u = current();
  const k = key(h);

  if (state.phase === "move" && state.reachable.has(k)) {
    u.position = { q: h.q, r: h.r };
    u.hasMoved = true;
    recAct({ unit: u.id, type: "move", to: { q: h.q, r: h.r } });   // SETTLEMENT: record the move
    log(`${u.name} moves to (${h.q},${h.r}).`, "info");
    applyTileEntry(u);                                   // TERRAIN: hazard/water-edge on entering
    if (state.phase !== "over") state.phase = "idle";    // a fatal hazard may have ended the fight
    clearHighlights(); render();
    return;
  }

  if (state.phase === "attack" && state.targets.has(k)) {
    const target = unitAtHex(h);
    if (!target) return;
    // strike() = the SINGLE chokepoint: verbatim engine + weapon-dice + per-weapon crit ranges.
    // TERRAIN: a target on a COVER tile gets +AC, applied inside the same chokepoint.
    recAct({ unit: u.id, type: "attack", target: target.id });   // SETTLEMENT: record the strike (BEFORE the roll — the server re-rolls from the seed)
    const res = strike(u, target, { distance: hexDistance(u.position, target.position), coverAC: coverACAt(state.terrainIx, target.position), terrainIx: state.terrainIx, rng: state.rng });
    log(`${u.name} strikes ${target.name}: ${res.breakdown}`, res.hit ? "hit" : "miss");
    if (res.hit) applyDamage(target, res.damage);
    u.hasActed = true;
    state.phase = "idle"; clearHighlights(); render();
    return;
  }

  if (state.phase === "spell" && state.targets.has(k)) {
    const target = unitAtHex(h);
    if (!target) return;
    recAct({ unit: u.id, type: "spell", spell: state.pendingSpell.id, target: target.id });   // SETTLEMENT: record the cast
    // castSpellAt() = the chokepoint + AoE splash + heal/buff application (damage|healing|buff).
    castSpellAt(u, state.pendingSpell, target);
    u.hasActed = true;
    state.phase = "idle"; clearHighlights(); render();
    return;
  }

  // otherwise: inspect the clicked unit
  const clicked = unitAtHex(h);
  if (clicked) showStats(clicked);
}

// ── Damage / death / win (ToT death thresholds: 0 down, -10 dead) ────────────────
function applyDamage(target, dmg) {
  const wasConscious = isConscious(target);
  target.currentHp -= dmg;

  // SEVERABLE / NO-BLEED (kraken arms, undead boarders): NO down/bleed clock — at ≤0 they are
  // DESTROYED OUTRIGHT (a severed tentacle sinks back; a skeleton collapses to bones). Gated on
  // the unit flags so player/normal pawns keep the verbatim 0-down / −10-dead mechanic untouched.
  if ((target.severable || target.noBleed) && target.currentHp <= 0) {
    if (target.currentHp > -10) target.currentHp = -10;        // force DEAD → leaves the fight, never bleeds
    if (!target._severed) {
      target._severed = true;
      if (target.severable) {
        state.severed = (state.severed || 0) + 1;
        log(`${target.name} is SEVERED — it sinks back beneath the waves! (${state.severed} cut)`, "down");
      } else {
        log(`${target.name} is destroyed — no bleed-out.`, "down");
      }
    }
    checkMortality(target);   // monsters carry no gear → no loot lines, just the safe stat reset
    checkWin();
    return;
  }

  if (wasConscious && isUnconscious(target)) {
    // dropped from conscious to DOWN this hit (0..-10): out of the turn order, bleeding.
    log(`${target.name} falls! (${target.currentHp} HP — DOWN)`, "down");
  } else if (!isConscious(target)) {
    // already down, taking more damage (drifting toward -10)
    log(`${target.name} takes ${dmg} while down (${target.currentHp} HP).`, "down");
  }
  checkMortality(target);   // a hard hit can blow a downed unit past -10 → drop gear
  checkWin();
}

/** TERRAIN ON-ENTER: when a unit SETTLES on a hex, apply that tile's effect (data-driven,
 *  terrain-effects.js) through the EXISTING damage/effect paths. HAZARD → small damage and/or a
 *  status; WATER-EDGE → a reflex save (resolveOverboard owns the d20) or an overboard plunge.
 *  COVER/WALL/DIFFICULT trigger nothing here. No terrain (duels/training) or a safe tile → no-op.
 *  Called right after a move; applyDamage may end the fight, so callers re-check state.phase. */
function applyTileEntry(u) {
  if (!u || !isConscious(u) || state.phase === "over") return;
  const fx = tileEntryEffect(state.terrainIx, u.position);
  if (!fx) return;
  if (fx.type === "water-edge") {
    const save = resolveOverboard(u, { dc: fx.dc, rng: state.rng });
    if (save.fell) {
      log(`${u.name} loses footing at ${fx.label} — OVERBOARD! (Reflex ${save.total} vs DC ${save.dc}) −${fx.dmg}`, "down");
      if (fx.dmg > 0) applyDamage(u, fx.dmg);
    } else {
      log(`${u.name} steadies at ${fx.label}. (Reflex ${save.total} vs DC ${save.dc})`, "info");
    }
    return;
  }
  // HAZARD: optional status (ToT activeEffects, ticked in startTurn) + small on-enter damage.
  if (fx.status) {
    u.activeEffects = u.activeEffects || [];
    u.activeEffects.push({ ...fx.status });
    log(`${u.name} is caught in ${fx.label}.`, "info");
  }
  if (fx.dmg > 0) {
    log(`${u.name} stumbles through ${fx.label} — ${fx.dmg} dmg.`, "down");
    applyDamage(u, fx.dmg);
  }
}

/** HEAL HOOK (FFT-soft): a heal applied to a DOWNED unit (0..-10) brings it back UP.
 *  No healing ACTION exists yet — this is the wiring so one can be added with no death
 *  rework. Healing a unit that's already at -10 (gear dropped, out of fight) does nothing.
 *  Returns true if the unit was revived from DOWN to conscious. */
function healUnit(target, amount) {
  if (isDead(target)) return false;            // -10 = out of this fight; can't be topped up here
  const wasDown = isUnconscious(target);
  target.currentHp = Math.min(target.maxHp, target.currentHp + amount);
  if (wasDown && isConscious(target)) {
    log(`${target.name} is revived! (${target.currentHp} HP — back up)`, "info");
    return true;
  }
  return false;
}

// ── Death sink (FFT-soft): -10 drops the pawn's gear; that gear becomes loot ───────
/** When a unit hits -10 it loses its HELD GEAR (all slots cleared, stats fall to base)
 *  but is NOT destroyed — just out of THIS fight. Runs once per unit (geardropped flag). */
function checkMortality(u) {
  if (!isDead(u) || u._gearDropped) return;
  u._gearDropped = true;
  const dropped = equippedList(u);            // snapshot BEFORE we clear the slots
  for (const slot of SLOTS) u.equipped[slot] = null;
  applyEquipment(u);                          // stats fall back to base (no gear)
  log(`${u.name} loses their gear!`, "down");
  dropLoot(u, dropped);
}

/** Resolve where dropped gear goes. Arena rule:
 *    DECK  → 50/50 found (winner takes it) vs lost (house)
 *    WATER → 100% house (sinks)
 *  Legendary/limited gear (masterwork or enchanted) → a PRIZE VAULT instead.
 *  Game-layer ONLY: tracked in localStorage like the rest of the beta. In TRAINING
 *  (stakes=false) we SHOW the mechanic but DO NOT persist — the player's real
 *  sts_gear / sts_loadout are never touched. */
function dropLoot(loser, items) {
  if (!items.length) return;
  const winner = state.units.find((w) => isConscious(w) && w.isPlayer !== loser.isPlayer) || null;
  for (const it of items) {
    const prize = it.masterwork || (it.enchant && it.enchant > 0); // legendary/limited
    let dest, destLabel;
    if (prize) {
      dest = "prize"; destLabel = "the prize vault";
    } else if (state.arena === "water") {
      dest = "house"; destLabel = "the house (sank in the water)";
    } else { // deck: 50/50 found vs lost
      const found = Math.random() < 0.5;
      dest = found && winner ? "winner" : "house";
      destLabel = dest === "winner" ? `${winner.name} (found on the deck)` : "the house (lost in the scuffle)";
    }
    log(`Loot: ${it.emoji} ${it.name} → ${destLabel}.`, "info");
    recordLoot({ item: it.id, name: it.name, from: loser.name, dest, arena: state.arena, winner: dest === "winner" && winner ? winner.id : null });
  }
}

/** Persist loot to localStorage — ONLY in stakes (open-sea) battles. Training shows the
 *  loot line but writes nothing, so a sparring loss never destroys real owned gear. */
function recordLoot(entry) {
  if (!state.stakes) return;                 // TRAINING: mechanical only, not saved
  if (typeof localStorage === "undefined") return;
  try {
    const lootLog = JSON.parse(localStorage.getItem("sts_loot_log") || "[]");
    lootLog.push({ ...entry, ts: Date.now() });
    localStorage.setItem("sts_loot_log", JSON.stringify(lootLog));
    // route the dropped item by destination
    if (entry.dest === "prize") {
      const vault = JSON.parse(localStorage.getItem("sts_prize_vault") || "[]");
      vault.push(entry.item);
      localStorage.setItem("sts_prize_vault", JSON.stringify(vault));
    } else if (entry.dest === "house") {
      const house = JSON.parse(localStorage.getItem("sts_house_loot") || "[]");
      house.push(entry.item);
      localStorage.setItem("sts_house_loot", JSON.stringify(house));
    }
    // dest === "winner" → the winning player keeps it; their owned-gear set already holds it.
  } catch (e) {
    console.warn("loot persist failed:", e);  // visible, not silent
  }
}

function checkWin() {
  if (state.phase === "over") return;          // idempotent — never re-fire a finished battle

  // KRAKEN "BREAK FREE" OBJECTIVE — checked BEFORE side-elimination: sever N arms OR survive M
  // rounds and the player escapes (a non-wipe win condition). severable arms are counted in
  // state.severed (applyDamage); survival counts full rounds elapsed. Honors unit.severable.
  if (state.objective && state.objective.kind === "sever") {
    const severed = state.severed || 0;
    const need = state.objective.severTarget || 0;
    const outlasted = state.objective.surviveRounds > 0 && state.round > state.objective.surviveRounds;
    if ((need > 0 && severed >= need) || outlasted) {
      state.phase = "over";
      const why = need > 0 && severed >= need
        ? `severed ${severed}/${need} arms` : `survived ${state.objective.surviveRounds} rounds`;
      log(`=== BROKE FREE — ${why}! The kraken sinks away. ===`, "win");
      if (state.mode === "encounter") finishEncounter(true, false);
      else { bannerEl.textContent = "BROKE FREE"; bannerEl.classList.add("show"); }
      return;
    }
  }

  // SIDE-ELIMINATION = the resolver's evaluateOutcome() (the ONE shared win rule, so the
  // server's replay verdict and the client's banner can never diverge on who won).
  const outcome = evaluateOutcome(state.units);
  if (outcome.over) {
    state.phase = "over";
    const playerWon = outcome.winner === "player";
    const draw = outcome.winner === "draw";
    const label = outcome.label;
    log(`=== ${label} ===`, "win");
    // VOYAGE ENCOUNTER: route the player back toward the map/journey instead of a plain
    // "ENEMY WINS" wall. PVP duels + training keep the unchanged textContent banner.
    if (state.mode === "encounter") finishEncounter(playerWon, draw);
    else bannerEl.textContent = label;
    bannerEl.classList.add("show");
  }
}

/** VOYAGE ENCOUNTER OUTCOME. The journey time-lock from setSail keeps running to arrival on
 *  its OWN — this only steers the player back to the voyage and, on a loss, lets the
 *  gear-loss sink the combat already applied stand. WIN → resume the voyage. */
function finishEncounter(playerWon, draw) {
  const ctx = resolveEncounter(playerWon ? "win" : draw ? "draw" : "loss") || readEncounter();
  const back = (ctx && ctx.returnTo) || "/seas/";
  if (playerWon) {
    bannerEl.innerHTML = `RAIDERS REPELLED — <a href="${back}" style="color:#2ecc71;text-decoration:none">⛵ Continue the voyage →</a>`;
    log("Raiders repelled! Your ship sails on — the voyage continues to its destination.", "win");
    // STAKES FIGHT (bilge rats): ask the seas-server to verify the win + queue the loot payout.
    // No-op for an unstamped encounter (state.settle null). Fire-and-forget; failures log visibly.
    if (state.settle) verifyAndSettle();
  } else if (draw) {
    bannerEl.innerHTML = `BOTH CREWS DOWN — <a href="${back}" style="color:#e6b422;text-decoration:none">⚓ Drift back to port →</a>`;
  } else {
    bannerEl.innerHTML = `RAIDERS TOOK THEIR CUT — <a href="${back}" style="color:#e6b422;text-decoration:none">⚓ Limp back to port →</a>`;
    log("The raiders took their cut — gear lost to the water. Your ship still drifts on toward port.", "down");
  }
}

// ── Turn flow ───────────────────────────────────────────────────────────────────
function endTurn() {
  if (state.phase === "over") return;
  // SETTLEMENT: close the PLAYER's turn in the verifiable log (the per-turn boundary the server's
  // replay consumes). Only for a player whose turn is actually ending (enemy turns aren't recorded).
  { const c = current(); if (c && c.isPlayer) recAct({ unit: c.id, type: "end" }); }
  // advance to next CONSCIOUS unit; bump round when we wrap. A DOWNED unit (0..-10) is
  // skipped in the turn order — but at the moment we pass over its slot it BLEEDS 1 HP,
  // drifting toward -10 (where it drops its gear). That's the death-sink clock running.
  let guard = 0;
  do {
    state.turnIdx = (state.turnIdx + 1) % state.units.length;
    if (state.turnIdx === 0) state.round++;
    const u = state.units[state.turnIdx];
    if (isUnconscious(u)) bleed(u);   // downed but not yet dead → tick toward -10
    guard++;
  } while (!isConscious(state.units[state.turnIdx]) && guard <= state.units.length);
  checkWin();                          // the round may have advanced → kraken survival / wipe check
  if (state.phase === "over") { render(); return; }   // bleed/objective may have ended the fight
  startTurn();
}

/** BLEED: a DOWNED unit loses 1 HP as its turn comes up, drifting toward -10. At -10 it
 *  drops its gear (checkMortality). Logged so the player sees the clock. */
function bleed(u) {
  if (!isUnconscious(u)) return;
  u.currentHp -= 1;
  log(`${u.name} is bleeding out… (${u.currentHp} HP)`, "down");
  checkMortality(u);   // may cross -10 this tick → drop gear
  checkWin();
}

function startTurn() {
  if (state.phase === "over") return;
  const u = current();
  // SAFETY: a DOWNED unit can't act — it bleeds and we skip straight to the next turn.
  // (endTurn already bleeds + skips downed units; this guards any path that lands here.)
  if (isUnconscious(u)) { bleed(u); if (state.phase !== "over") endTurn(); else render(); return; }
  u.hasMoved = false;
  u.hasActed = false;
  // tick down active spell effects (ToT-style duration) at the top of a unit's turn
  u.activeEffects = (u.activeEffects || []).filter((e) => {
    if (e.remainingRounds === -1) return true;
    e.remainingRounds -= 1;
    return e.remainingRounds > 0;
  });
  state.phase = "idle";
  clearHighlights();
  // P6 TELEGRAPH: paint THIS enemy's planned move + strike BEFORE it acts (no ghost on a player turn).
  state.telegraph = u.isPlayer ? [] : [planIntent(u, aiCtx(u))];
  log(`— ${u.name}'s turn (${u.className}) —`, "turn");
  render();
  // P7 FOLLOW-ACTIVE: glide the camera onto the unit whose turn it is (clamped; small board barely moves).
  if (cam) { const p = hexToPixel(u.position); cam.focusOn(p.x, p.y); }
  // Enemy units act on their own. Player units wait for input.
  if (!u.isPlayer && state.phase !== "over") setTimeout(aiTurn, 650);
}

// ── Enemy AI — driven by combat-helpers.planIntent() (focus-fire / kite / screen) + chokepoint ──
// planIntent() is the SAME brain that feeds the telegraph, so the ghost the player saw is exactly
// what the unit does. game.js supplies the board context (foes/allies/reach/ranges) and executes
// the returned plan through strike()/castSpellAt(), re-validating the target after any kills.

function nearestFoe(u) {
  const foes = state.units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
  if (!foes.length) return null;
  return foes.reduce((a, b) =>
    hexDistance(u.position, a.position) <= hexDistance(u.position, b.position) ? a : b);
}

/** Furthest hex (move/attack/spell) the unit can affect from where it stands. */
function actReach(u) {
  let r = u.attackRange || 1;
  if (u.role === "caster" && Array.isArray(u.availableSpells))
    for (const sid of u.availableSpells) { const sp = SPELLS[sid]; if (sp) r = Math.max(r, sp.battle.hexRange ?? 1); }
  return r;
}

/** Largest hexArea among a caster's in-kit DAMAGE spells (telegraph blast zone), else 0. */
function bestSpellArea(u) {
  if (u.role !== "caster" || !Array.isArray(u.availableSpells)) return 0;
  let area = 0;
  for (const sid of u.availableSpells) {
    const sp = SPELLS[sid];
    if (sp && sp.battle && sp.battle.type === "damage") area = Math.max(area, sp.battle.hexArea || 0);
  }
  return area;
}

/** Read-only board context the combat-helpers planner + target picker consume. */
function aiCtx(u) {
  const foes = state.units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
  const allies = state.units.filter((e) => isConscious(e) && e.isPlayer === u.isPlayer);
  return {
    foes, allies,
    reach: (unit) => hexesInRange(unit.position, encMove(unit), occupiedSet(unit)),  // encumbrance-aware
    dist: (a, b) => hexDistance(a, b),
    actRange: (unit) => actReach(unit),
    meleeRange: (unit) => unit.attackRange || 1,
    ownCaster: allies.find((a) => a !== u && a.role === "caster") || null,
    aoeArea: (unit) => bestSpellArea(unit),
    // P8: a clear-line predicate so the planner KITES to a hex it can actually SEE the target from
    // (and never telegraphs a shot through a wall). No terrain (duels/training) → always clear.
    hasLos: (fromHex, targetPos) => losClear(fromHex, targetPos, state.terrainIx),
  };
}

function aiAct(u, target) {
  if (!target || u.hasActed) return false;
  if (!isConscious(u)) return false;   // TERRAIN GUARD: a unit downed mid-move (hazard/overboard on entry) does NOT also get to strike this turn
  const dist = hexDistance(u.position, target.position);
  // P8: a clear line is required to cast/shoot at distance ≥ 2 (can't reach THROUGH a wall).
  const losOk = dist <= 1 || losClear(u.position, target.position, state.terrainIx);
  // caster: cast the first DAMAGE spell whose range reaches the target (heal/buff AI not needed vs foes)
  if (u.role === "caster" && Array.isArray(u.availableSpells)) {
    for (const sid of u.availableSpells) {
      const sp = SPELLS[sid]; if (!sp || !sp.battle || sp.battle.type !== "damage") continue;
      if (losOk && dist <= (sp.battle.hexRange ?? 1)) { castSpellAt(u, sp, target); u.hasActed = true; return true; }
    }
  }
  // weapon strike if in range (chokepoint: weapon-dice + per-weapon crit ranges; P8: wall blocks the ranged line)
  if (dist <= (u.attackRange || 1)) {
    const res = strike(u, target, { distance: dist, coverAC: coverACAt(state.terrainIx, target.position), terrainIx: state.terrainIx, rng: state.rng });   // TERRAIN: cover → +AC; P8: LOS gate
    log(`${u.name} strikes ${target.name}: ${res.breakdown}`, res.hit ? "hit" : "miss");
    if (res.hit) applyDamage(target, res.damage);
    u.hasActed = true; return true;
  }
  return false;
}

function aiTurn() {
  const u = current();
  if (state.phase === "over" || u.isPlayer) return;
  const ctx = aiCtx(u);
  const intent = (state.telegraph && state.telegraph[0]) || planIntent(u, ctx);
  // 1) MOVE along the telegraphed plan (the ghost the player just saw).
  if (intent && intent.moveTo && !samePos(intent.moveTo, u.position) && !u.hasMoved) {
    u.position = { q: intent.moveTo.q, r: intent.moveTo.r };
    u.hasMoved = true;
    log(`${u.name} advances to (${u.position.q},${u.position.r}).`, "info");
    applyTileEntry(u);           // TERRAIN: hazard/water-edge on entering
  }
  state.telegraph = [];          // intent consumed → clear the ghost
  render();
  if (state.phase === "over") return;   // a fatal hazard/overboard on entry may have ended the fight
  // 2) act, then end the turn (short delays so the player can read it)
  setTimeout(() => {
    if (state.phase === "over") return;
    // RE-VALIDATE the target after any kills this phase: the planned foe may be down → re-pick.
    const foes = state.units.filter((e) => isConscious(e) && e.isPlayer !== u.isPlayer);
    const target = intent && intent.target && isConscious(intent.target) ? intent.target : chooseTarget(u, foes);
    if (!target) { checkWin(); render(); setTimeout(() => { if (state.phase !== "over") endTurn(); }, 300); return; }
    aiAct(u, target); render();
    setTimeout(() => { if (state.phase !== "over") endTurn(); }, 600);
  }, 600);
}

// ── Buttons ─────────────────────────────────────────────────────────────────────
btnMove.addEventListener("click", enterMove);
btnAttack.addEventListener("click", enterAttack);
btnEnd.addEventListener("click", endTurn);
btnReset.addEventListener("click", init);

/**
 * Normalize a group objective (string | object | null) into a structured win-condition. For the
 * kraken "sever" objective, resolve N (arms to sever) + M (rounds to survive): prefer values the
 * encounter forwarded, else DERIVE N from the severable units on the board (≈0.6 of them, matching
 * area-encounters' severFraction) and default M (KRAKEN_SURVIVE_ROUNDS). A "wipe"/unknown/absent
 * objective → null = the plain last-side-standing win. ADDITIVE: callers that pass no objective
 * (every fight today except the kraken) get null and the verbatim behaviour.
 */
function normalizeObjective(raw, units, extra = {}) {
  if (!raw) return null;
  const kind = typeof raw === "object" && raw ? (raw.kind || "wipe") : String(raw).toLowerCase();
  if (kind !== "sever") return kind === "wipe" ? null : { kind };
  const sevCount = (units || []).filter((u) => u && u.severable).length;
  const derivedN = Math.max(2, Math.ceil(sevCount * 0.6));
  const pick = (a, b, dflt) => (Number.isFinite(a) && a > 0 ? Math.floor(a) : (Number.isFinite(b) && b > 0 ? Math.floor(b) : dflt));
  return {
    kind: "sever",
    severTarget: pick(extra.severTarget, raw.severTarget, derivedN),
    surviveRounds: pick(extra.surviveRounds, raw.surviveRounds, KRAKEN_SURVIVE_ROUNDS),
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────
/**
 * fightSeed — the rng seed for THIS fight. Priority:
 *   1. a SERVER-ISSUED seed (the sign-to-enter anchor / fight nonce) exposed as
 *      window.SEAS_FIGHT_SEED, or a ?seed= URL param — so the seas-server can later
 *      pin the seed (anti-grind) and replay this exact fight to verify the win.
 *   2. else a locally-minted per-fight seed (still fully deterministic FROM that seed;
 *      the seed itself is just unique-per-fight here). Math.random/Date live in the
 *      CLIENT seed mint only — never inside the resolver (which is pure + headless).
 * @returns {string}
 */
function fightSeed() {
  if (typeof window !== "undefined") {
    if (window.SEAS_FIGHT_SEED != null) return String(window.SEAS_FIGHT_SEED);
    if (window.location && window.location.search) {
      try {
        const q = new URLSearchParams(window.location.search).get("seed");
        if (q) return q;
      } catch (e) { console.warn("fight seed url parse failed:", e); }  // visible, not silent
    }
  }
  return `seas-fight-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

/**
 * SETTLEMENT CONTEXT — a STAKES fight (bilge rats) is launched (bilge.html) with a SERVER-ISSUED
 * seed + nonce, stamped on window so this deck knows to ask the seas-server to VERIFY the win.
 * Returns { fight, nonce, player, verifyUrl } or null (training/PVP/duels never set these → no-op).
 */
function readSettleContext(fightSeedVal) {
  if (typeof window === "undefined") return null;
  // The bilge launcher stamps the fight on window OR (across navigation) in localStorage.
  let ctx = window.SEAS_FIGHT_NONCE ? {
    fight: window.SEAS_FIGHT_KIND || "bilge-rats", nonce: String(window.SEAS_FIGHT_NONCE), seed: window.SEAS_FIGHT_SEED || null,
    player: window.SEAS_FIGHT_PLAYER || null, pawnId: window.SEAS_FIGHT_PAWN || null, verifyUrl: window.SEAS_VERIFY_URL || null,
  } : null;
  if (!ctx && typeof localStorage !== "undefined") {
    try { const raw = localStorage.getItem("sts_fight_settle"); if (raw) ctx = JSON.parse(raw); }
    catch (e) { console.warn("settle context parse failed:", e); }   // visible, not silent
  }
  if (!ctx || !ctx.nonce) return null;
  // SCOPE TO THIS FIGHT: only treat it as a stakes fight when the launcher's seed matches the seed
  // THIS battle is running on. Otherwise a stale context would make the NEXT (training) win try to
  // settle. A training spar mints its own local seed (no launcher) → no match → null (no settle).
  if (fightSeedVal != null && ctx.seed && String(ctx.seed) !== String(fightSeedVal)) return null;
  return {
    fight: ctx.fight || "bilge-rats",
    nonce: String(ctx.nonce),
    player: ctx.player ? String(ctx.player) : null,
    pawnId: ctx.pawnId ? String(ctx.pawnId) : null,
    verifyUrl: ctx.verifyUrl || ((window.SEAS_API_BASE || "/seas-api") + "/seas/verify-fight"),
  };
}

/**
 * VERIFY + SETTLE a stakes win with the seas-server: submit { player, nonce, playerTeam, playerActions }
 * → the server REPLAYS resolver.resolveEncounter (re-computing the rats) and returns the AUTHORITATIVE
 * winner. Only a server-confirmed player win records a PENDING loot claim (the keeper pays later). NO
 * silent catch — a network/verify failure is shown in the log (the player still keeps their on-screen win).
 */
async function verifyAndSettle() {
  const s = state.settle;
  if (!s || !s.player) return;                          // not a stakes fight (or no wallet/pawn) → nothing to settle
  // Submit the START snapshot (muster positions + full HP) — the server replays from there with the
  // recorded actions; the live units have since moved/taken damage, which would desync the replay.
  const playerTeam = state.startSnapshot || state.units.filter((u) => u.isPlayer);
  try {
    log("Asking the harbour authority to verify the fight…", "info");
    const resp = await fetch(s.verifyUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: s.player, nonce: s.nonce, playerTeam, playerActions: state.actionLog }),
    });
    const body = await resp.json();
    if (!resp.ok || !body.ok) { log(`Verify failed: ${body && body.reason ? body.reason : resp.status}`, "down"); return; }
    if (body.winner === "player" && body.payoutEligible) {
      log("✅ Verified WIN — your cut is logged. Loot is queued for payout.", "win");
      recordStakesClaim(s, body);
      recordWalkaboutResult(s, true);
    } else {
      log(`Server verdict: ${body.winner} (payout ${body.payoutEligible ? "eligible" : "not eligible"}).`, "info");
      // a conclusive enemy win = a walkabout LOSS (sent home stripped — the walkabout resets)
      if (body.winner === "enemy") recordWalkaboutResult(s, false);
    }
  } catch (e) {
    log(`Could not reach the verify service: ${e.message}`, "down");   // visible, not silent
  }
}

/** WALKABOUT RESULT (founder 2026-07-08): the cave path consumes this on return —
 *  a WIN clears the node (recharge clock starts); a LOSS wipes cave progress (sent home
 *  without gear or loot — the strip itself lands with the server-side death settle). */
function recordWalkaboutResult(s, win) {
  if (typeof localStorage === "undefined" || !s.walkabout || !s.walkabout.node) return;
  try {
    localStorage.setItem("walkabout:result", JSON.stringify({
      hero: s.walkabout.hero || "guest", node: s.walkabout.node, win: !!win, at: Date.now(),
    }));
  } catch (e) { console.warn("walkabout result persist failed:", e); }   // visible, not silent
}

/** Per-fight settlement wiring: which localStorage claims key + which deployed LootPool the keeper pays
 *  from. Keeps each fight's win in its OWN claims store + pool so the right keeper settles it. Mirrors the
 *  lib modules (bilge-rats.js / goblin-cave.js LOOT_POOL + K_CLAIMS). New stakes fights add a row here. */
const STAKES_SITES = {
  "bilge-rats":  { key: "sts_bilge_claims",     lootPool: "0xE07CE9Ec642d42C5c8A0068203068BAc6042bF57" },
  "goblin-cave": { key: "sts_goblincave_claims", lootPool: "0xf917d1660c72F2D48141a965c82CCBE8a2A175A6" },
};

/** Record a PENDING loot claim (game-layer) for the keeper to settle via LootPool.payout, routed to the
 *  RIGHT store + pool for THIS fight (bilge arena vs goblin cave). collection/tokenId are left for the
 *  founder/keeper to resolve from the pawn (free-play heroes are house-owned → no player NFT yet). */
function recordStakesClaim(s, body) {
  if (typeof localStorage === "undefined") return;
  const fight = s.fight || "bilge-rats";
  const site = STAKES_SITES[fight];
  if (!site) { console.warn("no claim store for fight kind:", fight); return; }   // visible, not silent
  try {
    const claims = JSON.parse(localStorage.getItem(site.key) || "[]");
    claims.push({
      site: fight, pawnId: s.pawnId || s.player, runId: `${fight}-${s.nonce}`,
      status: "pending", wonAt: Date.now(), lootPool: site.lootPool,
      collection: null, tokenId: null,            // founder/keeper resolves the pawn NFT for ownerOf
      seed: body.seed || null, nonce: s.nonce, verifiedWinner: "player",
    });
    localStorage.setItem(site.key, JSON.stringify(claims));
    localStorage.removeItem("sts_fight_settle");   // consumed — don't re-verify on a Reset/replay
  } catch (e) { console.warn("stakes claim persist failed:", e); }   // visible, not silent
}

function init() {
  logEl.innerHTML = "";
  bannerEl.classList.remove("show");
  bannerEl.textContent = "";
  ensureBoardSize();
  const built = makeStarterUnits();

  // makeStarterUnits() may return EITHER a plain units[] (default training) or one of
  // several control shapes. Normalize into { units, stakes, arena } here so the default
  // single-player flow is untouched and PVP just flips the stakes/arena gate.
  let units, stakes = false, arena = "deck", pvp = false, mode = "training";
  let objective = null, mapId = null, groupName = null;   // multi-enemy GROUP framing (additive)
  let severTarget = null, surviveRounds = null;           // optional kraken break-free params (else derived)
  if (Array.isArray(built)) {
    units = built;                                   // default TRAINING (player vs sparring)
  } else if (built && built.locked) {
    // pawn is on the job (employment lock) → can't fight; show the block, don't start.
    log(built.message || "That crew hand is on the job and can't fight right now.", "down");
    bannerEl.textContent = "ON THE JOB";
    bannerEl.classList.add("show");
    return;
  } else if (built && built.pvpNoOpponent) {
    // PVP requested but no opponent snapshot chosen yet → point the player to setup.
    log("No PVP opponent chosen. Pick a rival crew on the PVP page, then return.", "info");
    bannerEl.innerHTML = `NO OPPONENT — <a href="pvp.html" style="color:#e6b422">choose a rival ⚔️</a>`;
    bannerEl.classList.add("show");
    return;
  } else if (built && built.pvp) {
    // OPEN-SEA fight (PVP duel OR a voyage PVE encounter) → REAL stakes, loot sinks.
    units = built.units;
    stakes = true;       // open-sea persists loot (vs harbor training which doesn't)
    arena = "water";     // water arena = 100% house (loot sinks) — open-sea rule
    pvp = true;
    mode = built.mode || "pvp";   // "encounter" (raiders on a route) vs "pvp" (a duel)
    objective = built.objective || null;   // group win-condition (null/"wipe" = current behaviour)
    mapId = built.mapId || null;           // battle-map id from the encounter (terrain art hook)
    groupName = built.groupName || null;   // e.g. "Cave Goblin Pack" (framing only)
    severTarget = built.severTarget || null;     // kraken N (optional; else derived from severable count)
    surviveRounds = built.surviveRounds || null; // kraken M (optional; else KRAKEN_SURVIVE_ROUNDS)
  } else {
    log("Could not build the skirmish (no units returned).", "down");
    return;
  }

  // ── P4 GRID-SIZE: fit the board to the fight. A 1v1 duel (training/PVP) keeps the VERBATIM
  // 9×7 deck; a multi-pawn skirmish (a voyage GROUP encounter, and future squads) gets the
  // roomier ~16×9 squad deck. 1 hex = 5 ft. The grid-config SHADOW makes the board any size
  // without touching the engine; ship-scale (20×6) + boarding (20×14) presets wait on the
  // camera (P7). (Spawn placement still packs the engine-side right columns — refining spawns
  // to the full squad width is P5; the bigger board is a strict superset, so it's safe now.)
  const squadBoard = units.length > 2;
  setGrid(
    squadBoard ? GRID_PRESETS.squad.cols : GRID_PRESETS.duel.cols,
    squadBoard ? GRID_PRESETS.squad.rows : GRID_PRESETS.duel.rows,
  );
  ensureBoardSize();
  // P7 CAMERA: attach the pan/zoom/recenter viewport ONCE, then (re)fit it to this board size.
  if (!cam) cam = createCamera(boardEl);
  cam.onResize();

  // COSMETIC TERRAIN: resolve the deck's authored terrain data from the encounter's map id
  // (null for duels/training/PVP or an un-authored deck → drawTerrain() draws nothing).
  const mapData = getMap(mapId);

  // COMBAT-SETTLEMENT SEED: mint THIS fight's rng seed. A server-issued seed (sign-to-enter
  // anchor, anti-grind) takes priority via ?seed= / window.SEAS_FIGHT_SEED; absent one we mint a
  // local per-fight seed so the client is still deterministic-from-seed today (the server-replay
  // wiring lands later — that step only needs the SAME seed to recompute this fight). makeRng()
  // gives a Math.random-shaped fn that every strike()/castWrapped()/resolveOverboard() consumes.
  const seed = fightSeed();
  const rng = makeRng(seed);

  state = {
    units, turnIdx: 0, round: 1, phase: "idle",
    seed, rng,            // per-fight deterministic rng (server can replay with the same seed)
    reachable: new Set(), targets: new Set(), pendingSpell: null,
    // STAKES GATE: harbor battles are TRAINING → stakes:false. The gear-drop is shown +
    // mechanical but NOT persisted, so a sparring loss never destroys real owned gear.
    // Open-sea PVP sets stakes:true (loot persists) + arena:"water" (loot sinks to house).
    stakes,
    // ARENA: "deck" (ship) = 50/50 found vs house · "water" = 100% house (loot sinks).
    arena,
    // MODE: "training" | "pvp" (duel) | "encounter" (raiders on a sail route). Drives the
    // framing + the win/return flow; stakes/arena are identical for pvp & encounter.
    mode,
    // GROUP framing (multi-enemy voyage encounters). objective is NORMALIZED into a structured
    // win-condition ({kind:"sever",severTarget,surviveRounds} for the kraken, else null = wipe).
    objective: normalizeObjective(objective, units, { severTarget, surviveRounds }), mapId, groupName,
    mapData, terrainIx: terrainIndex(mapData),   // cosmetic per-deck terrain overlay (maps/<id>.js)
    severed: 0,           // severable arms cut this fight (kraken break-free objective)
    telegraph: [],        // P6 Into-the-Breach intent ghosts (rebuilt each enemy turn)
    // COMBAT SETTLEMENT: record the PLAYER's actions (move/attack/spell/end) in order so a STAKES
    // encounter can be SERVER-VERIFIED (seas-server /seas/verify-fight replays resolver.resolveEncounter
    // from { seed, playerActions } — the rats are re-computed, never trusted). Enemy turns are NOT
    // recorded (the server derives them). Harmless for training/PVP (just an array nobody submits).
    actionLog: [],
    // a bilge (or future stakes) fight stamps these from the launcher (window.SEAS_FIGHT_*) so the
    // win path knows to ask the server to verify + settle. null for training/PVP/duels.
    settle: readSettleContext(seed),
    // START-OF-FIGHT player snapshot — the server replays from THIS (muster positions + full HP),
    // re-computing the rats from the seed + these start hexes, then applies the recorded actions.
    // Must be the pre-turn state (the live units move/take damage during play). Deep-cloned.
    startSnapshot: null,
  };
  state.startSnapshot = JSON.parse(JSON.stringify(state.units.filter((u) => u.isPlayer)));
  if (pvp && mode === "encounter") {
    // VOYAGE PVE ENCOUNTER — framed as raiders blocking the route, not a duel. Now N-vs-N aware:
    // a whole GROUP (rats / goblin pack / kraken arms) reads from groupName + foe count.
    const foes = units.filter((u) => !u.isPlayer);
    const you = units.find((u) => u.isPlayer)?.name || "you";
    const ctx = readEncounter();
    const crew = groupName || foes[0]?.name || "A raider crew";
    const countStr = foes.length > 1 ? ` (${foes.length} foes)` : "";
    log(`🏴‍☠️ Raiders on the route! ${crew}${countStr} blocks ${you}'s passage${ctx && ctx.danger != null ? ` (danger ${ctx.danger})` : ""}.`, "down");
    if (state.objective && state.objective.kind === "sever") {
      log(`Objective: BREAK FREE — sever ${state.objective.severTarget} arms OR survive ${state.objective.surviveRounds} rounds.`, "info");
    } else if (objective && objective !== "wipe") {
      log(`Objective: ${String(objective)} — then clear or break free.`, "info");
    }
    log("Clear the deck to sail on — win and the voyage continues to its destination.", "info");
    log("OPEN SEA — real stakes: gear that drops here is LOST to the water (no take-backs).", "down");
  } else if (pvp) {
    const foe = units.find((u) => !u.isPlayer);
    log(`Open-sea PVP: ${units.find((u) => u.isPlayer)?.name || "you"} vs ${foe?.name || "a rival"} (AI-piloted snapshot).`, "info");
    log("Hex grid + d20 combat + spells reused from Tales-of-Tasern. Stats from the class engine.", "info");
    log("OPEN SEA — real stakes: gear that drops here is LOST to the water (no take-backs).", "down");
  } else {
    log("Ship-deck skirmish: your fighter (player) vs a sparring caster (enemy). Hot-seat.", "info");
    log("Hex grid + d20 combat + spells reused from Tales-of-Tasern. Stats from the class engine.", "info");
    log("Training bout — gear-drops are shown but NOT saved (no stakes).", "info");
  }
  startTurn();
}

init();
