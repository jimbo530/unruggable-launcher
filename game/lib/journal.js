// @ts-check
// game/lib/journal.js — THE PAWN'S JOURNAL (founder 2026-07-08: "every pawn keep a
// journal that later reads like a book writen about the players adventures").
//
// TWO HALVES:
//   1) THE LEDGER — record(pawnId, type, data): systems append events as they happen
//      (buy a pawn -> "birth"; finish a shift -> "job"; verified fight -> "fight";
//      voyage lands -> "journey"; death settle -> "death"; achievement -> "feat";
//      prospecting, purchases, builds — one line each). Cheap, append-only,
//      localStorage (the house pattern: weight.js / bank.js twin).
//   2) THE BOOK — readBook(pawnId): renders the ledger as a chaptered memoir. Each pawn
//      gets a consistent VOICE (plain / boastful / wistful — seeded by pawnId) and each
//      event picks its phrasing deterministically, so two pawns who lived the same week
//      tell it differently, and re-reading never rewrites history. Founder: "many will
//      be the same or simmilar but these stories would be fun" — fun > unique.
//
// WIRING (follow-up pass): jobs-loop -> job; battle-grid settle -> fight/death;
// location tryArrive -> journey; bank deposit/withdraw big sums -> fortune; goblin-cave
// claim -> loot; achievements keeper -> feat. Callers pass PLACE NAMES (the map is
// words) — never coordinates.
//
// no silent catches — corrupt ledgers warn loudly and reset; bad events throw.

const KEY_PREFIX = "seas:journal:";

const store = (() => {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
})();

function key(pawnId) { return KEY_PREFIX + String(pawnId); }

function readLedger(pawnId) {
  const raw = store.getItem(key(pawnId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("not an array");
    return arr;
  } catch (e) {
    console.warn("[journal] corrupt ledger for " + pawnId + " — resetting (" + e.message + ")");
    store.removeItem(key(pawnId));
    return [];
  }
}

const KNOWN = ["birth", "job", "fight", "journey", "death", "feat", "loot", "fortune", "purchase", "build", "prospect", "note"];

/**
 * Append one life event. data is a small bag of names/numbers the renderer knows:
 *  birth    {port}                       job     {job, place, days?, pay?}
 *  fight    {foe, place, won}            journey {from, to, days, by?}
 *  death    {foe?, place, home}          feat    {title}
 *  loot     {what, place}                fortune {what, amount, place}
 *  purchase {what, place, price?}        build   {what, place}
 *  prospect {place, found?}              note    {text}
 */
export function record(pawnId, type, data = {}, at = Date.now()) {
  if (!KNOWN.includes(type)) throw new Error("[journal] unknown event type: " + type);
  const ledger = readLedger(pawnId);
  ledger.push({ at, type, ...data });
  store.setItem(key(pawnId), JSON.stringify(ledger));
  return ledger.length;
}

/** The raw ledger (read-only copy) — keepers/UI can inspect without prose. */
export function events(pawnId) { return readLedger(pawnId).slice(); }

// ── the book ─────────────────────────────────────────────────────────────────────────
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pick(arr, pawnId, idx, salt) { return arr[hash(pawnId + ":" + idx + ":" + salt) % arr.length]; }

// three voices; a pawn keeps one for life
const VOICES = ["plain", "boastful", "wistful"];

const LINES = {
  birth: {
    plain: ["I came to {port} with nothing but my hands.", "My story starts on the docks of {port}."],
    boastful: ["{port} did not know it yet, but a legend had just stepped ashore.", "The day I arrived in {port}, the gulls themselves took notice."],
    wistful: ["I still remember the smell of {port} that first morning — salt, tar, and possibility.", "Everything I became began quietly, on a pier in {port}."],
  },
  job: {
    plain: ["Worked as {job} in {place}.{payline}", "Took a shift as {job} at {place}.{payline}"],
    boastful: ["{place} needed a {job}; naturally they got the finest one alive.{payline}", "I showed {place} how a real {job} works.{payline}"],
    wistful: ["Long days as {job} in {place}. Honest work leaves its own kind of scar.{payline}", "I was a {job} in {place} for a while. I think of those days more than I expected to.{payline}"],
  },
  fightWin: {
    plain: ["We met {foe} at {place} and won.", "Beat {foe} at {place}. It was close enough."],
    boastful: ["{foe} thought {place} belonged to them. I corrected the record.", "They will sing about what I did to {foe} at {place}."],
    wistful: ["We fought {foe} at {place}. We walked away; not everything did.", "I won against {foe} at {place}, and learned what winning costs."],
  },
  fightLoss: {
    plain: ["{foe} beat us at {place}. We lived.", "Lost to {foe} at {place}."],
    boastful: ["{foe} caught me on a bad day at {place}. There are no good days for them coming.", "At {place}, {foe} won a battle. The war is another matter."],
    wistful: ["{foe} broke us at {place}. Some lessons only defeat can teach.", "I lost at {place}. The sea kept my pride; I kept my life."],
  },
  journey: {
    plain: ["Traveled from {from} to {to} — {days} days{byline}.", "Made the crossing from {from} to {to} in {days} days{byline}."],
    boastful: ["{days} days from {from} to {to}{byline}, and the road is better for having carried me.", "Crossed from {from} to {to} in {days} days{byline} — the horizon blinked first."],
    wistful: ["{days} days between {from} and {to}{byline}. The world is larger than any map admits.", "From {from} to {to}, {days} days{byline}. I left something behind on that road; I never learned what."],
  },
  death: {
    plain: ["I died{foeline} at {place}. I woke in {home}, stripped to nothing but what the bank held.", "Death found me{foeline} at {place}. {home} took me back in."],
    boastful: ["{place} claims it killed me{foeline}. Yet here I am, writing — so who really won?", "I died{foeline} at {place}. Briefly. It didn't take."],
    wistful: ["I died{foeline} at {place}. Everything I carried stayed behind; everything I was came home to {home}.", "At {place} the story stopped{foeline} — then began again, smaller and wiser, in {home}."],
  },
  feat: {
    plain: ["Earned the title: {title}.", "They gave me the {title} mark."],
    boastful: ["{title}. As if there had been any doubt.", "Add {title} to the list — it grows crowded."],
    wistful: ["{title}. Strange, how heavy an honor can sit.", "I earned {title}. I wish more of us had been there to see it."],
  },
  loot: {
    plain: ["Carried {what} out of {place}.", "Took {what} from {place}."],
    boastful: ["{place} yielded its {what} to me, as was proper.", "Pried {what} from {place}'s cold grip."],
    wistful: ["I brought {what} home from {place}. It weighed more than it should have.", "{what}, out of {place}. Found things always carry their old owners with them."],
  },
  fortune: {
    plain: ["{what}: {amount}, at {place}.", "Came into {amount} {what} at {place}."],
    boastful: ["{amount} {what} at {place} — the first drop of a coming flood.", "{place} paid its tribute: {amount} {what}."],
    wistful: ["{amount} {what} at {place}. Coin arrives; it rarely stays.", "At {place}, {amount} {what} passed through my hands like water."],
  },
  purchase: {
    plain: ["Bought {what} in {place}.", "Picked up {what} at {place}."],
    boastful: ["Acquired {what} in {place}. It should be honored.", "{place}'s finest {what} — mine now."],
    wistful: ["Bought {what} in {place}. We give things names and they give us hope.", "A {what} from {place}. Small anchors for a drifting life."],
  },
  build: {
    plain: ["Raised {what} at {place}.", "Built {what} in {place}."],
    boastful: ["{place} gained a {what}, and gained it from my hands.", "I built {what} at {place}. It will outlast my critics."],
    wistful: ["We raised {what} at {place}. Wood and stone remember better than people do.", "Built {what} in {place}. Somewhere for the story to live when I cannot carry it."],
  },
  prospect: {
    plain: ["Surveyed the ground near {place}.{foundline}", "Prospected around {place}.{foundline}"],
    boastful: ["The rocks near {place} confessed everything to me.{foundline}", "Read the land at {place} like an open ledger.{foundline}"],
    wistful: ["Days among the stones near {place}.{foundline}", "Searched the ground at {place}. The earth keeps its secrets patiently.{foundline}"],
  },
  note: { plain: ["{text}"], boastful: ["{text}"], wistful: ["{text}"] },
};

function fill(tpl, ev) {
  return tpl
    .replace("{port}", ev.port || "the port")
    .replace("{job}", ev.job || "a laborer")
    .replace("{place}", ev.place || "an unnamed place")
    .replace("{payline}", ev.pay ? " Pay: " + ev.pay + "." : "")
    .replace("{foe}", ev.foe || "trouble")
    .replace("{from}", ev.from || "one shore").replace("{to}", ev.to || "another")
    .replace("{days} days", ev.days === 1 ? "1 day" : String(ev.days ?? "some") + " days")
    .replace("{days}", String(ev.days ?? "some"))
    .replace("{byline}", ev.by ? " by " + ev.by : "")
    .replace("{foeline}", ev.foe ? " at the hands of " + ev.foe : "")
    .replace("{home}", ev.home || "town")
    .replace("{title}", ev.title || "a title")
    .replace("{what}", ev.what || "something")
    .replace("{amount}", String(ev.amount ?? ""))
    .replace("{foundline}", ev.found ? " Found: " + ev.found + "." : " Nothing but stone.")
    .replace("{text}", ev.text || "");
}

/**
 * Render the memoir: { title, voice, chapters: [{ title, lines: [...] }] }.
 * Chapters break on journeys (a travel day turns the page) or every 12 events.
 * Deterministic per pawn — re-reading never rewrites history.
 */
export function readBook(pawnId, opts = {}) {
  const name = opts.name || ("Pawn " + pawnId);
  const ledger = readLedger(pawnId);
  const voice = VOICES[hash(String(pawnId) + ":voice") % VOICES.length];
  const chapters = [];
  let cur = { title: "Chapter 1", lines: [] }, count = 0, chapterN = 1;
  ledger.forEach((ev, i) => {
    let kind = ev.type;
    if (kind === "fight") kind = ev.won ? "fightWin" : "fightLoss";
    const set = LINES[kind] || LINES.note;
    const line = fill(pick(set[voice] || set.plain, String(pawnId), i, kind), ev);
    if ((ev.type === "journey" && cur.lines.length) || count >= 12) {
      chapters.push(cur);
      chapterN++;
      cur = { title: "Chapter " + chapterN + (ev.type === "journey" && ev.to ? " — " + ev.to : ""), lines: [] };
      count = 0;
    }
    cur.lines.push(line);
    count++;
  });
  if (cur.lines.length) chapters.push(cur);
  const TITLES = {
    plain: "The Life of " + name,
    boastful: "The Legend of " + name + ", Told Truthfully",
    wistful: "What the Tide Left: a Memoir of " + name,
  };
  return { title: TITLES[voice], voice, chapters, eventCount: ledger.length };
}
