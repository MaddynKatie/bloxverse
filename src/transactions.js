// Transactions page.
//
// Ported from the reference transactions.js onto BloxVerse. Differences, all because
// BloxVerse has no REST history endpoint:
//
//   1. The history. The reference pages and filters on the server through its
//      history endpoint. Ours is the player's rows in Firestore, read once with
//      getTransactions() and paged and filtered here.
//   2. Who and what. The reference rows carry the other player and the item. Ours
//      carry them as optional itemId / otherUserId (written by the server for
//      purchases and trades) and otherwise only as text, so older rows are matched
//      from their description: a sent or received transfer names a player, a bought
//      or sold line names an item.
//   3. The platform. The reference credits its own account for anything that is not
//      a trade. Ours credits the BloxVerse account, user 18, looked up like any other
//      player so it shows that account's real avatar and name.
import { auth, db, getTransactions, listenBux, banGuard, trackPresence, assignUserIdNum } from './firebase.js';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, query, where, limit } from 'firebase/firestore';
import { renderAccountCluster } from './shell.js';
import { loadCatalog, getAccessoriesStore, getClothingStore, getFacesStore, getEmotesStore } from './catalogStore.js';
import { itemImage } from './catalog_view.js';
import { ensureItemPreviews } from './item-preview.js';

const byId = id => document.getElementById(id);
const list = byId('transactions-list');
const empty = byId('transactions-empty');
const errorEl = byId('transactions-error');
const pagination = byId('transactions-pagination');
const pageSizeSelect = byId('transactions-page-size');
const categorySelect = byId('transactions-category');

const PLATFORM_USER_NUM = 18;
const PLATFORM_NAME = 'BloxVerse';
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;

// The filter. Fixed, like the reference's, rather than built from whatever sources
// happen to be in the history.
const CATEGORIES = [
  ['', 'All transactions'],
  ['purchases', 'Purchases'],
  ['sales', 'Sales'],
  ['transfers', 'Transfers'],
  ['other', 'Other'],
];

let entries = [];
let currentUser = null;
let username = '';
let page = 0;
let renderToken = 0;
let itemsById = new Map();
let itemsByName = new Map();

// -- Icons -----------------------------------------------------------------

function buxIcon() {
  const img = document.createElement('img');
  img.className = 'bux-icon';
  img.src = 'assets/icons/bux.svg';
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.draggable = false;
  return img;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

// -- Players ---------------------------------------------------------------

// Everything here is cached for the page's life: the same few players (the platform
// account above all) turn up on most rows.
const playersByUid = new Map();
const playersByName = new Map();
const playersByEmail = new Map();
let platformPlayer = null;

function playerFrom(id, data) {
  return {
    id,
    name: data.username || 'Player',
    num: data.userIdNum ?? null,
    avatar: data.avatarPreviewHead || data.avatarPreview || null,
  };
}

function playerByUid(uid) {
  if (!playersByUid.has(uid)) {
    playersByUid.set(uid, getDoc(doc(db, 'users', uid)).then(
      snap => (snap.exists() ? playerFrom(uid, snap.data()) : null),
      () => null,
    ));
  }
  return playersByUid.get(uid);
}

function playerWhere(cache, key, field, value) {
  if (!cache.has(key)) {
    cache.set(key, getDocs(query(collection(db, 'users'), where(field, '==', value), limit(1))).then(
      found => (found.empty ? null : playerFrom(found.docs[0].id, found.docs[0].data())),
      () => null,
    ));
  }
  return cache.get(key);
}

const playerByName = name => playerWhere(playersByName, name, 'username', name);
const playerByEmail = email => playerWhere(playersByEmail, email.toLowerCase(), 'email', email);

function platform() {
  if (!platformPlayer) {
    platformPlayer = playerWhere(new Map(), 'platform', 'userIdNum', PLATFORM_USER_NUM)
      .then(found => found || { id: null, name: PLATFORM_NAME, num: PLATFORM_USER_NUM, avatar: null });
  }
  return platformPlayer;
}

// "Sent 50 Bux to name" / "Received 50 Bux from name": the rows that name another
// player when the row carries no otherUserId.
function counterpart(entry) {
  const match = /^(?:Sent .+ to|Received .+ from) (.+)$/.exec(entry.description || '');
  return match ? match[1] : null;
}

async function sourceFor(entry) {
  if (entry.otherUserId) {
    const found = await playerByUid(entry.otherUserId);
    if (found) return found;
  }
  const named = counterpart(entry);
  if (named) {
    const found = await playerByName(named);
    return found || { id: null, name: named, num: null, avatar: null };
  }
  return platform();
}

// -- Wording ---------------------------------------------------------------

// Old rows say "Purchased X" and "Bought copy #7 of X"; the reference reads
// "Bought X" and "Sold X #7", so every row is shown that way.
function plainText(entry) {
  const text = (entry.description || '').trim();
  let match = /^Purchased (.+)$/.exec(text);
  if (match) return `Bought ${match[1]}`;
  match = /^(Bought|Sold) copy #(\d+) of (.+)$/.exec(text);
  if (match) return `${match[1]} ${match[3]} #${match[2]}`;
  return text;
}

// Staff adjustments tend to carry an email address. Players read a name, not an
// address, so each one is swapped for the account's username, and an address that
// cannot be resolved falls back to the platform name rather than being shown.
async function withoutEmails(text) {
  const found = text.match(EMAIL);
  if (!found) return text;
  let result = text;
  for (const address of new Set(found)) {
    let name = null;
    if (currentUser?.email && address.toLowerCase() === currentUser.email.toLowerCase()) name = username;
    else name = (await playerByEmail(address))?.name || null;
    result = result.split(address).join(name || PLATFORM_NAME);
  }
  return result;
}

async function describe(entry) {
  const text = await withoutEmails(plainText(entry));
  return text || (entry.source ? await withoutEmails(String(entry.source)) : 'Transaction');
}

// -- Items -----------------------------------------------------------------

function buildItems() {
  const catalog = [
    ...getAccessoriesStore().map(a => ({ ...a, type: 'accessory' })),
    ...getClothingStore().map(c => ({ ...c, type: 'shirt' })),
    ...getFacesStore().map(f => ({ ...f, type: 'face' })),
    ...getEmotesStore().map(e => ({ ...e, type: 'emote' })),
  ];
  itemsById = new Map(catalog.map(item => [item.id, item]));
  // A name that two items share cannot say which one a row meant, so it is dropped
  // rather than guessed at.
  const seen = new Map();
  for (const item of catalog) {
    const key = String(item.name || '').trim().toLowerCase();
    if (key) seen.set(key, seen.has(key) ? null : item);
  }
  itemsByName = new Map([...seen].filter(([, item]) => item));
}

function itemFor(entry) {
  if (entry.itemId && itemsById.has(entry.itemId)) return itemsById.get(entry.itemId);
  const match = /^(?:Bought|Sold) (.+?)(?: #\d+)?$/.exec(plainText(entry));
  return match ? itemsByName.get(match[1].trim().toLowerCase()) || null : null;
}

// -- Categories ------------------------------------------------------------

function categoryOf(entry) {
  const text = plainText(entry);
  if (/^Sold /.test(text)) return 'sales';
  if (/^Bought /.test(text)) return 'purchases';
  if (entry.source === 'SendBux' || counterpart(entry)) return 'transfers';
  return 'other';
}

// -- Rows ------------------------------------------------------------------

function avatarTile(player) {
  const frame = document.createElement('div');
  frame.className = 'avatar-frame source-avatar-wrap';
  const letter = () => { frame.replaceChildren(document.createTextNode((player.name || '?').charAt(0).toUpperCase())); };
  const image = src => {
    const img = document.createElement('img');
    img.className = 'source-avatar';
    img.src = src;
    img.alt = '';
    img.width = 28;
    img.height = 28;
    img.draggable = false;
    img.addEventListener('error', letter, { once: true });
    frame.append(img);
  };
  if (player.avatar) image(player.avatar);
  else if (player.id === null && player.name === PLATFORM_NAME) image('assets/icons/bloxverseLogo.png');
  else letter();
  return frame;
}

function sourceCell(player) {
  const linked = player.num !== null && player.num !== undefined;
  const cell = document.createElement(linked ? 'a' : 'div');
  cell.className = 'col-source';
  if (linked) {
    cell.href = `/bloxverse/profile?user=${player.num}`;
    cell.target = '_blank';
    cell.rel = 'noopener';
  }
  const name = document.createElement('span');
  name.className = 'source-name';
  name.textContent = player.name;
  name.title = player.name;
  cell.append(avatarTile(player), name);
  return cell;
}

function descCell(text, item) {
  const href = item ? `/bloxverse/catalog?item=${encodeURIComponent(item.id)}` : null;
  const cell = document.createElement(href ? 'a' : 'div');
  cell.className = 'col-desc';
  if (href) {
    cell.href = href;
    cell.target = '_blank';
    cell.rel = 'noopener';
  }

  const icon = document.createElement('div');
  icon.className = 'desc-icon';
  icon.append(item ? itemImage(item) : buxIcon());

  const body = document.createElement('div');
  body.className = 'desc-text';
  const title = document.createElement('div');
  title.className = 'desc-title';
  title.textContent = text;
  title.title = text;
  body.append(title);

  cell.append(icon, body);
  return cell;
}

function entryRow(entry, source, text, item) {
  const row = document.createElement('div');
  row.className = 'transactions-row';
  row.setAttribute('role', 'row');

  const dateCell = document.createElement('div');
  dateCell.className = 'col-date';
  dateCell.textContent = formatDate(entry.createdAt);

  const amountValue = Number(entry.amount) || 0;
  const amount = document.createElement('div');
  amount.className = 'col-amount' + (amountValue >= 0 ? ' positive' : ' negative');
  const figure = document.createElement('span');
  figure.textContent = (amountValue >= 0 ? '+' : '') + amountValue.toLocaleString();
  amount.append(buxIcon(), figure);

  row.append(dateCell, sourceCell(source), descCell(text, item), amount);
  return row;
}

// -- Pagination ------------------------------------------------------------

function pageButton(label, target, { current = false, disabled = false, aria } = {}, onPage) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (aria) button.setAttribute('aria-label', aria);
  if (current) button.setAttribute('aria-current', 'page');
  button.disabled = disabled || current;
  if (!button.disabled) button.addEventListener('click', () => onPage(target));
  return button;
}

function renderPagination(container, current, totalPages, onPage) {
  container.replaceChildren();
  if (totalPages <= 1) return;

  const nodes = [pageButton('Prev', current - 1, { disabled: current === 0, aria: 'Previous page' }, onPage)];
  // First, last, and a window of two either side of the current page; the gaps
  // between collapse to an ellipsis so a long history stays one row tall.
  let last = -1;
  for (let i = 0; i < totalPages; i++) {
    if (i !== 0 && i !== totalPages - 1 && Math.abs(i - current) > 2) continue;
    if (last !== -1 && i - last > 1) {
      const gap = document.createElement('span');
      gap.className = 'pagination-gap';
      gap.textContent = '…';
      nodes.push(gap);
    }
    nodes.push(pageButton(String(i + 1), i, { current: i === current, aria: `Page ${i + 1}` }, onPage));
    last = i;
  }
  nodes.push(pageButton('Next', current + 1, { disabled: current >= totalPages - 1, aria: 'Next page' }, onPage));
  container.append(...nodes);
}

// -- Table -----------------------------------------------------------------

function filtered() {
  const category = categorySelect.value;
  return category ? entries.filter(entry => categoryOf(entry) === category) : entries;
}

async function render() {
  const token = ++renderToken;
  const rows = filtered();
  const pageSize = Number(pageSizeSelect.value) || 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.min(Math.max(0, page), totalPages - 1);
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);

  list.setAttribute('aria-busy', 'true');
  // Who and what each row is about is read before the page paints, so a row never
  // shows a placeholder that then swaps for the real avatar.
  const built = await Promise.all(visible.map(async entry => {
    const [source, text] = await Promise.all([sourceFor(entry), describe(entry)]);
    return entryRow(entry, source, text, itemFor(entry));
  }));
  // A newer render (a filter or page change) started while this one was reading.
  if (token !== renderToken) return;

  list.replaceChildren(...built);
  list.setAttribute('aria-busy', 'false');
  empty.textContent = categorySelect.value ? 'No transactions of this type.' : 'No transactions yet.';
  empty.hidden = rows.length > 0;
  renderPagination(pagination, page, totalPages, target => {
    page = target;
    render();
  });

  // Item stills are generated once and cached by the catalog; any this page needs
  // that are not cached yet fill in and the page repaints.
  const shown = visible.map(itemFor).filter(Boolean);
  if (shown.length) {
    let repaintQueued = false;
    ensureItemPreviews([...new Set(shown)], () => {
      if (repaintQueued) return;
      repaintQueued = true;
      requestAnimationFrame(() => {
        repaintQueued = false;
        if (token === renderToken) render();
      });
    });
  }
}

async function loadHistory(user) {
  errorEl.textContent = '';
  list.setAttribute('aria-busy', 'true');
  empty.hidden = false;
  empty.textContent = 'Loading transactions...';
  try {
    // The stores only hold server-side catalog edits once loadCatalog() resolves.
    // A catalog that fails to load costs the thumbnails, not the history.
    await loadCatalog().catch(error => console.warn('[transactions] Catalog unavailable:', error));
    buildItems();
    const rows = await getTransactions(user.uid);
    entries = (rows || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    await render();
  } catch (error) {
    console.warn('[transactions] Could not load history:', error);
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    empty.hidden = true;
    errorEl.textContent = 'Could not load transactions.';
  }
}

categorySelect.replaceChildren(...CATEGORIES.map(([value, label]) => new Option(label, value)));
categorySelect.addEventListener('change', () => { page = 0; render(); });
pageSizeSelect.addEventListener('change', () => { page = 0; render(); });

// -- Session ---------------------------------------------------------------

let buxUnsub = null;

onAuthStateChanged(auth, async user => {
  if (buxUnsub) { buxUnsub(); buxUnsub = null; }
  document.querySelectorAll('[data-needs-auth]').forEach(el => { el.style.display = user ? '' : 'none'; });

  if (!user) {
    currentUser = null;
    renderAccountCluster(null, { sitePath: p => `/bloxverse${p}` });
    location.replace('/bloxverse/auth');
    return;
  }
  if (await banGuard(user.uid)) return;

  currentUser = user;
  assignUserIdNum(user.uid).catch(() => {});
  trackPresence(user.uid, null, 'transactions');

  let profile = {};
  try {
    profile = (await getDoc(doc(db, 'users', user.uid))).data() || {};
  } catch (error) {
    console.warn('[transactions] Profile unavailable:', error);
  }
  username = profile.username || user.displayName || 'Player';
  renderAccountCluster(user, {
    username,
    bux: Number(profile.bux || 0),
    userNum: profile.userIdNum,
    preview: profile.avatarPreviewHead || profile.avatarPreview || null,
    sitePath: p => `/bloxverse${p}`,
    onLogout: () => { location.replace('/bloxverse/auth'); },
  });

  // Keeps the balance pill live.
  buxUnsub = listenBux(user.uid, value => {
    const pill = document.getElementById('bux-count');
    if (pill) pill.textContent = Number(value || 0).toLocaleString();
  }, username, user.email);

  await loadHistory(user);
});