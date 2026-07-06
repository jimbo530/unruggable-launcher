/* ═══════════════════════════════════════════════════════════════════
   SEAS GUIDE — the "nothing is intuitive" system (founder rule 2026-07-06).
   Every page: FIRST visit auto-opens that place's guide (an NPC talks you
   through it). A dock button (bottom-left) is always there to re-read the
   guide, and the 📖 LOGBOOK collects every guide you've seen, reviewable
   from anywhere. Voice is garnish; text is the source of truth.

   Use on any page:
     <script src="../onboarding/guide.js"></script>
     <script>SeasGuide.init({ page: "tavern", base: "../onboarding" });</script>
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  // ---- THE GUIDE BOOK: every place, its guide, and its one-line summary ----
  // href = path from the seas root (the logbook rewrites per page depth).
  const REGISTRY = {
    // Path order (founder 2026-07-06): FUN FIRST — pick your character, make them
    // yours (colors/cosmetics/free kit), play, FIGHT... work comes last.
    port: {
      name: "Harbormaster Grale", portrait: "art/npc-grale.png", href: "town/index.html",
      title: "⚓ Port Royal — the harbor",
      summary: "Six doors: <b>Tavern</b> = sign on crew hands (your pawns) · <b>Your Crew</b> = dress them, pick your fighter · <b>Cosmetic Market</b> = colors, clothes, stickers · <b>The Decks</b> = training fights · <b>Town Work</b> = a hand earns coin + skill.",
      // NOTE (founder 2026-07-06): Grale WELCOMES at the title screen now (first visit). On the town
      // square she's a PACED guide like the rest — her beats point at the DOORS, not the arrival line.
      beats: [
        { text: "Back on the square, good. <b>Six doors round Port Royal</b>, and every one earns its keep. Lost? I'll walk you through them.",
          voice: "grale-05-return.mp3" },
        { text: "Start at the <b>Tavern</b> — Mama Brine signs your first crew hand. Then <b>Your Crew</b> to dress them, the <b>Market</b> for colors and kit, the <b>Decks</b> for a training fight, and <b>Town Work</b> when a hand's ready to earn coin and skill.",
          voice: "grale-06-to-tavern.mp3",
          cta: { label: "🍺 Start at the Tavern", href: "tavern/index.html" } },
        { text: "And the folk on the square talk — <b>tap them and listen</b>. That's how you learn where the work and the trouble are round here; the good spots aren't on any signpost.",
          cta: { label: "👥 Your Crew", href: "crew/index.html" } },
      ],
    },
    tavern: {
      name: "Mama Brine", portrait: "art/npc-brine.png", href: "tavern/index.html",
      title: "🍺 The Tavern — pick your character",
      summary: "Sign on <b>crew hands</b> (pawns) here — free seats and cheap berths. A hand is YOURS: name it, dress it, work it, fight it. Friends start here too.",
      beats: [
        { text: "There's the new face! Sit, sit — nobody stands hungry in <b>MY</b> tavern. Looking for hands, are you? Good — this is where every crew on the sea got its start.",
          voice: "brine-01-greet.mp3" },
        { text: "Pick a seat and <b>sign on a crew hand</b> — that's your pawn: yours to name, dress, work and fight. Take the free seat if your pockets are light. Then go <b>make them yours</b> — colors, kit, the lot.",
          cta: { label: "👥 Meet your hand", href: "crew/index.html" } },
      ],
    },
    crew: {
      name: "Harbormaster Grale", portrait: "art/npc-grale.png", href: "crew/index.html",
      title: "👥 Your Crew — make them yours",
      summary: "Your signed hands live here. <b>Dress them</b>, equip gear, <b>pick the active fighter</b>. The <b>Lost &amp; Found</b> chest (free kit for new hands + gear other crews toss in) will live by these docks.",
      beats: [
        { text: "This is your muster — every hand you've signed. <b>Dress them, kit them, make them yours</b> — half the fun of a crew is how they look walking into a tavern. Soon there'll be a <b>Lost &amp; Found</b> chest by the docks: free kit for new hands, and whatever gear other crews toss in.",
          cta: { label: "🏪 To the Cosmetic Market", href: "store/index.html" } },
      ],
    },
    store: {
      name: "Harbormaster Grale", portrait: "art/npc-grale.png", href: "store/index.html",
      title: "🏪 Cosmetic Market — colors, clothes & stickers",
      summary: "The <b>Cosmetic Market</b>: colors for your hand, special clothes, and <b>stickers for your NFTs</b>. Gear changes the fight; the pretty things change the sailor.",
      beats: [
        { text: "The market's honest and the scales are true — Empire port, remember. <b>Colors, fine clothes, stickers</b> — everything to make a hand unmistakably yours. Gear changes the fight; the pretty things change the sailor. When they look the part... take them to the <b>Decks</b>.",
          cta: { label: "⚔️ To the Decks", href: "battle-grid/index.html" } },
      ],
    },
    decks: {
      name: "Sgt. Copperline", portrait: "art/npc-copperline.png", href: "battle-grid/index.html",
      title: "⚔️ The Decks — your first fight",
      summary: "Bring your active fighter and <b>spar</b> — no stakes, just practice. Skills from Town Work show up here as real muscle.",
      beats: [
        { text: "Fresh hand, is it? Perfect. <b>Training fights only</b> up here — no stakes, no losses that follow you. Learn the deck, swing something, have some fun with it." },
        { text: "Enjoyed that? Then here's the secret: a hand that <b>works a trade</b> fights better. Every shift at <b>Town Work</b> pays coin AND builds one of their six skills. Sweat in the harbor, glory on the decks.",
          cta: { label: "⚓ To Town Work", href: "jobs/index.html" } },
      ],
    },
    jobs: {
      name: "Sgt. Copperline", portrait: "art/npc-copperline.png", href: "jobs/index.html",
      title: "⚓ Town Work — earn coin, build skill",
      summary: "Clock a crew hand into a <b>town trade</b>. Every shift pays coin and levels ONE of their six skills. A hand on the job is locked until you clock them out.",
      beats: [
        { text: "New blood! Outstanding. The wall needs watching and the crates won't haul themselves. <b>Pick a post, do the hours, collect the wage.</b> Simple as rope.",
          voice: "copperline-01-greet.mp3" },
        { text: "Each post trains a different <b>skill</b> — docks build STRENGTH, nets build DEXTERITY, and so on. Mind this: a hand <b>on the job is locked</b> — no fighting, no sailing — till you clock them out. The crown takes its little cut of wages; that cut keeps the lighthouse lit and the <b>prize ladder</b> heavy." },
      ],
    },
  };

  const ORDER = ["port", "tavern", "crew", "store", "decks", "jobs"];
  // PACING (founder 2026-07-06): gameplay chunks BETWEEN guides. GENTLE STEPS — Grale
  // now WELCOMES at the TITLE screen, so the town square no longer auto-greets. Only the
  // fun chunk auto-greets: pick your hand (TAVERN) + make them yours (CREW). Every other
  // place — including the town square (port) — just makes the dock button glow: inviting,
  // never demanding.
  const PACE_MS = 3 * 60 * 1000;
  const FUNNEL = { tavern: 1, crew: 1 };
  const PACE_KEY = "sts_last_autoguide";
  const SEEN_KEY = "sts_guides_seen";
  const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch (e) { return {}; } };
  const markSeen = p => { const s = seen(); if (!s[p]) { s[p] = Date.now(); localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } };

  const CSS = `
    #sg-dock{position:fixed;left:14px;bottom:14px;z-index:960;width:64px;height:64px;border-radius:50%;
      border:3px solid #caa45a;overflow:hidden;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.55);background:#140d06;padding:0}
    #sg-dock img{width:100%;height:100%;object-fit:cover;object-position:top}
    #sg-dock:hover{border-color:#e6b422}
    #sg-veil{position:fixed;inset:0;z-index:970;background:rgba(5,8,12,.55);display:none;align-items:flex-end;justify-content:center;padding:14px}
    #sg-veil.open{display:flex}
    #sg-card{width:min(680px,100%);max-height:82vh;overflow:auto;background:linear-gradient(#241a10,#150e07);
      border:2px solid #caa45a;border-radius:16px;padding:14px;display:flex;gap:14px;box-shadow:0 -6px 40px rgba(0,0,0,.6);
      font-family:"Segoe UI",system-ui,sans-serif}
    #sg-card img.sg-face{width:110px;height:110px;border-radius:12px;flex:none;object-fit:cover;object-position:top}
    #sg-body{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1}
    #sg-name{color:#e6b422;font-weight:700;letter-spacing:1.5px;font-size:13px;text-transform:uppercase}
    #sg-text{color:#f3ead7;font-size:15px;line-height:1.55}
    #sg-text a{color:#e6b422}
    #sg-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
    .sg-btn{font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;border-radius:10px;padding:9px 18px;
      border:2px solid #caa45a;background:linear-gradient(#e8d5a8,#caa45a);color:#1a1208;text-decoration:none;display:inline-block}
    .sg-btn.quiet{background:none;color:#b6a584;border-color:#4a3a22}
    .sg-log{border-top:1px solid #3a2c18;padding:10px 2px;color:#f3ead7;font-size:14px;line-height:1.5}
    .sg-log .t{color:#e6b422;font-weight:700}
    .sg-log .locked{color:#7a6b50;font-style:italic}
    .sg-log a{color:#e6b422}
    #sg-dock.pulse{border-color:#e6b422;animation:sgpulse 2s ease-in-out infinite}
    #sg-dock .bang{position:absolute;top:-4px;right:-4px;width:22px;height:22px;border-radius:50%;
      background:#e6b422;color:#1a1208;font-weight:900;font-size:15px;line-height:22px;text-align:center}
    @keyframes sgpulse{50%{box-shadow:0 0 30px rgba(230,180,34,.85)}}`;

  let base = "./onboarding", root = "./", page = "port", voiceEl = null;

  function el(tag, attrs, html) { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; }

  function say(file) {
    if (!file) return;
    try {
      if (voiceEl) voiceEl.pause();
      voiceEl = new Audio(base + "/audio/" + file);
      voiceEl.play().catch(() => { // no gesture yet: speak on the first tap
        document.addEventListener("pointerdown", () => voiceEl.play().catch(e => console.warn("voice:", e)), { once: true });
      });
    } catch (e) { console.warn("voice failed:", e); }
  }

  function ui() {
    if (document.getElementById("sg-veil")) return;
    document.head.appendChild(el("style", {}, CSS));
    const g = REGISTRY[page];
    const dock = el("button", { id: "sg-dock", title: "Ask your guide (re-read + logbook)" });
    dock.appendChild(el("img", { src: base + "/" + g.portrait, alt: g.name }));
    dock.addEventListener("click", () => {
      // a glowing dock = this place's guide is waiting; first tap delivers it
      if (!seen()[page]) { unpulse(); markSeen(page); runBeats(REGISTRY[page], 0); return; }
      menu();
    });
    const veil = el("div", { id: "sg-veil" });
    const card = el("div", { id: "sg-card" });
    card.appendChild(el("img", { className: "sg-face", src: base + "/" + g.portrait, alt: g.name }));
    const body = el("div", { id: "sg-body" });
    body.appendChild(el("div", { id: "sg-name" }, g.name));
    body.appendChild(el("div", { id: "sg-text" }));
    body.appendChild(el("div", { id: "sg-btns" }));
    card.appendChild(body); veil.appendChild(card); document.body.appendChild(veil); document.body.appendChild(dock);
    veil.addEventListener("click", e => { if (e.target === veil) close(); });
  }

  function show(name, portrait, html, buttons, voice) {
    ui();
    document.getElementById("sg-name").textContent = name;
    document.querySelector("#sg-card img.sg-face").src = base + "/" + portrait;
    document.getElementById("sg-text").innerHTML = html;
    const btns = document.getElementById("sg-btns");
    btns.innerHTML = "";
    for (const b of buttons) {
      const e = el(b.href ? "a" : "button", { className: "sg-btn" + (b.quiet ? " quiet" : "") }, b.label);
      if (b.href) e.href = b.href;
      if (b.onclick) e.addEventListener("click", b.onclick);
      btns.appendChild(e);
    }
    document.getElementById("sg-veil").classList.add("open");
    say(voice);
  }
  function close() { const v = document.getElementById("sg-veil"); if (v) v.classList.remove("open"); if (voiceEl) voiceEl.pause(); }
  function pulse() { const d = document.getElementById("sg-dock"); if (!d || d.classList.contains("pulse")) return; d.classList.add("pulse"); d.appendChild(el("span", { className: "bang" }, "!")); }
  function unpulse() { const d = document.getElementById("sg-dock"); if (!d) return; d.classList.remove("pulse"); const b = d.querySelector(".bang"); if (b) b.remove(); }

  function runBeats(g, i, done) {
    const beat = g.beats[i];
    const last = i === g.beats.length - 1;
    const buttons = [];
    if (beat.cta) buttons.push({ label: beat.cta.label, href: root + beat.cta.href });
    buttons.push(last
      ? { label: beat.cta ? "Look around first" : "Got it, thanks", quiet: !!beat.cta, onclick: () => { close(); if (done) done(); } }
      : { label: "Continue ➜", onclick: () => runBeats(g, i + 1, done) });
    show(g.name, g.portrait, beat.text, buttons, beat.voice);
  }

  function logbook() {
    const s = seen();
    let html = "Everything your guides have told you — the seen pages are yours to re-read.";
    for (const key of ORDER) {
      const g = REGISTRY[key];
      html += `<div class="sg-log">` + (s[key]
        ? `<span class="t">${g.title}</span> — <a href="${root + g.href}">visit</a><br>${g.summary}`
        : `<span class="t">${g.title}</span><br><span class="locked">??? — you haven't been here yet. <a href="${root + g.href}">Set foot there</a> and the page fills in.</span>`)
        + `</div>`;
    }
    html += rumorSection();
    show(REGISTRY[page].name, REGISTRY[page].portrait, html, [
      { label: "Back", quiet: true, onclick: menu },
      { label: "Close", quiet: true, onclick: close },
    ]);
  }

  // ── RUMORS — destinations you've LEARNED from the locals (locals.js writes sts_rumors).
  // The catalog is owned by locals.js (window.SeasRumors); a tiny fallback keeps the section
  // working on pages that loaded only guide.js. Unheard rumors stay a mystery ("keep asking").
  const RUMOR_FALLBACK = {
    goblin:  { title: "Goblins in the cave", hint: "A warren of goblins in the sea-cave east of Port Royal — march the party there to clear it." },
    crab:    { title: "The crabbing beach", hint: "Fat crabs on the tide-flats near the harbor. (Beach work coming soon.)" },
    fishing: { title: "Good fishing waters", hint: "Net-fish run thick off the near shoals. (Fishing coming soon.)" },
  };
  function rumorSection() {
    const R = (window.SeasRumors && window.SeasRumors.catalog) || RUMOR_FALLBACK;
    let heard = {};
    try { heard = JSON.parse(localStorage.getItem("sts_rumors") || "{}") || {}; } catch (e) { heard = {}; }
    const keys = Object.keys(R);
    let out = `<div class="sg-log"><span class="t">🗣️ Rumors — what the locals told you</span><br>`;
    const known = keys.filter(k => heard[k]);
    if (!known.length) {
      out += `<span class="locked">Nothing yet. Tap the <b>folk around town</b> and listen — that's how you learn where the work and the trouble are.</span>`;
    } else {
      out += known.map(k => `📍 <b style="color:#e6b422">${R[k].title}</b> — ${R[k].hint}`).join("<br>");
      const unheard = keys.length - known.length;
      if (unheard > 0) out += `<br><span class="locked">…and ${unheard} more rumor${unheard > 1 ? "s" : ""} still to hear. Keep asking around.</span>`;
    }
    return out + `</div>`;
  }

  function menu() {
    const g = REGISTRY[page];
    show(g.name, g.portrait,
      `Need a refresher? I'll tell you about <b>this place</b> again, or open the <b>logbook</b> — every guide you've heard, in one book.`,
      [
        { label: "📣 Re-read this place", onclick: () => runBeats(g, 0) },
        { label: "📖 Logbook", onclick: logbook },
        { label: "Close", quiet: true, onclick: close },
      ]);
  }

  window.SeasGuide = {
    init(opts) {
      page = opts.page; base = opts.base || "./onboarding";
      root = base.replace(/onboarding\/?$/, ""); // seas root prefix for hrefs
      const g = REGISTRY[page];
      if (!g) { console.warn("SeasGuide: unknown page", page); return; }
      const boot = () => {
        ui();
        const s = seen();
        if (!s[page]) {
          const paced = Date.now() - +(localStorage.getItem(PACE_KEY) || 0) > PACE_MS;
          if (FUNNEL[page] || paced) {
            localStorage.setItem(PACE_KEY, String(Date.now()));
            markSeen(page); runBeats(g, 0);
          } else pulse(); // let them PLAY — the guide glows and waits
        }
        else if (page === "port" && !sessionStorage.getItem("sts_greeted")) {
          sessionStorage.setItem("sts_greeted", "1");
          show(g.name, g.portrait,
            `Back again? Good — the port's busier for it. If you're ever lost, I'm right here on the dock. <b>Just ask.</b>`,
            [ { label: "What can I do here?", onclick: logbook },
              { label: "Thanks, Grale", quiet: true, onclick: close } ],
            "grale-07-welcome-back.mp3");
        }
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    },
  };
})();
