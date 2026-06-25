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
import { ITEMS, SLOTS, equipItem, equippedList, ownedGear } from "./items.js";
import {
  HEX_SIZE, GRID_COLS, GRID_ROWS, allHexes, hexToPixel, hexPolygonPoints,
  gridPixelDimensions, hexDistance, hexNeighbors, hexesInRange, isAdjacent,
  rollD20, resolveAttack, resolveSpellCast, isAlive, isConscious,
} from "./tot-engine.js";

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

/** @type {{units:any[], turnIdx:number, round:number, phase:string, reachable:Set<string>, targets:Set<string>, pendingSpell:any}} */
let state;

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
const occupiedSet = (exclude) =>
  new Set(state.units.filter((u) => isAlive(u) && u !== exclude).map((u) => key(u.position)));
const unitAtHex = (h) => state.units.find((u) => isAlive(u) && u.position.q === h.q && u.position.r === h.r);

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

function render() {
  while (boardEl.firstChild) boardEl.removeChild(boardEl.firstChild);
  drawDeck();
  drawHexes();
  for (const u of state.units) if (isAlive(u)) drawUnit(u);
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
  btnMove.disabled = state.phase === "over" || u.hasMoved;
  btnAttack.disabled = state.phase === "over" || u.hasActed;
  btnEnd.disabled = state.phase === "over";

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

function showStats(u) {
  const cls = u.qualified[0];
  const abilities = cls ? cls.availableAbilities.map((a) => a.name).join(", ") : "—";
  const endow = Object.entries(u.endowment).map(([k, v]) => `${k}:$${v}`).join("  ");
  const gear = equippedList(u);
  const gearStr = gear.length ? gear.map((g) => `${g.emoji} ${g.name}`).join(", ") : "—";
  const S = u.engineStats;
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
      <span>Move <b>${u.movementHexes} hex</b></span>
      ${u.role === "caster" ? `<span>Spell DC <b>${u.spellDC}</b></span>` : ""}
    </div>
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
  const reach = hexesInRange(u.position, u.movementHexes, occupiedSet(u));
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
      .filter((e) => isAlive(e) && e.isPlayer !== u.isPlayer && hexDistance(u.position, e.position) <= u.attackRange)
      .map((e) => key(e.position)),
  );
  if (state.targets.size === 0) log(`${u.name}: no foe adjacent to strike.`, "info");
  render();
}

function beginSpell(sp) {
  const u = current();
  if (u.hasActed || state.phase === "over") return;
  clearHighlights();
  state.phase = "spell";
  state.pendingSpell = sp;
  const range = sp.battle.hexRange ?? 1;
  state.targets = new Set(
    state.units
      .filter((e) => isAlive(e) && e.isPlayer !== u.isPlayer && hexDistance(u.position, e.position) <= range)
      .map((e) => key(e.position)),
  );
  if (state.targets.size === 0) log(`${u.name}: no target within ${range} hexes for ${sp.name}.`, "info");
  render();
}

// ── Click resolution ────────────────────────────────────────────────────────────
function onHexClick(h) {
  if (state.phase === "over") return;
  const u = current();
  const k = key(h);

  if (state.phase === "move" && state.reachable.has(k)) {
    u.position = { q: h.q, r: h.r };
    u.hasMoved = true;
    log(`${u.name} moves to (${h.q},${h.r}).`, "info");
    state.phase = "idle"; clearHighlights(); render();
    return;
  }

  if (state.phase === "attack" && state.targets.has(k)) {
    const target = unitAtHex(h);
    if (!target) return;
    const nat = rollD20();
    const res = resolveAttack(u, target, nat, hexDistance(u.position, target.position));
    log(`${u.name} strikes ${target.name}: ${res.breakdown}`, res.hit ? "hit" : "miss");
    if (res.hit) applyDamage(target, res.damage);
    u.hasActed = true;
    state.phase = "idle"; clearHighlights(); render();
    return;
  }

  if (state.phase === "spell" && state.targets.has(k)) {
    const target = unitAtHex(h);
    if (!target) return;
    const sp = state.pendingSpell;
    const res = resolveSpellCast(u, target, sp.id, sp.name, sp.level, sp.battle);
    log(`${u.name} casts ${sp.name} at ${target.name}: ${res.breakdown}`, res.damage ? "hit" : "miss");
    if (res.damage) applyDamage(target, res.damage);
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
  target.currentHp -= dmg;
  if (!isConscious(target)) {
    log(`${target.name} falls! (${target.currentHp} HP)`, "down");
  }
  checkWin();
}

function checkWin() {
  const sides = new Set(state.units.filter((u) => isConscious(u)).map((u) => u.isPlayer));
  if (sides.size <= 1) {
    state.phase = "over";
    const playerWon = sides.has(true);
    const label = sides.size === 0 ? "DRAW" : playerWon ? "PLAYER WINS" : "ENEMY WINS";
    bannerEl.textContent = label;
    bannerEl.classList.add("show");
    log(`=== ${label} ===`, "win");
  }
}

// ── Turn flow ───────────────────────────────────────────────────────────────────
function endTurn() {
  if (state.phase === "over") return;
  // advance to next conscious unit; bump round when we wrap
  let guard = 0;
  do {
    state.turnIdx = (state.turnIdx + 1) % state.units.length;
    if (state.turnIdx === 0) state.round++;
    guard++;
  } while (!isConscious(state.units[state.turnIdx]) && guard <= state.units.length);
  startTurn();
}

function startTurn() {
  if (state.phase === "over") return;
  const u = current();
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
  log(`— ${u.name}'s turn (${u.className}) —`, "turn");
  render();
}

// ── Buttons ─────────────────────────────────────────────────────────────────────
btnMove.addEventListener("click", enterMove);
btnAttack.addEventListener("click", enterAttack);
btnEnd.addEventListener("click", endTurn);
btnReset.addEventListener("click", init);

// ── Boot ─────────────────────────────────────────────────────────────────────
function init() {
  logEl.innerHTML = "";
  bannerEl.classList.remove("show");
  bannerEl.textContent = "";
  ensureBoardSize();
  const units = makeStarterUnits();
  state = {
    units, turnIdx: 0, round: 1, phase: "idle",
    reachable: new Set(), targets: new Set(), pendingSpell: null,
  };
  log("Ship-deck skirmish: Barbarian (player) vs Wizard (enemy). Hot-seat.", "info");
  log("Hex grid + d20 combat + spells reused from Tales-of-Tasern. Stats from the class engine.", "info");
  startTurn();
}

init();
