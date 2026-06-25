/* ============================================================
 *  species-picker.js — tiny reusable crew-species picker for the ship-launch flow.
 *
 *  The CAPTAIN picks the sprite set (species) that crews their ship AT LAUNCH.
 *  This renders 5-6 species cards (human, dwarf, elf, goblin, orc, + acorn
 *  fallback), reading the catalog from the crew render service and persisting the
 *  choice both LOCALLY (localStorage, like the other ship pages) and to the
 *  service (POST /ship/species) so render/metadata pick it up with no re-mint.
 *
 *  USAGE (from the launcher page):
 *    <div id="species-picker"></div>
 *    <script src="/species-picker.js"></script>
 *    <script>
 *      const picker = mountSpeciesPicker('#species-picker', {
 *        base: 'http://localhost:8791',      // crew render service origin
 *        shipKey: '0xDistributor...' ,        // or a ship slug; the ship identity
 *        onPick: (species) => console.log('captain chose', species),
 *      });
 *      // later: picker.value()  -> current species id
 *    </script>
 *
 *  The launch UI (store/launcher) calls this; this file is JUST the picker + the
 *  get/set glue. The authoritative per-ship store lives in the service
 *  (ship-species.js); localStorage here is the front-end mirror for instant UI.
 * ========================================================== */
(function (global) {
  const LS_KEY = (shipKey) => 'seas:ship-species:' + String(shipKey || '').toLowerCase();

  // local mirror (instant UI; service is the source of truth)
  function getLocal(shipKey) { try { return localStorage.getItem(LS_KEY(shipKey)) || null; } catch (_) { return null; } }
  function setLocal(shipKey, species) { try { localStorage.setItem(LS_KEY(shipKey), species); } catch (_) { /* surfaced below */ } }

  async function mountSpeciesPicker(target, opts = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('species-picker: target not found: ' + target);
    const base = (opts.base || '').replace(/\/$/, '');
    const shipKey = opts.shipKey;
    if (!shipKey) throw new Error('species-picker: opts.shipKey is required');

    // 1) load the selectable catalog (fail loud — no silent empty picker)
    const cat = await fetch(base + '/ship/species/catalog').then((r) => {
      if (!r.ok) throw new Error('catalog fetch failed: ' + r.status);
      return r.json();
    });

    // 2) current choice: local mirror -> service-resolved -> catalog default
    let current = getLocal(shipKey);
    if (!current) {
      try {
        const got = await fetch(base + '/ship/species/' + encodeURIComponent(shipKey)).then((r) => r.json());
        current = got && got.species;
      } catch (e) { console.warn('species-picker: service get failed, using default —', e.message); }
    }
    current = current || cat.default;

    // 3) render cards
    el.innerHTML = '';
    el.classList.add('species-picker');
    const cards = {};
    for (const sp of cat.species) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'species-card';
      card.dataset.species = sp.id;
      card.innerHTML =
        '<img alt="' + sp.name + '" loading="lazy" ' +
        'src="' + base + '/ship/species/preview/' + sp.id + '.png" ' +
        'onerror="this.style.visibility=\'hidden\'">' +
        '<span class="species-name">' + sp.name + '</span>' +
        (sp.ready ? '' : '<span class="species-soon">art soon</span>');
      card.addEventListener('click', () => choose(sp.id));
      cards[sp.id] = card;
      el.appendChild(card);
    }
    function highlight(id) {
      Object.values(cards).forEach((c) => c.classList.toggle('selected', c.dataset.species === id));
    }
    highlight(current);

    // 4) choose -> persist local + service, fire onPick
    async function choose(id) {
      current = id;
      highlight(id);
      setLocal(shipKey, id);
      try {
        const r = await fetch(base + '/ship/species', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipKey, species: id }),
        });
        if (!r.ok) throw new Error('save failed: ' + r.status);
      } catch (e) {
        // never swallow — surface to console AND the page (caller can show it)
        console.error('species-picker: save to service failed —', e.message);
        if (typeof opts.onError === 'function') opts.onError(e);
      }
      if (typeof opts.onPick === 'function') opts.onPick(id);
    }

    return { value: () => current, choose, refresh: () => mountSpeciesPicker(target, opts) };
  }

  global.mountSpeciesPicker = mountSpeciesPicker;
})(typeof window !== 'undefined' ? window : globalThis);
