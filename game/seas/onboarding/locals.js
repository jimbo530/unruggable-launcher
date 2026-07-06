/* ═══════════════════════════════════════════════════════════════════
   SEAS LOCALS — the "learn the world from its people" layer (founder 2026-07-06).
   Destinations are NOT menu buttons — you HEAR about them from the small folk of a
   port. This drops a handful of clickable NPC figures onto a page; tapping one opens a
   short dialogue card (same look as guide.js). Some locals carry a RUMOR that teaches a
   destination — hearing it records a flag in localStorage (sts_rumors), which the map
   reads to reveal that place. Exploration never dead-ends: walking somewhere raw also
   records the rumor (see map.html), so a rumor is a SHORTCUT to knowing, not a gate on
   the world.

   Port Royal is the TUTORIAL town — dense with locals. Other ports get fewer; the system
   is reusable (add a page's NPC list to LOCALS and drop the two script lines on the page).

   Use on any page:
     <script src="../onboarding/locals.js"></script>
     <script>SeasLocals.init({ page: "tavern", base: "../onboarding" });</script>

   Voice: none needed — locals are text-only for now (guide.js carries the voiced beats).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  // ── THE RUMOR CATALOG — every learnable destination + its one-line logbook hint ──────
  // key = the sts_rumors flag; hint = what the Rumors logbook shows once heard. Content
  // in map.html (LAND_CONTENT / the cave) reads these keys to decide what to reveal.
  const RUMORS = {
    goblin:  { title: "Goblins in the cave", hint: "A warren of goblins in the sea-cave a short march EAST of Port Royal. Walk the party there to clear it." },
    crab:    { title: "The crabbing beach", hint: "Fat crabs on the tide-flats near the harbor — good coin for a crew that'll get its boots wet. (Beach work coming soon.)" },
    fishing: { title: "Good fishing waters", hint: "Net-fish run thick off the near shoals — quiet coin for a patient hand. (Fishing coming soon.)" },
  };

  // ── read/record heard rumors (localStorage sts_rumors = { key: firstHeardTs }) ───────
  const RUMOR_KEY = "sts_rumors";
  function allRumors() { try { return JSON.parse(localStorage.getItem(RUMOR_KEY) || "{}") || {}; } catch (e) { console.warn("[locals] bad sts_rumors, resetting:", e); return {}; } }
  function heard(key) { return !!allRumors()[key]; }
  /** Record a rumor as heard (first time only). Returns true if this was NEW. Shared by NPCs + map discovery. */
  function hear(key) {
    if (!RUMORS[key]) { console.warn("[locals] unknown rumor:", key); return false; }
    const r = allRumors();
    if (r[key]) return false;
    r[key] = Date.now();
    localStorage.setItem(RUMOR_KEY, JSON.stringify(r));
    return true;
  }
  // expose the shared rumor API so guide.js (Rumors logbook) + map.html (gating/discovery) read ONE source.
  window.SeasRumors = { catalog: RUMORS, heard, hear, all: allRumors, key: RUMOR_KEY };

  // ── THE LOCALS — per page, the small folk you can talk to ────────────────────────────
  // Each local: { id, name, portrait?, lines:[..], rumor?, place? }.
  //   lines  = the dialogue card text (array = tap through; last line records the rumor).
  //   rumor  = the sts_rumors key this local teaches (recorded when you finish their lines).
  //   place  = a bottom-anchored position hint (0..1 from the left) so chips don't collide
  //            with the guide dock (bottom-LEFT); locals sit along the bottom-RIGHT half.
  // Text-only (no portrait) is fine — a lettered token stands in. Keep lines SHORT.
  const LOCALS = {
    tavern: [
      { id: "tam", name: "One-Ear Tam", token: "👤", place: 0.42, rumor: "goblin",
        lines: [
          "You didn't hear it from me. *leans in, tankard shaking* There's goblins in that sea-cave east of town. Whole warren of 'em.",
          "Used to be a quiet headland. Now? *taps the scar where an ear should be* They don't take kindly to visitors. But a den like that... it's got LOOT.",
          "March a crew out there — EAST, past the harbor wall, one hex of hard ground. Clear it and the spoils are yours. Just... mind the slinger.",
        ] },
      { id: "sot", name: "The Regular", token: "🍺", place: 0.62,
        lines: [
          "*doesn't look up from the mug* Mama Brine runs a fair house. Sign a hand, drink your fill, nobody robs you. Empire port.",
          "Everyone starts here. Even you. Even me, once. *long pull* Go on — the hiring book's on the bar.",
        ] },
    ],
    jobs: [
      { id: "crabber", name: "Old Sal the Crabber", token: "🦀", place: 0.40, rumor: "crab",
        lines: [
          "Docks work's honest, but you want to know a secret? *jerks a thumb at the shore* The tide-flats past the breakwater are THICK with crab.",
          "Fat ones, this time of year. A crew willing to get its boots wet can fill a basket and sell it dear. Beach is that way — when the path's open, mind. Not yet, but soon.",
        ] },
      { id: "netmender", name: "The Net-Mender", token: "🪢", place: 0.60, rumor: "fishing",
        lines: [
          "*hands never stop weaving* You feel that pull in the water off the near shoals? Fish run thick there. Quiet coin, if you've the patience.",
          "Bring a boat and a net and you'll not go hungry. The good waters are just off the harbor mouth — I'll point you when the fishing's rigged. Soon enough.",
        ] },
    ],
    port: [
      { id: "urchin", name: "Dock Urchin", token: "🧒", place: 0.42,
        lines: [
          "*tugs your sleeve* Six doors on this square, all of 'em worth a look! The tavern's got the crew, the market's got the colors.",
          "Wanna know where the real trouble is? *grins* Ask One-Ear Tam. He's always at the tavern, always got a rumor. That's how you learn where to GO round here.",
        ] },
    ],
  };

  const CSS = `
    #sl-row{position:fixed;left:0;right:0;bottom:14px;z-index:955;display:flex;justify-content:center;
      gap:10px;pointer-events:none;padding:0 90px}
    .sl-chip{pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;
      background:none;border:0;padding:0;font-family:"Segoe UI",system-ui,sans-serif}
    .sl-face{width:52px;height:52px;border-radius:50%;border:2px solid #7a6b50;background:#140d06;
      display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 3px 12px rgba(0,0,0,.5)}
    .sl-chip:hover .sl-face,.sl-chip.new .sl-face{border-color:#e6b422}
    .sl-chip.new .sl-face{animation:slnudge 2.4s ease-in-out infinite}
    .sl-tag{font-size:10px;color:#caa45a;letter-spacing:.4px;text-shadow:0 1px 3px #000;max-width:76px;
      text-align:center;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sl-chip.new .sl-face::after{content:"?";position:absolute;transform:translate(24px,-24px);
      width:18px;height:18px;border-radius:50%;background:#e6b422;color:#1a1208;font-weight:900;font-size:13px;
      line-height:18px;text-align:center}
    #sl-veil{position:fixed;inset:0;z-index:975;background:rgba(5,8,12,.55);display:none;align-items:flex-end;
      justify-content:center;padding:14px}
    #sl-veil.open{display:flex}
    #sl-card{width:min(680px,100%);max-height:82vh;overflow:auto;background:linear-gradient(#241a10,#150e07);
      border:2px solid #caa45a;border-radius:16px;padding:16px;display:flex;gap:14px;
      box-shadow:0 -6px 40px rgba(0,0,0,.6);font-family:"Segoe UI",system-ui,sans-serif}
    #sl-card .sl-portrait{width:96px;height:96px;border-radius:12px;flex:none;background:#140d06;
      border:2px solid #7a6b50;display:flex;align-items:center;justify-content:center;font-size:52px}
    #sl-body{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1}
    #sl-name{color:#e6b422;font-weight:700;letter-spacing:1.5px;font-size:13px;text-transform:uppercase}
    #sl-text{color:#f3ead7;font-size:15px;line-height:1.55}
    #sl-text em{color:#b6a584;font-style:italic}
    #sl-rumor{margin-top:4px;padding:9px 12px;border-radius:10px;background:rgba(230,180,34,.10);
      border:1px solid #6b5a2a;color:#f0d99a;font-size:13px;line-height:1.5}
    #sl-rumor b{color:#e6b422}
    #sl-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
    .sl-btn{font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;border-radius:10px;padding:9px 18px;
      border:2px solid #caa45a;background:linear-gradient(#e8d5a8,#caa45a);color:#1a1208;text-decoration:none;display:inline-block}
    .sl-btn.quiet{background:none;color:#b6a584;border-color:#4a3a22}
    @keyframes slnudge{50%{transform:translateY(-3px)}}
    @media(max-width:520px){ #sl-row{padding:0 78px;gap:7px} .sl-face{width:46px;height:46px;font-size:22px} .sl-tag{font-size:9px;max-width:60px} }
    @media(prefers-reduced-motion:reduce){ .sl-chip.new .sl-face{animation:none} }`;

  let base = "./onboarding", page = "port";
  const MET_KEY = "sts_locals_met";                 // { "page:id": ts } — locals you've spoken to
  const met = () => { try { return JSON.parse(localStorage.getItem(MET_KEY) || "{}"); } catch (e) { return {}; } };
  const markMet = (id) => { const m = met(); const k = page + ":" + id; if (!m[k]) { m[k] = Date.now(); localStorage.setItem(MET_KEY, JSON.stringify(m)); } };
  const hasMet = (id) => !!met()[page + ":" + id];

  function el(tag, attrs, html) { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; }

  function ui() {
    if (document.getElementById("sl-veil")) return;
    document.head.appendChild(el("style", {}, CSS));
    const veil = el("div", { id: "sl-veil" });
    const card = el("div", { id: "sl-card" });
    const face = el("div", { className: "sl-portrait" });
    face.id = "sl-portrait";
    const body = el("div", { id: "sl-body" });
    body.appendChild(el("div", { id: "sl-name" }));
    body.appendChild(el("div", { id: "sl-text" }));
    body.appendChild(el("div", { id: "sl-btns" }));
    card.appendChild(face); card.appendChild(body);
    veil.appendChild(card); document.body.appendChild(veil);
    veil.addEventListener("click", (e) => { if (e.target === veil) close(); });
  }
  function close() { const v = document.getElementById("sl-veil"); if (v) v.classList.remove("open"); }

  // walk a local's lines; on the LAST line, record their rumor + show the "learned it" note.
  function talk(local, i) {
    ui();
    const last = i === local.lines.length - 1;
    document.getElementById("sl-portrait").textContent = local.token || "👤";
    document.getElementById("sl-name").textContent = local.name;
    // italicize *stage directions* for a touch of life; escape the rest.
    const txt = String(local.lines[i])
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    let bodyHTML = `<div>${txt}</div>`;
    if (last && local.rumor && SeasRumors.catalog[local.rumor]) {
      const wasNew = hear(local.rumor);              // record the rumor (first time only)
      const r = SeasRumors.catalog[local.rumor];
      bodyHTML += `<div id="sl-rumor">📍 <b>${wasNew ? "Rumor learned" : "You already knew"}: ${r.title}</b><br>${r.hint} <span style="opacity:.75">— check your guide's Logbook to review rumors.</span></div>`;
    }
    document.getElementById("sl-text").innerHTML = bodyHTML;
    const btns = document.getElementById("sl-btns");
    btns.innerHTML = "";
    if (!last) {
      btns.appendChild(mkBtn("Go on ➜", () => talk(local, i + 1)));
    } else {
      markMet(local.id);
      // drop the "new" nudge on this local's chip immediately (no reload needed)
      const chip = document.querySelector('.sl-chip[data-local="' + local.id + '"]');
      if (chip) chip.classList.remove("new");
      btns.appendChild(mkBtn("Got it", close, true));
    }
    document.getElementById("sl-veil").classList.add("open");
  }
  function mkBtn(label, onclick, quiet) { const b = el("button", { className: "sl-btn" + (quiet ? " quiet" : "") }, label); b.addEventListener("click", onclick); return b; }

  function renderChips() {
    const list = LOCALS[page];
    if (!list || !list.length) return;
    let row = document.getElementById("sl-row");
    if (!row) { row = el("div", { id: "sl-row" }); document.body.appendChild(row); }
    row.innerHTML = "";
    // sort by place so the row reads left→right as authored
    for (const local of [...list].sort((a, b) => (a.place || 0.5) - (b.place || 0.5))) {
      const chip = el("button", { className: "sl-chip" + (hasMet(local.id) ? "" : " new"), title: "Talk to " + local.name });
      chip.setAttribute("data-local", local.id);
      const face = el("div", { className: "sl-face" }, local.token || "👤");
      chip.appendChild(face);
      chip.appendChild(el("div", { className: "sl-tag" }, local.name));
      chip.addEventListener("click", () => talk(local, 0));
      row.appendChild(chip);
    }
  }

  window.SeasLocals = {
    init(opts) {
      page = opts.page; base = opts.base || "./onboarding";
      const boot = () => { ui(); renderChips(); };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    },
    // let other scripts reach the rumor API even if they loaded locals.js only for that.
    rumors: window.SeasRumors,
  };
})();
