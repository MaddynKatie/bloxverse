// Shared shell wiring for the new-UI pages.
//
// index.html keeps its own inline copy of this logic; this module exists so the
// other pages can adopt the same topbar / nav-rail / mobile-drawer behaviour
// without duplicating it. Every element lookup is optional so a page can adopt
// the shell piecemeal and the module degrades to a no-op for whatever is
// missing.
//
// Requires the classic scripts that publish the globals used below:
//   src/motion.js, src/action-dialog.js, src/navigation-indicator.js
import { toggleThemeMode, isDarkActive, THEME_CHANGE_EVENT } from './theme.js';

const RAIL_KEY = 'bloxverse_rail_expanded';
const NARROW_NAV = '(max-width: 800px)';

const $ = (id) => document.getElementById(id);

// -- Nav rail ------------------------------------------------------------
// The expanded class lives on <html> so the pre-paint script can restore it
// before first paint; the toggle only mirrors it into the accessible state.
function wireNavRail() {
  const navToggle = $('site-nav-toggle');
  const navigation = $('site-navigation');
  if (!navToggle) return;

  const siteRoot = document.documentElement;
  const narrowNavigation = matchMedia(NARROW_NAV);

  const syncNavigation = () => {
    const expanded = siteRoot.classList.contains('site-navigation-expanded');
    navToggle.setAttribute('aria-expanded', String(expanded));
    navToggle.setAttribute('aria-label', expanded ? 'Collapse navigation' : 'Expand navigation');
  };

  // `animate = false` suppresses the width tween (the reference tags the root
  // with .site-navigation-resizing, which home.css zeroes the transition on) so
  // a breakpoint change snaps instead of sliding across the viewport.
  const setExpanded = (open, animate = true) => {
    siteRoot.classList.toggle('site-navigation-resizing', !animate);
    siteRoot.classList.toggle('site-navigation-expanded', open);
    syncNavigation();
    if (!narrowNavigation.matches) {
      try { localStorage.setItem(RAIL_KEY, String(open)); } catch { /* storage blocked */ }
    }
  };

  navToggle.addEventListener('click', () => {
    setExpanded(!siteRoot.classList.contains('site-navigation-expanded'));
  });

  // Reference: unused/uirevamp/site.js:90-95. Crossing into the mobile layout
  // re-derives the rail from storage and must not animate.
  narrowNavigation.addEventListener('change', () => {
    let expanded = false;
    try {
      expanded = !narrowNavigation.matches && localStorage.getItem(RAIL_KEY) !== 'false';
    } catch { /* storage blocked */ }
    setExpanded(expanded, false);
  });

  // Reference: unused/uirevamp/site.js:78-89. Escape collapses the rail, unless
  // a popup owns the keypress or the mobile drawer is still open.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('site-mobile-menu')?.open) return;
    if (document.querySelector('.site-account-menu[open], .site-bux-menu[open]')) return;
    if (siteRoot.classList.contains('site-navigation-expanded')) {
      setExpanded(false);
      navToggle.focus();
    }
  });

  // Reference: unused/uirevamp/site.js:96 only syncs on init; the expanded
  // state comes from the page's pre-paint script. Calling setExpanded() here
  // would persist whatever the document happened to start as, so a page that
  // ships without that guard would write "false" to storage and leave the rail
  // minimised on itself and on every page visited afterwards.
  syncNavigation();

  // Reference: unused/uirevamp/site.js:97. The rail's links stagger in on
  // --motion-nav-enter/--motion-nav-distance; without this the rail is simply
  // painted, which is what made it look different from the reference.
  if (navigation && typeof BloxVerseMotion !== 'undefined') {
    BloxVerseMotion.reveal(navigation, 'a');
  }
}

// -- Mobile drawer -------------------------------------------------------
// Routed through openDialog/closeDialog so it gets the same focus trap,
// escape/backdrop dismissal and open/close animation as every other dialog.
function wireMobileDrawer(indicator) {
  const more = $('site-mobile-more');
  const menu = $('site-mobile-menu');
  if (!more || !menu || typeof openDialog !== 'function') return;

  const open = () => {
    if (menu.open) return;
    // Static markup, so it has to survive the close animation.
    openDialog(menu, { initialFocus: $('site-mobile-menu-close'), removeOnClose: false });
    more.setAttribute('aria-expanded', 'true');
    // Reference: unused/uirevamp/site.js:22. The sheet lives behind "More", so
    // the pill moves onto More while it is open rather than staying on the page.
    indicator?.select(more);
  };

  const close = () => {
    if (!menu.open) return;
    closeDialog(menu);
    more.setAttribute('aria-expanded', 'false');
  };

  more.addEventListener('click', () => (menu.open ? close() : open()));
  $('site-mobile-menu-close')?.addEventListener('click', close);
  menu.addEventListener('close', () => {
    more.setAttribute('aria-expanded', 'false');
    indicator?.reset();
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a, button') && !e.target.closest('#site-mobile-menu-close')) close();
  });
}

// -- Theme ---------------------------------------------------------------
// A plain light/dark switch for whichever family the user picked in Settings.
export function themeToggleMarkup() {
  const dark = isDarkActive();
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return `<button type="button" id="site-theme-toggle" class="site-icon-button" aria-label="${label}" title="${label}">
    <i class="site-font-icon fa-solid ${dark ? 'fa-sun' : 'fa-moon'}" aria-hidden="true"></i>
  </button>`;
}

// The toggle lives in the page's static markup as a *sibling* of #navRight, so
// renderAccountCluster() never replaces it -- but that used to be exactly the
// bug. renderAccountCluster() calls wireThemeToggle() again on every auth render,
// which stacked another click listener onto the same surviving button. One click
// then ran toggleThemeMode() twice (dark -> light -> dark) and the toggle looked
// completely dead. Bind per element, and attach the document/media listeners
// only once so they stop leaking on every re-render.
let wiredToggleBtn = null;
let themeListenersAttached = false;

function syncThemeToggle() {
  const current = $('site-theme-toggle');
  if (!current) return;
  const dark = isDarkActive();
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  current.setAttribute('aria-label', label);
  current.title = label;
  const icon = current.querySelector('i');
  if (icon) icon.className = `site-font-icon fa-solid ${dark ? 'fa-sun' : 'fa-moon'}`;
}

function wireThemeToggle() {
  const btn = $('site-theme-toggle');
  // Already bound to this exact element: binding again would make a single click
  // toggle twice and cancel itself out.
  if (!btn || btn === wiredToggleBtn) return;
  wiredToggleBtn = btn;

  btn.addEventListener('click', () => {
    toggleThemeMode();
    // The account cluster is re-rendered on auth change, so re-sync in place.
    syncThemeToggle();
  });

  if (!themeListenersAttached) {
    themeListenersAttached = true;
    // The theme can also change from the settings controls or any other script,
    // which would otherwise leave the icon showing the wrong mode.
    document.addEventListener(THEME_CHANGE_EVENT, syncThemeToggle);
    // 'system' resolves live, so keep the icon honest when the OS flips.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeToggle);
  }

  syncThemeToggle();
}

// -- Account cluster -------------------------------------------------------
// The Bux pill, the profile link and the account <details> popup, shared by
// every page so the top-right corner matches the reference everywhere.
// Reference: unused/uirevamp/account.html:82-96 and index.html:936-964.
//
// index.html and profile.html each had their own inline copy; account.html,
// avatar.html and friends.html carried the empty `#navRight` slot instead, which
// is why their top-right only ever showed the theme toggle. `sitePath` is
// passed in because the shell must not assume the deploy base.
export function renderAccountCluster(user, { username, bux, userNum, preview, sitePath, onSendBux, onLogout } = {}) {
  const host = $('navRight') || $('site-account');
  if (!host) return;
  const base = typeof sitePath === 'function' ? sitePath : (p) => p;
  const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  if (!user) {
    host.innerHTML = `<button class="login-btn" type="button">Sign in</button>`;
    const signin = host.querySelector('.login-btn');
    if (signin) {
      signin.addEventListener('click', () => { window.location.href = base('/auth'); });
    }
    wireThemeToggle();
    return;
  }

  const name = username || 'Player';
  const initial = escape(name.charAt(0).toUpperCase());
  const profileHref = userNum ? base(`/profile?user=${encodeURIComponent(userNum)}`) : base('/profile');
  const avatar = preview
    ? `<img src="${escape(preview)}" alt="" data-fallback-initial="${initial}" data-fallback-class="site-profile-initial" />`
    : `<span class="site-profile-initial">${initial}</span>`;

  host.innerHTML = `
    <details class="site-bux-menu" id="site-bux-menu">
      <summary class="site-balance" aria-label="Your Bux balance" tooltip="${Number(bux || 0).toLocaleString()} Bux">
        <img class="site-icon" src="assets/icons/bux.svg" alt="" width="24" height="24" draggable="false" /><span id="bux-count">${Number(bux || 0).toLocaleString()}</span>
      </summary>
      <div class="site-account-links">
        <a href="${base('/transactions')}">Transactions</a>
        <button type="button" id="open-send-bux">Send Bux</button>
      </div>
    </details>

    <a id="my-profile" class="site-profile" href="${profileHref}" aria-label="Your profile">${avatar}</a>

    <details class="site-account-menu" id="site-account-menu">
      <summary aria-label="Account menu for ${initial}">
        <span>${escape(name)}</span>
        <img class="site-icon" src="assets/icons/chevron-small.svg" alt="" width="12" height="12" draggable="false" />
      </summary>
      <div class="site-account-links">
        <a href="${profileHref}">Profile</a>
        <a href="${base('/avatar')}">Customize avatar</a>
        <a href="${base('/settings')}">Settings</a>
        <button type="button" id="logout">Sign out</button>
      </div>
    </details>`;

  wireThemeToggle();
  // The popups only exist after the innerHTML above, so the animated wiring runs
  // per-render. wireAccountMenus() dedupes its own document listeners.
  wireAccountMenus();

  $('open-send-bux')?.addEventListener('click', () => onSendBux?.());
  $('logout')?.addEventListener('click', () => {
    if (onLogout) onLogout();
    else {
      window.location.href = base('/auth');
    }
  });
}

function wireNavIndicator() {
  const bar = $('site-mobile-bar');
  // The pill only exists on the mobile bar. Passing a bare `true` here made
  // `enabled.matches` undefined, so the guard in navigation-indicator.js hid the
  // highlight on every width.
  if (bar && typeof createNavigationIndicator === 'function') {
    return createNavigationIndicator(bar, matchMedia(NARROW_NAV));
  }
  return null;
}

// -- Account menus --------------------------------------------------------
// Reference: unused/uirevamp/site.js:49-77. The Bux pill and the account menu are
// <details> popups, so the native toggle would snap open. The summary click is
// intercepted and the popup is driven through BloxVerseMotion.state() instead,
// which is what home.css:312-325 animates. The popup is `inert` while it is
// closing so the links cannot be tabbed into mid-animation, and only one of the
// two menus is ever open.
//
// index.html keeps its own inline copy of the nav rail and mobile drawer, so it
// imports this one instead of duplicating it.

// The cluster is re-rendered on every auth change, and each render hands us
// brand-new elements, so per-menu wiring is naturally fresh. The two document
// listeners are the part that must not accumulate.
let accountMenusWired = false;
let accountMenuEntries = [];

export function wireAccountMenus() {
  if (typeof BloxVerseMotion === 'undefined') return [];

  const entries = [...document.querySelectorAll('.site-account-menu, .site-bux-menu')]
    .map((menu) => ({ menu, popup: menu.querySelector('.site-account-links'), version: 0 }))
    .filter((entry) => entry.popup);

  if (!entries.length) return entries;

  const setMenu = async (entry, open) => {
    const { menu, popup } = entry;
    const version = ++entry.version;
    if (open) {
      // A stale cluster may still be in the list; only close what is on screen.
      accountMenuEntries.forEach((other) => { if (other !== entry) setMenu(other, false); });
      menu.open = true;
      popup.inert = false;
      BloxVerseMotion.state(popup, 'open');
    } else if (menu.open) {
      popup.inert = true;
      await BloxVerseMotion.state(popup, 'closing');
      // A newer toggle landed while the exit was playing; leave it to that one.
      if (version === entry.version) {
        menu.open = false;
        delete popup.dataset.motionState;
        popup.inert = false;
      }
    }
  };

  for (const entry of entries) {
    entry.popup.classList.add('ui-popup');
    entry.menu.querySelector('summary')?.addEventListener('click', (event) => {
      event.preventDefault();
      setMenu(entry, !entry.menu.open || entry.popup.dataset.motionState === 'closing');
    });
  }
  accountMenuEntries = entries;

  if (!accountMenusWired) {
    accountMenusWired = true;

    // Clicking anywhere outside either menu dismisses it.
    document.addEventListener('click', (event) => {
      for (const entry of accountMenuEntries) if (!entry.menu.contains(event.target)) setMenu(entry, false);
    });

    // Escape closes an open menu first. The nav-rail handler in wireNavRail()
    // already stands down while one is open, so the two never fight over it.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = accountMenuEntries.find((entry) => entry.menu.open);
      if (!open) return;
      setMenu(open, false);
      open.menu.querySelector('summary')?.focus();
    }, true);
  }

  return entries;
}

// Reference: unused/uirevamp/base.js (NOTICE_ICONS / renderNotice / initNotice).
// The bar itself is `#notice`, which pages place between </header> and
// .site-shell. Keeping the driver here means any page that ships the markup
// picks the notice up with no extra wiring.
const NOTICE_ICONS = {
  yellow: 'triangle-exclamation',
  red: 'circle-exclamation',
  blue: 'circle-info',
};
const NOTICE_COLORS = Object.keys(NOTICE_ICONS);
const NOTICE_CACHE_KEY = 'bloxverse_notice';

export function renderNotice(notice) {
  const el = document.getElementById('notice');
  const icon = document.getElementById('notice-icon');
  const text = document.getElementById('notice-text');
  if (!el || !icon || !text) return;
  if (!notice || !notice.message) {
    el.hidden = true;
    el.className = 'notice';
    return;
  }
  const color = NOTICE_COLORS.includes(notice.color) ? notice.color : 'yellow';
  el.className = `notice notice-${color}`;
  el.hidden = false;
  icon.className = `fa-solid fa-${NOTICE_ICONS[color]}`;
  text.textContent = notice.message;
}

// Paints the cached copy immediately, then refreshes it from Firestore. A failed
// read is swallowed on purpose: a missing notice must never break the page.
export function initNotice() {
  const el = document.getElementById('notice');
  if (!el) {
    // Previously a silent return, which made "the page has no #notice markup"
    // look exactly like "the notice is empty". Say so.
    console.warn('[notice] no #notice element on this page; bar not started');
    return;
  }
  try {
    const cached = JSON.parse(localStorage.getItem(NOTICE_CACHE_KEY) || 'null');
    if (cached) renderNotice(cached);
  } catch {
    /* a corrupt cache entry is not worth surfacing */
  }
  import('./firebase.js')
    .then(({ db }) => import('firebase/firestore').then(({ doc, getDoc }) => ({ db, doc, getDoc })))
    .then(({ db, doc, getDoc }) => getDoc(doc(db, 'settings', 'notice')))
    .then((snap) => {
      const data = snap && snap.exists() ? snap.data() : null;
      if (!data || !data.message) {
        renderNotice(null);
        try { localStorage.removeItem(NOTICE_CACHE_KEY); } catch { /* private mode */ }
        return;
      }
      const notice = { message: data.message, color: data.color };
      renderNotice(notice);
      try { localStorage.setItem(NOTICE_CACHE_KEY, JSON.stringify(notice)); } catch { /* private mode */ }
    })
    .catch((e) => {
      // Not silent: a missing bar is otherwise indistinguishable from a broken
      // read, which is exactly the kind of bug that hides for days.
      console.warn('[notice] unavailable:', e);
    });
}

export function initShell() {
  wireNavRail();
  wireThemeToggle();
  const indicator = wireNavIndicator();
  wireAccountMenus();
  wireMobileDrawer(indicator);
  initNotice();
  // Reference: unused/uirevamp/site.js. Leaving the mobile range while the sheet
  // is open would strand the "More" pill highlight on a hidden bar.
  if (indicator && typeof closeDialog === 'function') {
    matchMedia(NARROW_NAV).addEventListener('change', (event) => {
      const menu = $('site-mobile-menu');
      if (!event.matches && menu?.open) closeDialog(menu);
    });
  }
  return indicator;
}
