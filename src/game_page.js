/**
 * Game detail page controller.
 *
 * Ported from the BloxVerse UI reference unused\uirevamp\game.js and merged with the
 * existing BloxVerse game-detail logic (servers, edit/delete, app deep-links,
 * etc.).  The reference renders the page content dynamically via renderGame()
 * so the HTML shell only needs the loading skeleton.
 */

import { auth, db, trackPresence, deleteGame, updateGame, listenBux, assignUserIdNum } from './firebase.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { findGame, findGameAsync } from './games.js';
import { isDesktopApp, buildJoinUrl } from './app-detect.js';
import { getDeviceId } from './firebase.js';
import { renderAccountCluster } from './shell.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function byId(id) { return document.getElementById(id); }

function formatGameNumber(value) {
  return Number.isFinite(value) && value >= 0
    ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : '—';
}

function motion() { return window.BloxVerseMotion ?? null; }

// ─── state ────────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const gameId = params.get('id');

let _gameData = null;
let _gameAuthorId = null;
let _authUser = null;
let _uploadedIcon = null;
let _pendingJoin = null;

// Simple avatar URL cache (keyed by uid) to avoid repeated Firestore reads.
const _avatarCache = new Map();

// ─── page-level cache (instant paint on repeat visits) ────────────────────────

const CACHE_TTL = 45000;
const CACHE_PFX = 'bv:gd:';
const _memCache = new Map();

function _cacheSafe(val) {
  if (val === null || typeof val !== 'object') return val;
  if (typeof val.toDate === 'function' && typeof val.toMillis === 'function') return val.toMillis();
  if (Array.isArray(val)) return val.map(_cacheSafe);
  const out = {};
  for (const k in val) out[k] = _cacheSafe(val[k]);
  return out;
}

function cacheGet(key) {
  const mem = _memCache.get(key);
  if (mem) {
    if (Date.now() - mem.at > CACHE_TTL) _memCache.delete(key);
    else return mem.data;
  }
  try {
    const raw = localStorage.getItem(CACHE_PFX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.at > CACHE_TTL) { localStorage.removeItem(CACHE_PFX + key); return null; }
    _memCache.set(key, { at: entry.at, data: entry.data });
    return entry.data;
  } catch { return null; }
}

function cacheSet(key, data) {
  _memCache.set(key, { at: Date.now(), data });
  try {
    const serialized = JSON.stringify({ at: Date.now(), data });
    if (serialized.length > 400000) return;
    localStorage.setItem(CACHE_PFX + key, serialized);
  } catch {}
}

// ─── error state ──────────────────────────────────────────────────────────────

function renderError(notFound) {
  const page = byId('page');
  page.setAttribute('aria-busy', 'false');
  page.innerHTML = `<section class="game-state" role="status">
    <h1>${notFound ? 'Game unavailable' : 'Could not load this game'}</h1>
    <p>${notFound
      ? 'This game may be private or no longer available.'
      : 'Check your connection and try again.'}</p>
    <div class="game-state-actions">
      ${notFound ? '' : '<button class="btn-primary" type="button" id="game-retry">Try again</button>'}
      <a class="btn-secondary" href="/bloxverse/">Discover games</a>
    </div>
  </section>`;
  byId('game-retry')?.addEventListener('click', init);
}

// ─── render ───────────────────────────────────────────────────────────────────

function renderGame(game) {
  if (!game) return;
  _gameData = game;
  _gameAuthorId = game.authorId ?? null;

  document.title = `${game.name} – BloxVerse`;

  const createdAt = game.createdAt
    ? new Date(typeof game.createdAt === 'number' ? game.createdAt : game.createdAt)
    : null;
  const createdLabel = createdAt && Number.isFinite(createdAt.getTime())
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(createdAt)
    : null;

  const hasAuthorLink = !!game.authorId || (Number.isSafeInteger(game.creator) && game.creator > 0);

  const page = byId('page');
  page.innerHTML = `
    <article class="game-shell">

      <!-- Banner -->
      <figure class="ui-card game-banner">
        <img id="game-thumbnail" src="${esc(game.icon || '')}" alt="${esc(game.name)}" fetchpriority="high">
        <div class="game-artwork-fallback" id="game-artwork-fallback" hidden>
          <i class="fa-solid fa-image" aria-hidden="true"></i><span>Preview unavailable</span>
        </div>
      </figure>

      <!-- Heading + play button -->
      <header class="game-heading">
        <div class="game-identity">
          <h1>${esc(game.name)}</h1>
          <dl class="game-metrics">
            <div>
              <dt>Playing now</dt>
              <dd><i class="fa-solid fa-users" aria-hidden="true"></i><span id="stat-active">${formatGameNumber(game.activePlayers)}</span></dd>
            </div>
            <div>
              <dt>Visits</dt>
              <dd><i class="fa-solid fa-eye" aria-hidden="true"></i><span id="stat-visits">${formatGameNumber(game.visits)}</span></dd>
            </div>
          </dl>
          <div class="game-creator">
            <span class="game-creator-portrait" id="game-creator-portrait" aria-hidden="true"></span>
            <span>By <span id="game-creator-name">${esc(game.authorName || (game.creator === 1 ? 'BloxVerse' : 'Unknown'))}</span></span>
          </div>
        </div>
        ${game.deleted
          ? `<div class="btn-primary game-play" style="opacity:.5;cursor:not-allowed;" aria-disabled="true">
               <i class="fa-solid fa-play" aria-hidden="true"></i> Under Review
             </div>`
          : `<a class="btn-primary game-play" href="#" id="game-play-btn" role="button">
               <i class="fa-solid fa-play" aria-hidden="true"></i> Play
             </a>`
        }
      </header>

      <!-- Owner actions bar (hidden until auth resolves) -->
      <div class="game-owner-actions" id="game-owner-actions" hidden>
        <span>You own this game</span>
        <button type="button" class="btn-secondary btn-sm" id="game-edit-btn">
          <i class="fa-solid fa-pen" aria-hidden="true"></i> Edit
        </button>
        <button type="button" class="btn-danger-outline btn-sm" id="game-delete-btn">
          <i class="fa-solid fa-trash" aria-hidden="true"></i> Delete
        </button>
      </div>

      <!-- Tab bar -->
      <nav class="tab-bar game-tabs" id="game-tabs" role="tablist" aria-label="Game sections">
        <button class="tab-btn active" type="button" role="tab"
                id="game-tab-about" data-game-tab="about"
                aria-selected="true" aria-controls="game-panel-about" tabindex="0">About</button>
        <button class="tab-btn" type="button" role="tab"
                id="game-tab-servers" data-game-tab="servers"
                aria-selected="false" aria-controls="game-panel-servers" tabindex="-1">Servers</button>
        <button class="tab-btn" type="button" role="tab"
                id="game-tab-store" data-game-tab="store"
                aria-selected="false" aria-controls="game-panel-store" tabindex="-1">Store</button>
      </nav>

      <!-- About panel -->
      <section class="game-panel" id="game-panel-about" role="tabpanel" aria-labelledby="game-tab-about">
        <div class="game-overview">
          <div>
            <h2 class="game-section-title">About</h2>
            <p class="game-about-text">${esc(String(game.description || '').trim() || 'The creator has not added a description yet.')}</p>
          </div>
          <dl class="game-facts">
            ${createdLabel
              ? `<div><dt>Created</dt><dd><time datetime="${createdAt.toISOString()}">${createdLabel}</time></dd></div>`
              : ''
            }
            ${game.category ? `<div><dt>Genre</dt><dd>${esc(game.category)}</dd></div>` : ''}
            <div><dt>Server size</dt><dd>${game.maxPlayers || 10} players</dd></div>
          </dl>
        </div>
      </section>

      <!-- Servers panel -->
      <section class="game-panel game-servers" id="game-panel-servers"
               role="tabpanel" aria-labelledby="game-tab-servers" hidden>
        <div class="game-servers-heading">
          <h2 class="game-section-title" id="game-servers-title">
            Servers
            <span class="ui-count-badge" id="server-total" style="--count-badge-size:22px;"></span>
          </h2>
          <button type="button" class="btn-secondary btn-sm" id="server-refresh">
            <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
            <span>Refresh</span>
          </button>
        </div>
        <p class="game-server-error" id="server-error" role="alert" hidden></p>
        <div class="game-server-list" id="server-list"></div>
        <p class="sr-only" id="server-status" role="status"></p>
      </section>

      <section class="game-panel" id="game-panel-store"
               role="tabpanel" aria-labelledby="game-tab-store" hidden>
        <div class="ui-card game-store-empty">
          <i class="fa-solid fa-store" aria-hidden="true"></i>
          <div>
            <h2>Nothing for sale yet</h2>
            <p>This game does not have any store items right now.</p>
          </div>
        </div>
      </section>

    </article>`;

  // Thumbnail fallback
  const thumb = byId('game-thumbnail');
  const fallback = () => { thumb.hidden = true; byId('game-artwork-fallback').hidden = false; };
  thumb.addEventListener('error', fallback, { once: true });
  if (thumb.complete && thumb.naturalWidth === 0) fallback();

  // Creator portrait
  loadCreatorPortrait(game);

  // Play button
  const playBtn = byId('game-play-btn');
  if (playBtn) playBtn.addEventListener('click', e => { e.preventDefault(); requestJoin(gameId, null); });

  // Owner buttons (wired after auth resolves in initAuth())
  byId('game-edit-btn')?.addEventListener('click', openEditDialog);
  byId('game-delete-btn')?.addEventListener('click', confirmDelete);
  if (_authUser?.uid === _gameAuthorId) byId('game-owner-actions').hidden = false;

  // Tabs
  initTabs();

  // Servers realtime listener
  _unsubServers?.();
  _unsubServers = null;
  initServers();

  page.setAttribute('aria-busy', 'false');
  motion()?.reveal(page);
}

// ─── creator portrait ─────────────────────────────────────────────────────────

async function loadCreatorPortrait(game) {
  const container = byId('game-creator-portrait');
  if (!container) return;

  // For official games creator is a numeric user ID; for published games it's
  // an authorId (firebase UID) + authorName pair.
  let uid = null;
  let profileNum = null;

  if (game.authorId) {
    uid = game.authorId;
    // Try to resolve the numeric profile ID for the profile link.
    try {
      const uSnap = await getDoc(doc(db, 'users', uid));
      if (uSnap.exists()) profileNum = uSnap.data().userIdNum || null;
    } catch {}
  } else if (Number.isSafeInteger(game.creator) && game.creator > 1) {
    // Official game with a numeric creator → look up their uid via the
    // userIds/{num} collection that BloxVerse uses as a reverse index.
    profileNum = game.creator;
    try {
      const { lookupUserByNum } = await import('./firebase.js');
      const info = await lookupUserByNum(game.creator);
      if (info?.uid) uid = info.uid;
      if (info?.username) {
        const nameEl = byId('game-creator-name');
        if (nameEl) nameEl.textContent = info.username;
      }
    } catch {}
  }

  if (!uid) { container.hidden = true; return; }

  // Fetch the user's head avatar URL from Firestore.
  try {
    const uSnap = await getDoc(doc(db, 'users', uid));
    const data = uSnap.exists() ? uSnap.data() : {};
    const avatarUrl = data.avatarPreviewHead || data.avatarPreview || null;
    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'game-creator-image';
      img.src = avatarUrl;
      img.alt = '';
      img.width = 40;
      img.height = 40;
      container.appendChild(img);
    }
    if (profileNum || data.userIdNum) {
      const num = profileNum || data.userIdNum;
      const nameEl = byId('game-creator-name');
      if (nameEl) {
        const a = document.createElement('a');
        a.href = `/bloxverse/profile?user=${num}`;
        a.textContent = nameEl.textContent;
        nameEl.replaceWith(a);
      }
    }
  } catch {}
}

// ─── tab bar ─────────────────────────────────────────────────────────────────

function initTabs() {
  const tabs = [...document.querySelectorAll('[data-game-tab]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      const panel = byId(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', e => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(i + tabs.length - 1) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next, true);
    });
  });
  byId('server-refresh')?.addEventListener('click', () => refreshServers());
}

// ─── servers ─────────────────────────────────────────────────────────────────

let _unsubServers = null;

function avatarEl(uid) {
  const frame = document.createElement('span');
  frame.className = 'game-server-avatar';
  frame.setAttribute('aria-hidden', 'true');
  if (_avatarCache.has(uid)) {
    const { url } = _avatarCache.get(uid);
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; frame.appendChild(img); }
    else { frame.textContent = _avatarCache.get(uid).initial; }
    return frame;
  }
  getDoc(doc(db, 'users', uid)).then(snap => {
    const d = snap.exists() ? snap.data() : {};
    const url = d.avatarPreviewHead || d.avatarPreview || null;
    const initial = (d.username?.[0] || '?').toUpperCase();
    _avatarCache.set(uid, { url, initial });
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; frame.appendChild(img); }
    else { frame.textContent = initial; }
  }).catch(() => { frame.textContent = '?'; });
  return frame;
}

function buildServerCard(server, index) {
  const players = server.players || [];
  const max = server.maxPlayers || _gameData?.maxPlayers || 10;
  const full = players.length >= max;

  const card = document.createElement('article');
  card.className = 'ui-card game-server';
  card.dataset.instance = server.id;

  const header = document.createElement('div');
  header.className = 'game-server-header';
  const h3 = document.createElement('h3');
  h3.textContent = `Server ${index + 1}`;
  const countP = document.createElement('p');
  countP.textContent = `${players.length} / ${max} players`;
  header.append(h3, countP);

  const bottom = document.createElement('div');
  bottom.className = 'game-server-bottom';

  const avatars = document.createElement('div');
  avatars.className = 'game-server-avatars';
  const shown = [...new Set(players)].slice(0, 4);
  shown.forEach(uid => avatars.appendChild(avatarEl(uid)));
  const extra = Math.max(0, players.length - shown.length);
  if (extra) {
    const more = document.createElement('span');
    more.className = 'game-server-avatar';
    more.textContent = `+${extra}`;
    more.setAttribute('aria-label', `${extra} more players`);
    avatars.appendChild(more);
  } else if (!players.length) {
    const vacant = document.createElement('span');
    vacant.className = 'game-server-vacant';
    vacant.textContent = 'Be the first to join';
    avatars.appendChild(vacant);
  }

  const joinBtn = document.createElement('a');
  joinBtn.className = 'btn-secondary btn-sm';
  joinBtn.textContent = full ? 'Join (Queue)' : 'Join server';
  joinBtn.setAttribute('aria-label', `Join server ${index + 1}`);
  joinBtn.href = '#';
  joinBtn.addEventListener('click', e => { e.preventDefault(); requestJoin(gameId, server.id); });

  bottom.append(avatars, joinBtn);
  card.append(header, bottom);
  return card;
}

function renderServers(servers) {
  const list = byId('server-list');
  if (!list) return;
  list.replaceChildren();
  if (!servers.length) {
    list.innerHTML = `<div class="ui-card game-server-empty">
      <i class="fa-solid fa-server" aria-hidden="true"></i>
      <div><h3>No public servers right now</h3>
           <p>You can still use Play to launch the game, or refresh to check again.</p>
      </div></div>`;
  } else {
    servers.forEach((s, i) => list.appendChild(buildServerCard(s, i)));
  }
  const totalEl = byId('server-total');
  if (totalEl) totalEl.textContent = String(servers.length);
  const statusEl = byId('server-status');
  if (statusEl) statusEl.textContent = `${servers.length} ${servers.length === 1 ? 'server' : 'servers'} shown.`;
  motion()?.reveal(list);
}

function initServers() {
  if (!gameId) return;
  // Paint cached servers instantly.
  const cached = cacheGet('servers:' + gameId);
  if (Array.isArray(cached)) renderServers(cached);

  // Subscribe to realtime Firestore updates.
  const q = query(collection(db, 'servers'), where('gameId', '==', gameId));
  _unsubServers = onSnapshot(q, snap => {
    const servers = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? (typeof a.createdAt === 'number' ? a.createdAt : 0);
        const tb = b.createdAt?.toMillis?.() ?? (typeof b.createdAt === 'number' ? b.createdAt : 0);
        return ta - tb;
      });
    cacheSet('servers:' + gameId, _cacheSafe(servers));
    renderServers(servers);
  }, err => console.warn('[game] servers listener error:', err));
}

function refreshServers() {
  const btn = byId('server-refresh');
  if (btn) { btn.disabled = true; motion()?.setPending(btn, true, 'Refreshing'); }
  // Re-subscribe to get fresh data.
  _unsubServers?.();
  initServers();
  setTimeout(() => {
    if (btn) { btn.disabled = false; motion()?.setPending(btn, false); }
  }, 2000);
}

// ─── join / app prompt ────────────────────────────────────────────────────────

function gameSiteUrl(gid, sid) {
  return `/bloxverse/game?game=${encodeURIComponent(gid)}${sid ? `&server=${encodeURIComponent(sid)}` : ''}`;
}

async function launchInApp(gid, sid) {
  try {
    const idToken = await auth.currentUser.getIdToken();
    const refreshToken = auth.currentUser.refreshToken;
    const deviceId = getDeviceId();
    const url = buildJoinUrl(gid, sid)
      + '&idToken=' + encodeURIComponent(idToken)
      + '&refreshToken=' + encodeURIComponent(refreshToken)
      + '&deviceId=' + encodeURIComponent(deviceId);
    window.location.href = url;
    return true;
  } catch { return false; }
}

function requestJoin(gid, sid) {
  const siteUrl = gameSiteUrl(gid, sid);
  // Resolve auth state then decide whether to show the app prompt.
  new Promise(resolve => {
    if (auth.currentUser) return resolve(auth.currentUser);
    const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); });
  }).then(user => {
    if (isDesktopApp || !user) { window.location.href = siteUrl; return; }
    _pendingJoin = { gid, sid, siteUrl };
    showAppPrompt();
  });
}

function showAppPrompt() {
  // Build the dialog if it hasn't been built yet.
  let dialog = byId('app-prompt-dialog');
  if (!dialog.querySelector('.action-dialog')) {
    dialog.innerHTML = `
      <div class="action-dialog" role="dialog" aria-modal="true" aria-labelledby="app-prompt-title">
        <div class="action-dialog-card">
          <h2 class="action-dialog-title" id="app-prompt-title">Open in BloxVerse App?</h2>
          <p class="action-dialog-message">Open this game in the BloxVerse desktop app, or continue playing in your browser.</p>
          <div class="action-dialog-buttons">
            <button type="button" class="btn-secondary" id="app-prompt-browser">Continue in Browser</button>
            <button type="button" class="btn-primary" id="app-prompt-open">Open App</button>
          </div>
        </div>
      </div>`;
    byId('app-prompt-open').addEventListener('click', async () => {
      if (!_pendingJoin) return;
      const launched = await launchInApp(_pendingJoin.gid, _pendingJoin.sid);
      if (launched) hideAppPrompt();
      else window.location.href = _pendingJoin.siteUrl;
    });
    byId('app-prompt-browser').addEventListener('click', () => {
      hideAppPrompt();
      if (_pendingJoin) window.location.href = _pendingJoin.siteUrl;
    });
    dialog.addEventListener('click', e => { if (e.target === dialog) hideAppPrompt(); });
  }
  dialog.hidden = false;
  dialog.removeAttribute('aria-hidden');
}

function hideAppPrompt() {
  const d = byId('app-prompt-dialog');
  if (d) { d.hidden = true; d.setAttribute('aria-hidden', 'true'); }
}

// ─── edit dialog ──────────────────────────────────────────────────────────────

function openEditDialog() {
  if (typeof openDialog !== 'function') {
    // Fallback if action-dialog.js isn't loaded yet.
    alert('Edit not available. Please try again.');
    return;
  }
  openDialog({
    title: 'Edit Game',
    message: '',
    body: `
      <div style="display:grid;gap:var(--space-16);">
        <label class="ui-field">
          <span class="ui-label">Game Name</span>
          <input id="edit-name" class="ui-input" type="text" maxlength="50" value="${esc(_gameData?.name || '')}" />
        </label>
        <label class="ui-field">
          <span class="ui-label">Genre</span>
          <select id="edit-genre" class="ui-input">
            ${['Sandbox','Exploration','Sports','Fighting','Racing','Adventure','Simulation','Puzzle','Horror','Comedy','RPG','Strategy','Other']
              .map(g => `<option${g === _gameData?.category ? ' selected' : ''}>${g}</option>`).join('')}
          </select>
        </label>
        <label class="ui-field">
          <span class="ui-label">Description</span>
          <textarea id="edit-desc" class="ui-input" rows="4" maxlength="1000" style="resize:vertical;">${esc(_gameData?.description || '')}</textarea>
        </label>
        <div class="ui-field">
          <span class="ui-label">Thumbnail</span>
          <div style="display:flex;align-items:center;gap:var(--space-12);">
            <img id="edit-thumb-preview" src="${esc(_gameData?.icon || 'assets/icons/demo.png')}"
                 style="width:64px;height:64px;border-radius:var(--radius-md);object-fit:cover;" alt="" />
            <button type="button" id="edit-upload-btn" class="btn-secondary btn-sm">Upload Image</button>
            <input type="file" id="edit-thumb-input" accept="image/*" style="display:none;" />
          </div>
        </div>
      </div>`,
    confirmText: 'Save Changes',
    cancelText: 'Cancel',
    onConfirm: async () => {
      const name = byId('edit-name').value.trim();
      if (!name) { byId('edit-name').focus(); throw new Error('Name is required.'); }
      const updates = {
        name,
        category: byId('edit-genre').value,
        description: byId('edit-desc').value.trim(),
      };
      if (_uploadedIcon) updates.icon = _uploadedIcon;
      await updateGame(gameId, auth.currentUser?.uid, updates);
      window.location.reload();
    },
  });

  // Wire upload after the dialog body is in the DOM.
  requestAnimationFrame(() => {
    const uploadBtn = byId('edit-upload-btn');
    const fileInput = byId('edit-thumb-input');
    if (!uploadBtn || !fileInput) return;
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      byId('edit-thumb-preview').src = URL.createObjectURL(file);
      uploadBtn.textContent = 'Uploading…';
      uploadBtn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', 'bloxverse_thumb');
        const res = await fetch('https://api.cloudinary.com/v1_1/dvkbiobph/image/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.secure_url) throw new Error(data.error?.message || 'Upload failed');
        _uploadedIcon = data.secure_url;
        byId('edit-thumb-preview').src = data.secure_url;
        uploadBtn.textContent = 'Change Image';
      } catch (err) {
        uploadBtn.textContent = 'Upload Image';
        alert('Upload failed: ' + err.message);
      } finally {
        uploadBtn.disabled = false;
      }
    });
  });
}

async function confirmDelete() {
  if (!confirm('Delete this game permanently? This cannot be undone.')) return;
  const btn = byId('game-delete-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    await deleteGame(gameId, auth.currentUser?.uid);
    window.location.href = '/bloxverse/';
  } catch (err) {
    alert('Failed to delete: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
  }
}

// ─── stats updater ────────────────────────────────────────────────────────────

function updateStats(game) {
  const active = byId('stat-active');
  const visits = byId('stat-visits');
  if (active) active.textContent = formatGameNumber(game.activePlayers);
  if (visits) visits.textContent = formatGameNumber(game.visits);
}

// ─── auth / shell integration ─────────────────────────────────────────────────

function initAuth() {
  onAuthStateChanged(auth, async user => {
    _authUser = user;
    document.querySelectorAll('[data-needs-auth]').forEach(el => { el.hidden = !user; });

    if (!user) {
      renderAccountCluster(null, { sitePath: p => `/bloxverse${p}` });
      return;
    }

    try {
      await assignUserIdNum(user.uid);
      const profileSnap = await getDoc(doc(db, 'users', user.uid));
      const profile = profileSnap.exists() ? profileSnap.data() : {};
      renderAccountCluster(user, {
        username: profile.username || user.displayName,
        bux: profile.bux || 0,
        userNum: profile.userIdNum,
        preview: profile.avatarPreviewHead || profile.avatarPreview || null,
        sitePath: p => `/bloxverse${p}`,
        onLogout: async () => {
          await signOut(auth);
          window.location.href = '/bloxverse/auth';
        },
      });
    } catch (error) {
      console.warn('[game] account cluster failed:', error);
    }

    if (user) {
      trackPresence(user.uid, null, 'game-detail');

      // Ban listener.
      onSnapshot(doc(db, 'bans', user.uid), snap => {
        if (snap.exists() && snap.data().banned) window.location.href = '/bloxverse/ban';
      }, () => {});

      // Show owner actions if this user owns the game.
      if (_gameAuthorId && user.uid === _gameAuthorId) {
        const bar = byId('game-owner-actions');
        if (bar) bar.hidden = false;
      }

      // Watch for game deletion/recovery.
      if (gameId) {
        onSnapshot(doc(db, 'publishedGames', gameId), snap => {
          if (snap.exists()) {
            const isDeleted = snap.data().deleted === true;
            if (typeof window._gameDeleted !== 'undefined' && window._gameDeleted !== isDeleted) {
              window.location.reload();
            }
            window._gameDeleted = isDeleted;
          }
        }, () => {});
      }

      // Shell: populate the account slot via shell.js (already handled by the
      // shared shell module loaded by home.css+shell.js), nothing extra needed.
      listenBux(user.uid, bux => {
        // The shell module updates the bux counter itself. This is a no-op
        // safety net in case the page is loaded without the shell.
        const el = byId('buxValue');
        if (el) el.textContent = bux.toLocaleString();
      });
    }
  });
}

// ─── init ─────────────────────────────────────────────────────────────────────

async function init() {
  if (!gameId) { renderError(true); return; }

  const page = byId('page');
  page.setAttribute('aria-busy', 'true');
  const retryBtn = byId('game-retry');
  if (retryBtn) { retryBtn.disabled = true; retryBtn.textContent = 'Loading…'; }

  // Instant paint from cache so the screen doesn't stay blank on repeat visits.
  const cached = cacheGet('page:' + gameId);
  const staticGame = findGame(gameId);
  const quickGame = cached?.game || staticGame;
  if (quickGame) {
    renderGame(quickGame);
    initAuth();
  }

  // Full async load (refreshes stats + authorName).
  try {
    const game = await findGameAsync(gameId);
    if (!game) { if (!quickGame) renderError(true); return; }
    renderGame(game);
    cacheSet('page:' + gameId, _cacheSafe({ game }));
    if (!quickGame) initAuth();

    // Poll active player count every 10 s.
    setInterval(async () => {
      try {
        const fresh = await findGameAsync(gameId);
        if (fresh) { updateStats(fresh); cacheSet('page:' + gameId, _cacheSafe({ game: fresh })); }
      } catch {}
    }, 10000);
  } catch (err) {
    console.warn('[game] load error:', err);
    if (!quickGame) renderError(false);
  }
}

init();
