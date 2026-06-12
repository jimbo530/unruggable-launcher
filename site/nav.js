/**
 * nav.js — Shared mega-menu navigation and footer for all Unrugable site pages.
 * Include via <script src="nav.js"></script> (or "../nav.js" from subdirs).
 * Call injectNav() after DOM ready to insert nav + footer.
 */

const NAV_CATEGORIES = {
  'DeFi Tools': [
    { href: 'generator.html', label: 'Impact Generator' },
    { href: 'vaults/index.html', label: 'Community Vaults' },
    { href: '/fund/', label: 'Charity Funds' },
    { href: 'adopt.html', label: 'Adopt a Token' },
    { href: 'card-shop.html', label: 'Card Shop' },
  ],
  'Unrugable Tokens': [
    { href: 'unrugable.html', label: 'Launch a Token' },
    { href: 'reactor-dashboard.html', label: 'Reactors' },
    { href: 'partner-reactor.html', label: 'Partner Reactor' },
  ],
  'Community': [
    { href: 'leaderboard.html', label: 'Leaderboard' },
    { href: 'tree-leaderboard.html', label: 'Trees Funded' },
    { href: 'burns.html', label: 'Burns' },
    { href: 'carbon.html', label: 'Carbon' },
  ],
  'Games': [
    { href: 'games/index.html', label: 'MfT Arcade' },
    { href: 'marketplace/index.html', label: 'NFT Marketplace' },
  ],
  'Info': [
    { href: 'agents.html', label: 'Agent SDK / Docs' },
    { href: 'analytics.html', label: 'Analytics' },
    { href: 'sitemap.html', label: 'Sitemap' },
    { href: 'terms.html', label: 'Terms' },
    { href: 'privacy.html', label: 'Privacy' },
    { href: 'risk.html', label: 'Risk Disclosure' },
  ],
};

function _navPrefix() {
  // Detect if we're in a subdirectory (e.g., games/)
  const path = window.location.pathname;
  if (path.includes('/games/') || path.includes('/fund/') || path.includes('/marketplace/') || path.includes('/vaults/')) return '../';
  return '';
}

function _buildMegaMenu(prefix) {
  let cats = '';
  for (const [cat, links] of Object.entries(NAV_CATEGORIES)) {
    let items = links.map(l => `<a href="${prefix}${l.href}">${l.label}</a>`).join('');
    cats += `<div class="mega-cat"><div class="mega-cat-title">${cat}</div>${items}</div>`;
  }
  return cats;
}

function injectNav() {
  const prefix = _navPrefix();

  // --- NAV ---
  const nav = document.createElement('nav');
  nav.id = 'site-nav';
  nav.innerHTML = `
    <a href="${prefix}index.html" class="nav-brand">Unrugable</a>
    <div class="nav-desktop">
      <button class="nav-menu-btn" aria-expanded="false" onclick="toggleMega()">Menu</button>
    </div>
    <button class="nav-hamburger" aria-label="Menu" onclick="toggleMobile()">
      <span></span><span></span><span></span>
    </button>
    <div class="mega-menu" id="megaMenu">
      <div class="mega-inner">${_buildMegaMenu(prefix)}</div>
    </div>
    <div class="mobile-menu" id="mobileMenu">
      ${Object.entries(NAV_CATEGORIES).map(([cat, links]) => `
        <div class="mobile-cat">
          <div class="mobile-cat-title" onclick="toggleMobileCat(this)">${cat}</div>
          <div class="mobile-cat-links">${links.map(l => `<a href="${prefix}${l.href}">${l.label}</a>`).join('')}</div>
        </div>
      `).join('')}
    </div>
  `;
  document.body.prepend(nav);

  // --- FOOTER ---
  const footer = document.createElement('footer');
  footer.id = 'site-footer';
  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-grid">
        ${Object.entries(NAV_CATEGORIES).map(([cat, links]) => `
          <div class="footer-col">
            <div class="footer-col-title">${cat}</div>
            ${links.map(l => `<a href="${prefix}${l.href}">${l.label}</a>`).join('')}
          </div>
        `).join('')}
      </div>
      <div class="footer-meta">
        <span class="base-badge"><span class="base-dot"></span> Built on Base</span>
        <span>memefortrees.base.eth</span>
      </div>
    </div>
  `;
  document.body.appendChild(footer);
}

// --- Toggle functions ---
function toggleMega() {
  const menu = document.getElementById('megaMenu');
  const btn = document.querySelector('.nav-menu-btn');
  const open = menu.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
}

function toggleMobile() {
  const menu = document.getElementById('mobileMenu');
  const btn = document.querySelector('.nav-hamburger');
  const open = menu.classList.toggle('open');
  btn.classList.toggle('active', open);
}

function toggleMobileCat(el) {
  el.parentElement.classList.toggle('expanded');
}

// Close mega on outside click
document.addEventListener('click', (e) => {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  if (!nav.contains(e.target)) {
    document.getElementById('megaMenu')?.classList.remove('open');
    document.getElementById('mobileMenu')?.classList.remove('open');
    document.querySelector('.nav-hamburger')?.classList.remove('active');
    document.querySelector('.nav-menu-btn')?.setAttribute('aria-expanded', 'false');
  }
});
