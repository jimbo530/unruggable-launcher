/**
 * track.js — lightweight usage analytics for all tasern.quest pages.
 * Include via <script src="/track.js" defer></script> (absolute path — works at any depth).
 *
 * Records: pageviews, wallet connections, and custom events into Supabase
 * analytics_events (anon key, INSERT-only — raw rows are not readable from the browser).
 * Custom events: call window.mftTrack('event_name', 'label', {any: 'props'})
 * or add data-track="label" to any clickable element.
 *
 * No cookies. Anonymous visitor id in localStorage, session id in sessionStorage.
 */
(function () {
  if (window.__mftTrackLoaded) return;
  window.__mftTrackLoaded = true;

  var URL = 'https://hhniimufxjjgmessjtbc.supabase.co/rest/v1/analytics_events';
  var KEY = 'sb_publishable_F471ZS8yTS8qiXU0ZLEqvQ_I-O3av-l';

  function uuid() {
    try { return crypto.randomUUID(); }
    catch (e) { return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  }
  function getId(store, key) {
    try {
      var v = store.getItem(key);
      if (!v) { v = uuid(); store.setItem(key, v); }
      return v;
    } catch (e) { return null; }
  }

  var wallet = null;

  function send(event, label, props) {
    try {
      var body = JSON.stringify({
        site: location.host || 'unknown',
        path: location.pathname || '/',
        event: String(event).slice(0, 50),
        label: label ? String(label).slice(0, 200) : null,
        wallet: wallet,
        vid: getId(localStorage, 'mft_vid'),
        sid: getId(sessionStorage, 'mft_sid'),
        referrer: document.referrer ? document.referrer.slice(0, 500) : null,
        ua: navigator.userAgent ? navigator.userAgent.slice(0, 300) : null,
        props: props || null
      });
      fetch(URL, {
        method: 'POST',
        keepalive: true,
        headers: {
          'apikey': KEY,
          'Authorization': 'Bearer ' + KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: body
      }).catch(function (e) { console.debug('[track]', e && e.message); });
    } catch (e) { console.debug('[track]', e && e.message); }
  }

  function setWallet(addr) {
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
    var w = addr.toLowerCase();
    if (w === wallet) return;
    wallet = w;
    send('wallet_connect');
  }

  function checkAccounts() {
    if (!window.ethereum || !window.ethereum.request) return;
    window.ethereum.request({ method: 'eth_accounts' })
      .then(function (acc) { if (acc && acc[0]) setWallet(acc[0]); })
      .catch(function () {});
  }

  // Wallet detection: silent check now, again after pages typically connect,
  // and live via accountsChanged.
  if (window.ethereum) {
    checkAccounts();
    setTimeout(checkAccounts, 3000);
    setTimeout(checkAccounts, 12000);
    try {
      window.ethereum.on && window.ethereum.on('accountsChanged', function (acc) {
        if (acc && acc[0]) setWallet(acc[0]);
      });
    } catch (e) { /* provider without .on */ }
  } else {
    // injected providers can appear after us
    setTimeout(function () { if (window.ethereum) { checkAccounts(); } }, 3000);
  }

  // Clicks on anything marked data-track
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-track]');
    if (el) send('click', el.getAttribute('data-track'));
  }, true);

  // Public API for game/tool code
  window.mftTrack = send;
  window.mftTrackWallet = setWallet;

  send('pageview');
})();
