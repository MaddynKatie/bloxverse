// Catalog page.
//
// Ported from the reference unused\uirevamp\catalog.js.
//
// Three deliberate differences, all because BloxVerse has no REST backend:
//
//   1. The catalog. The reference pulls /api/catalog/init and owns its filtering
//      through catalog_model.js. Ours is the four stores in catalogStore.js, with
//      catalog_model.js translating our display categories onto the reference's
//      slot types.
//   2. Ownership. The reference has /api/inventory/owned. We keep the ids on
//      users/{uid}.ownedItems (same document inventory.html reads), which is also
//      what the purchase below writes.
//   3. Purchase. The reference has no buy button on the grid page at all -- it
//      buys from the item detail route. This page renders that detail view in
//      place for ?item=, and keeps the legacy page's purchase here so the catalog
//      stays the place items are actually bought from.
import { auth, db, doc, getDoc, listenBux, banGuard, trackPresence } from './firebase.js';
import { onAuthStateChanged } from 'firebase/auth';
import { loadCatalog, getAccessoriesStore, getClothingStore, getFacesStore, getEmotesStore } from './catalogStore.js';
import { itemCard, itemImage, priceLabel } from './catalog_view.js';
import { loadSoldCounts, buyItem, buyListing, listCopy, cancelListing, bestOffer, listingsFor, serialsFor, copiesOf, copiesFailed, loadCopies, sellerPayout, isSoldOut, remaining, baselineFor, withRemaining, onSoldChange, copiesPerUser, recentAveragePrice, SoldOutError, AlreadyOwnedError } from './catalog_stock.js';
import { renderAccountCluster } from './shell.js';
import { ensureItemPreviews } from './item-preview.js';
import { filterCatalog, groupType, priceRange, stateFromParams } from './catalog_model.js';

const byId = id => document.getElementById(id);
const form = byId('catalog-filters');
const grid = byId('catalog-products');
const filterSlot = byId('catalog-filter-slot');
const itemView = byId('catalog-item');
const itemMedia = document.querySelector('.item-media');
const mediaControls = document.querySelector('.item-media-controls');
const tryOnButton = byId('item-try-on');

const motion = () => window.BloxVerseMotion;

let state = stateFromParams(new URLSearchParams(location.search));
let items = [];
let owned = new Set();
let ownedCopies = new Map();
// How many copies of this item the player holds. ownedCopies is only written for
// items with a raised ceiling; anything bought before that existed is still in
// owned as an id, so a missing count means one copy rather than none.
const heldCopies = id => Number(ownedCopies.get(id)) || (owned.has(id) ? 1 : 0);
let userBux = 0;
// The signed-in player's saved avatar, read for Try-on. Cached on first use.
let savedOutfit = null;
let currentUser = null;
let loading = false;
let ready = false;

// -- filters ---------------------------------------------------------------

function syncForm() {
  byId('catalog-query').value = state.q;
  byId('catalog-sort').value = state.sort;
  byId('catalog-author').value = state.author;
  byId('catalog-limited').checked = state.limited;
  byId('catalog-min-price').value = state.min ?? '';
  byId('catalog-max-price').value = state.max ?? '';
  form.querySelectorAll('[data-category]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.category === state.category));
  });
}

function syncUrl() {
  const params = new URLSearchParams();
  for (const key of ['category', 'sort', 'q', 'author', 'min', 'max']) {
    if (state[key] !== null && state[key] !== '') params.set(key, state[key]);
  }
  if (state.limited) params.set('limited', '1');
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function render() {
  if (!ready) return;
  const all = filterCatalog(items, state);
  // Reference deduplication: when items share a family_id (variant families),
  // only the first in the filtered list is shown as a card. Clicking it opens
  // the item detail which lists all variants. Same logic as reference render().
  const seen = new Set();
  const visible = all.filter(item => !item.family_id || (!seen.has(item.family_id) && seen.add(item.family_id)));
  grid.replaceChildren(...visible.map(item => itemCard(withRemaining(item), { owned: heldCopies(item.id) >= copiesPerUser(item) })));
  grid.hidden = !visible.length;
  byId('catalog-state').hidden = visible.length > 0;
  byId('catalog-retry').hidden = true;
  byId('catalog-result-count').textContent = `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`;
  if (visible.length) motion()?.reveal(grid);
  if (!visible.length) {
    byId('catalog-state-title').textContent = 'No items found';
    byId('catalog-state-message').textContent = 'Try a different category or clear your filters.';
  }
  if (activeItem) renderDetail(activeItem);
}

function applyFilters(category = state.category) {
  const error = byId('catalog-filter-error');
  try {
    const range = priceRange(byId('catalog-min-price').value, byId('catalog-max-price').value);
    if (!form.reportValidity()) return;
    state = {
      category,
      q: byId('catalog-query').value.trim(),
      sort: byId('catalog-sort').value,
      author: byId('catalog-author').value.trim(),
      limited: byId('catalog-limited').checked,
      ...range,
    };
    error.hidden = true;
    syncForm();
    syncUrl();
    render();
  } catch (cause) {
    error.textContent = cause.message;
    error.hidden = false;
  }
}

// -- catalog ---------------------------------------------------------------

function buildCatalog() {
  const accs = getAccessoriesStore().map(a => ({ ...a, type: 'accessory' }));
  const clothes = getClothingStore().map(c => ({ ...c, type: 'shirt' }));
  const faces = getFacesStore().map(f => ({ ...f, type: 'face' }));
  const emotes = getEmotesStore().map(e => ({ ...e, type: 'emote', category: e.category || 'Emotes' }));
  return [...accs, ...clothes, ...faces, ...emotes];
}

async function loadOwnership() {
  const user = auth.currentUser;
  currentUser = user;
  if (!user) {
    owned = new Set();
    ownedCopies = new Map();
    userBux = 0;
    renderAccountCluster(null, { sitePath: (p) => `/bloxverse${p}` });
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    const profile = snapshot.data() || {};
    owned = new Set(profile.ownedItems || []);
    ownedCopies = new Map(Object.entries(profile.ownedCopies || {}));
    userBux = Number(profile.bux || 0);
    // The top-right cluster: Bux balance pill, profile link and account menu.
    // This page ships the same empty #navRight slot the other pages do, and
    // nothing renders it unless a controller asks -- without this the corner
    // only ever held the theme toggle.
    renderAccountCluster(user, {
      username: profile.username || user.displayName,
      bux: userBux,
      userNum: profile.userIdNum,
      preview: profile.avatarPreviewHead || profile.avatarPreview || null,
      sitePath: (p) => `/bloxverse${p}`,
      onLogout: () => { location.replace('/bloxverse/auth'); },
    });
  } catch (error) {
    // Browsing must not need an account, so a failed ownership read only means
    // cards keep their prices instead of showing "Owned".
    console.warn('[catalog] Ownership unavailable:', error);
    owned = new Set();
    ownedCopies = new Map();
  }
}

function fail(error) {
  byId('catalog-state').hidden = false;
  byId('catalog-state-title').textContent = 'Unable to load the catalog';
  byId('catalog-state-message').textContent = error.name === 'TypeError'
    ? 'Check your connection and try again.'
    : error.name === 'TimeoutError'
      ? 'The request timed out. Please try again.'
      : error.message;
  byId('catalog-retry').hidden = false;
}

async function load() {
  if (loading) return;
  loading = true;
  ready = false;
  byId('catalog-results').setAttribute('aria-busy', 'true');
  byId('catalog-loading').hidden = false;
  byId('catalog-state').hidden = true;
  grid.hidden = true;
  try {
    // loadCatalog() merges any server-side catalog edits into the local stores,
    // so it must resolve before the stores are read.
    await loadCatalog();
    items = buildCatalog();
    await loadOwnership();
    // Copy counts decide the badges, the stock lines and whether a limited item
    // can still be bought, so they are fetched before the first paint rather than
    // letting every card read as a full run until the reads land.
    await loadSoldCounts(items.filter(entry => entry.limited).map(entry => entry.id));
    ready = true;
    render();
    // ?item= can only be resolved once the catalog exists, so the requested view
    // is decided here rather than at module load.
    const requestedId = new URLSearchParams(location.search).get('item');
    const requested = requestedId && items.find(entry => entry.id === requestedId);
    if (requested) showItem(requested);
    // Previews render once per item and are cached locally, so a catalog whose
    // items were never opened still fills in instead of showing glyphs. The
    // callbacks arrive one per item, so repaint at most once per frame.
    let repaintQueued = false;
    ensureItemPreviews(items, () => {
      if (repaintQueued) return;
      repaintQueued = true;
      requestAnimationFrame(() => {
        repaintQueued = false;
        render();
        // render() repaints the card grid only. The detail tile is a live 3D
        // viewer, so the cached stills must never be mounted over it -- doing so
        // replaced the spinning item with a flat image as soon as the last card
        // finished warming up.
      });
    });
  } catch (error) {
    fail(error);
  } finally {
    loading = false;
    byId('catalog-loading').hidden = true;
    byId('catalog-results').setAttribute('aria-busy', 'false');
  }
}

// -- item detail -----------------------------------------------------------

let activeItem = null;
let viewer = null;

function typeLabel(item) {
  if (item.type === 'emote') return 'Emote';
  if (item.type === 'face') return 'Face';
  return item.category || item.type;
}

// Creator display name. The server catalog already defaults the Cloudinary
// `author` context key to BloxVerse, but local seeds and hand-written store
// entries can still omit it, and an empty creator line reads as a bug.
const DEFAULT_AUTHOR = 'BloxVerse';

function authorName(item) {
  return (item.author || '').trim() || DEFAULT_AUTHOR;
}

// Author -> profile link.
//
// The reference links the creator name into that player's profile. Its route is
// keyed on a numeric user id, but `usernames` is a public collection keyed on the
// lowercased username holding { uid }, and profile.html's resolveProfileUser
// accepts a raw UID as well as a number -- so one lookup by name is enough and no
// numeric id is needed.
//
// The default author is the site itself, and the site is not a player with a
// `usernames` entry, so the lookup alone would leave the default attribution as
// dead plain text. SITE_OWNER is that account: the name it is published under and
// the UID its profile resolves to. Both are checked against `usernames` first, so
// repointing the site owner is a one-line change here.
const SITE_OWNER = { username: 'BloxVerse', uid: '18' };

// Not every author is a player though: the field is free-text Cloudinary
// metadata, so a shop or a pasted URL is possible too. An absolute URL is linked
// as-is; anything else unresolvable is left as plain text rather than pointed at
// a profile that does not exist.
const authorUidCache = new Map();

async function resolveAuthorUid(name) {
  if (authorUidCache.has(name)) return authorUidCache.get(name);
  const pending = (async () => {
    if (name.toLowerCase() === SITE_OWNER.username.toLowerCase()) return SITE_OWNER.uid;
    try {
      const snapshot = await getDoc(doc(db, 'usernames', name.toLowerCase()));
      return snapshot.exists() ? snapshot.data().uid || null : null;
    } catch (error) {
      console.warn('[catalog] Author lookup failed:', error);
      return null;
    }
  })();
  authorUidCache.set(name, pending);
  return pending;
}

function setAuthor(name) {
  const wrap = byId('item-author');
  wrap.replaceChildren();
  wrap.hidden = false;
  // "By <author>". The label is its own text node so the attribution still reads
  // correctly when the name resolves to a link, to an external URL, or to plain
  // text because there is no such player.
  wrap.append(document.createTextNode('By '));
  const link = document.createElement('a');
  link.textContent = name;
  wrap.append(link);
  if (/^https?:\/\//i.test(name)) {
    link.href = name;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    return;
  }
  // The default attribution is the site, which is displayed as "BloxVerse" but
  // links to the owner's player profile -- the label is the brand, the target is
  // the account. Anything else goes through the username lookup.
  const lookupName = name === DEFAULT_AUTHOR ? SITE_OWNER.username : name;
  resolveAuthorUid(lookupName).then(uid => {
    // A different item may already be on screen by the time this resolves.
    if (link.textContent !== name) return;
    if (uid) {
      link.href = `/bloxverse/profile?user=${encodeURIComponent(uid)}`;
      return;
    }
    // No such player: keep the name readable but drop the dead href.
    link.replaceWith(document.createTextNode(name));
  });
}

function detailStatus(message) {
  const status = byId('item-status');
  status.textContent = message || '';
  status.hidden = false;
}

function detailError(message) {
  const error = byId('item-detail-error');
  error.textContent = message;
  error.hidden = !message;
}

// Reference syncGet (unused\uirevamp\item.js:160). The reference reaches Owned from
// the API's `my_serials` and compares its length against copies_per_user; here the
// same comparison runs against ownedCopies, with the run being empty as the one new
// state we had to add.
function syncBuyButton(item) {
  const buy = byId('item-get');
  buy.dataset.id = item.id;
  buy.dataset.price = item.price;
  const soldOut = isSoldOut(item);
  const mine = heldCopies(item.id) >= copiesPerUser(item);
  // A cheaper listed copy is the way to get this item, so the button offers that
  // instead of the run. Reference syncGet (item.js:335) branches the same way.
  const offer = currentOffer(item);
  const viaListing = !!(offer && offer.resale);
  buy.dataset.serial = viaListing ? String(offer.serial) : '';
  buy.textContent = item.off_sale
    ? 'Off Sale'
    : mine
      ? 'Owned'
      : viaListing
        ? 'Buy Resale'
        : soldOut
          ? 'Sold Out'
          : item.price > 0 ? 'Buy' : 'Get';
  // Off sale still wins over a listing: the reference disables the panel rather than
  // letting the marketplace route around it.
  buy.disabled = !!(item.off_sale || mine || (!viaListing && soldOut));
}

// The reference offers "Try On" for anything that can be worn and toggles it to
// "Take Off". Faces and clothing go through their own viewer methods; every
// accessory slot, hair included, is an accessory mesh. Emotes are animations,
// so there is nothing to put on and the control stays hidden.
function tryOnMethod(item) {
  const slot = groupType(item);
  if (slot === 'shirt' || slot === 'pant' || slot === 'face') return slot === 'face' ? 'applyFace' : `apply${slot === 'shirt' ? 'Shirt' : 'Pant'}`;
  if (slot === 'emote') return null;
  if (item.type === 'accessory') return 'equipAccessory';
  return null;
}

// Same contract as the reference: label and aria-pressed both follow state, and
// the button is disabled while the viewer is busy so a double click cannot
// start two loads.
function syncTryOnButton(on, disabled = false) {
  tryOnButton.textContent = on ? 'Take Off' : 'Try On';
  tryOnButton.setAttribute('aria-pressed', String(on));
  tryOnButton.disabled = disabled;
}

// Try-on shows the item on the player's own avatar, the way the reference does:
// their saved outfit is loaded whole, and the tried-on item replaces whatever
// occupies its slot rather than being layered over it. Anything the reference
// would drop is dropped here too, so a second hat does not appear.
async function loadSavedOutfit() {
  if (savedOutfit) return savedOutfit;
  const account = currentUser || auth.currentUser;
  if (!account) return null;
  const snapshot = await getDoc(doc(db, 'users', account.uid));
  const data = snapshot.data() || {};
  const owns = id => !id || owned.has(id);
  savedOutfit = {
    avatarColors: data.avatarColors || null,
    avatarBodyType: (data.avatarBodyType || data.bodyType) === 'female' ? 'female' : 'male',
    avatarClothing: owns(data.avatarClothing) ? data.avatarClothing : null,
    avatarPants: owns(data.avatarPants) ? data.avatarPants : null,
    avatarFace: owns(data.avatarFace) ? data.avatarFace : 'smile',
    avatarAccessories: Array.isArray(data.avatarAccessories) ? data.avatarAccessories : [],
  };
  return savedOutfit;
}

function withItem(outfit, item) {
  const next = { ...outfit, avatarAccessories: [...(outfit.avatarAccessories || [])] };
  const slot = groupType(item);
  if (slot === 'shirt') next.avatarClothing = item.id;
  else if (slot === 'pant') next.avatarPants = item.id;
  else if (slot === 'face') next.avatarFace = item.id;
  else if (item.type === 'accessory') {
    // Same slot as the reference: an accessory replaces the worn accessory of
    // its own category, so trying on a hat does not leave the old hat on.
    const sameKind = id => accessoryKindOf(id) === accessoryKindOf(item.id);
    next.avatarAccessories = next.avatarAccessories.filter(id => !sameKind(id));
    next.avatarAccessories.push(item.id);
  }
  return next;
}

// Two accessories occupy the same slot when they share a category, so the
// reference can drop the one being replaced without an id->type table.
function accessoryKindOf(id) {
  const entry = items.find(i => i.id === id);
  if (!entry) return null;
  return entry.category || entry.type || null;
}

// The one canvas for the detail tile, shared by item-only and Try On so toggling
// does not tear down the WebGL context and rebuild it.
async function ensureViewer(item, label) {
  const { createViewer } = await import('./avatar-viewer.js');
  if (!viewer) {
    const canvas = document.createElement('canvas');
    canvas.className = 'item-preview';
    canvas.setAttribute('aria-label', label);
    itemMedia.replaceChildren(canvas, mediaControls);
    viewer = await createViewer(canvas, { width: 420, height: 420, interactive: true });
  }
  return viewer;
}

// An emote is a JSON animation with no mesh, so it has nothing to spin.
const isMeshItem = item => !!(item.meshPath || item.modelUrl
  || (item.fileUrl && /\.(glb|gltf|fbx)$/i.test(item.fileUrl)));

// The reference detail tile is a live 3D view, not a picture (item.js:73-101): a
// wearable is shown on its own and left spinning, and Try On is the mode that
// brings the character back. A flat image was the old behaviour and left the item
// looking like a thumbnail of a character wearing a hat.
async function showItemOnly(item) {
  const slot = groupType(item);
  if (slot === 'emote' || (!isMeshItem(item) && slot !== 'face')) {
    showFlatPreview(item);
    return;
  }
  syncTryOnButton(false, true);
  const v = await ensureViewer(item, `3D view of ${item.name}`);
  if (!v) {
    showFlatPreview(item);
    return;
  }
  try {
    if (slot === 'face') {
      // A face is a texture on the head, so it needs the character to read on.
      await v.showFace(item.id);
    } else if (isMeshItem(item)) {
      await v.showAccessoryOnly(item.id);
    } else {
      // Shirts and pants are textures too: the body stays, wearing just this one.
      await v.showAvatar();
      if (slot === 'shirt') await v.applyShirt(item.id);
      else await v.applyPant(item.id);
    }
    mediaControls.hidden = false;
    syncTryOnButton(false);
  } catch (error) {
    console.warn('[catalog] Item preview unavailable:', error);
    showFlatPreview(item);
  }
}

function showFlatPreview(item) {
  viewer?.dispose();
  viewer = null;
  // detail=true: inside .item-media the reference letterboxes the item's own
  // image to a fixed size instead of clipping it like a card thumbnail.
  itemMedia.replaceChildren(itemImage(item, true), mediaControls);
  mediaControls.hidden = tryOnMethod(item) === null;
  syncTryOnButton(false);
}

async function showTryOn(item) {
  if (!tryOnMethod(item)) return;
  syncTryOnButton(false, true);
  const v = await ensureViewer(item, `${item.name} on the avatar`);
  if (!v) {
    showFlatPreview(item);
    return;
  }
  // The reference shows the item on the player's own avatar: their saved outfit
  // with this item swapped into its slot, not a bare retail body.
  try {
    const base = await loadSavedOutfit();
    // Item-only mode leaves the body hidden and the camera framed on the item.
    // showAvatar() brings both back; loadOutfit() would not, because the viewer
    // only frames the character the first time it loads one.
    v.showAvatar();
    await viewer.loadOutfit(base ? withItem(base, item) : { avatarBodyType: 'male' });
    mediaControls.hidden = false;
    syncTryOnButton(true);
  } catch (error) {
    console.warn('[catalog] Try-on unavailable:', error);
    showFlatPreview(item);
    detailStatus('The 3D preview could not be loaded. Please try again.');
  }
}

function renderDetail(item) {
  byId('item-detail-name').textContent = item.name;
  setAuthor(authorName(item));
  // Reference showPrices (item.js:152): a limited run relabels the row to
  // "Original Price" and keeps showing the real price even when the item is off
  // sale, because the label is describing the run rather than this purchase.
  byId('item-price-label').textContent = item.limited ? 'Original Price' : 'Price';
  const label = priceLabel({ ...item, off_sale: item.limited ? false : item.off_sale });
  byId('item-price').replaceChildren(label);
  byId('item-detail-description').textContent = item.description || '';

  // Facts row (matches exampleitempage.html)
  const created = item.created || item.createdAt || item.created_at || item.dateCreated;
  // Type is always populated, so the row is never empty; it starts hidden in the
// markup and is revealed here once the item is known.
byId('item-facts').hidden = false;
  byId('item-type').textContent = typeLabel(item);
  byId('item-created').textContent = created
    ? new Date(created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '-';
  // RAP is the server's running average of resale prices, kept in Firestore rather
  // than the Cloudinary context, because it only means something once a copy has
  // been resold. Until then the fact stays hidden, as on Roblox.
  // A context value still wins so a run can be given a starting figure.
  // The server's figure wins once a copy has been resold; a context value is only
  // the starting figure before that.
  const rap = recentAveragePrice(item) ?? item.recentAveragePrice;
  const sales = item.sales ?? item.totalSales ?? item.sold;
  showRap(rap);
  byId('item-sales-fact').hidden = sales === undefined || sales === null || sales === '';
  if (!byId('item-sales-fact').hidden) byId('item-sales').textContent = sales;

  // Reference showLimited (item.js:176). The run is read as sold-of-total with a
  // progress bar, and the remaining line flips to "Sold out" once the last copy
  // goes, which is what the bar's aria-valuenow mirrors.
  const stats = byId('item-sale-stats');
  const badgeTag = byId('item-limited-badge');
  if (item.limited) {
    const soldOut = isSoldOut(item);
    // The run size has to come from the ledger's own resolver, not from
    // total_stock directly. Cloudinary only sends total_stock when it was set on
    // the asset, and reading it raw meant total = 0 for every item that did not
    // declare it -- which pinned the bar at 100% and never let it move.
    const total = baselineFor(item);
    const sized = Number.isFinite(total) && total > 0;
    const left = remaining(item);
    const sold = sized && Number.isFinite(left) ? Math.max(0, total - left) : 0;
    const percent = sized ? Math.round((sold / total) * 100) : 0;
    const progress = stats.querySelector('[role="progressbar"]');
    badgeTag.hidden = false;
    badgeTag.classList.toggle('is-sold-out', soldOut);
    // The reference badge keeps the space inside its text node (item.js:194), which
    // is what spaces the label off the bolt glyph.
    const bolt = document.createElement('i');
    bolt.className = 'fa-solid fa-bolt';
    bolt.setAttribute('aria-hidden', 'true');
    badgeTag.replaceChildren(bolt, document.createTextNode(soldOut ? ' Sold out' : ' Limited'));
    badgeTag.setAttribute('aria-label', soldOut ? 'Limited, sold out' : 'Limited');
    stats.hidden = false;
    byId('item-sales-fact').hidden = false;
    byId('item-sales').textContent = `${sold.toLocaleString()} sold`;
    byId('item-limited-stock').textContent = soldOut ? 'Sold out' : `${left.toLocaleString()} remaining`;
    byId('item-limited-sold').textContent = sized
      ? `${sold.toLocaleString()} of ${total.toLocaleString()} sold`
      : `${sold.toLocaleString()} sold`;
    // An item marked limited but given no run size has no progress to show, so
    // the bar is hidden rather than parked at a meaningless 0%.
    progress.hidden = !sized;
    progress.setAttribute('aria-valuenow', String(Math.min(100, Math.max(0, percent))));
    byId('item-limited-progress-fill').style.width = `${Math.min(100, Math.max(0, percent))}%`;
  } else {
    stats.hidden = true;
    badgeTag.hidden = true;
  }

  // "You own n of m" applies to every item, not only limited ones, since
  // copies_per_user can raise the ceiling on an ordinary item too. Only worth
  // saying once the ceiling is above one; at one, the Owned button already says it.
  const mineCopies = heldCopies(item.id);
  const maxCopies = copiesPerUser(item);
  const ownedLine = byId('item-owned-copies');
  ownedLine.hidden = !mineCopies || maxCopies <= 1;
  byId('item-owned-copies-value').textContent = ownedLine.hidden ? '' : `${mineCopies} of ${maxCopies}`;

  syncBuyButton(item);
}

function showItem(item) {
  activeItem = item;
  itemView.hidden = false;
  document.querySelector('.catalog-heading').hidden = true;
  byId('catalog-browser').hidden = true;
  renderDetail(item);
  detailError('');
  detailStatus('');
  showResale(item);
  showItemOnly(item).catch(error => {
    console.warn('[catalog] Item preview unavailable:', error);
    showFlatPreview(item);
  });
}

/* -- marketplace ---------------------------------------------------------- */

/** The price this item can actually be had at, and whether that is a listed copy. */
function currentOffer(item) {
  return bestOffer(item, auth.currentUser?.uid || '');
}

/**
 * Best Price row. Reference showPrices (item.js:155): hidden unless the item can be
 * obtained at all, and it only carries a resale price when a listing undercuts the
 * run -- otherwise it just repeats the price row, so it stays hidden.
 */
/** Show the RAP fact, or hide it while there is no figure yet. */
function showRap(rap) {
  const fact = byId('item-rap-fact');
  fact.hidden = rap === undefined || rap === null || rap === '' || !(Number(rap) > 0);
  if (!fact.hidden) byId('item-rap').textContent = `${Number(rap).toLocaleString()} Bux`;
}

function showBestPrice(item) {
  const row = byId('item-best-row');
  const offer = currentOffer(item);
  const worthShowing = !!offer && (offer.resale || Number(item.price) <= 0);
  row.hidden = !worthShowing;
  if (worthShowing) {
    byId('item-best-price').replaceChildren(priceLabel({ price: offer.price }));
  }
}

function payoutNote() {
  const price = Number(byId('item-resale-price').value);
  const note = byId('item-resale-payout');
  if (!Number.isInteger(price) || price < 1) {
    note.textContent = 'You receive 80% of the sale price. BloxVerse keeps a 20% marketplace fee.';
    return;
  }
  const payout = sellerPayout(price);
  note.textContent = `Listed at ${price.toLocaleString()} Bux. You receive ${payout.toLocaleString()} Bux (80%) after the ${(price - payout).toLocaleString()} Bux marketplace fee (20%).`;
}

// Seller head shots for the listing rows, keyed by uid. A listing only carries the
// seller's uid and name, so the picture is read from their profile. A profile that
// cannot be read just leaves the row without an avatar.
const sellerAvatars = new Map();
const sellerAvatarLookups = new Map();

function loadSellerAvatars(uids) {
  return Promise.all([...new Set(uids)].filter(Boolean).map(uid => {
    if (sellerAvatars.has(uid)) return null;
    if (!sellerAvatarLookups.has(uid)) {
      sellerAvatarLookups.set(uid, getDoc(doc(db, 'users', uid)).then(snapshot => {
        const data = snapshot.data() || {};
        const url = data.avatarPreviewHead || data.avatarPreview || '';
        if (url) sellerAvatars.set(uid, url);
      }).catch(() => {}).finally(() => sellerAvatarLookups.delete(uid)));
    }
    return sellerAvatarLookups.get(uid);
  }));
}

/** One listing row: who is selling, which serial, and what for. */
function listingRow(listing, uid) {
  const row = document.createElement('div');
  row.className = 'ui-card item-listing';

  const seller = document.createElement('div');
  seller.className = 'item-listing-seller';
  const avatarUrl = sellerAvatars.get(listing.owner);
  if (avatarUrl) {
    const avatar = document.createElement('img');
    avatar.className = 'item-listing-avatar';
    avatar.src = avatarUrl;
    avatar.alt = '';
    avatar.width = 48;
    avatar.height = 48;
    avatar.draggable = false;
    seller.append(avatar);
  } else {
    seller.classList.add('has-no-avatar');
  }
  const copy = document.createElement('div');
  copy.className = 'item-listing-copy';
  const name = document.createElement('strong');
  name.textContent = listing.ownerName || 'Unknown';
  const serial = document.createElement('span');
  serial.textContent = `Serial #${Number(listing.serial).toLocaleString()}`;
  copy.append(name, serial);
  seller.append(copy);

  const price = document.createElement('div');
  price.className = 'item-listing-price';
  price.append(priceLabel({ price: listing.listedPrice }));

  row.append(seller, price);
  if (listing.owner === uid) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-secondary btn-sm';
    cancel.dataset.cancelSerial = String(listing.serial);
    cancel.textContent = 'Cancel';
    row.append(cancel);
  } else {
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'btn-primary btn-sm';
    buy.dataset.buySerial = String(listing.serial);
    buy.textContent = 'Buy';
    row.append(buy);
  }
  return row;
}

/**
 * The marketplace panel. Reference showResale (item.js:245): shown for limited items
 * only, since an unlimited item has no scarcity worth trading on.
 *
 * Reads the copy ledger for this item rather than the whole catalog, so browsing
 * stays one document per limited item.
 */
async function showResale(item) {
  const section = byId('item-resale');
  const uid = auth.currentUser?.uid || '';
  if (!item?.limited) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  byId('item-resale-status').textContent = '';

  await loadCopies(item.id);
  // The copy read is a round trip, so the viewer may have moved on. Painting now
  // would put this item's marketplace on another item's page.
  if (activeItem !== item) return;
  if (copiesFailed(item.id)) {
    byId('item-resale-status').textContent = 'Could not load this item\'s copies, so listings and the Sell button are unavailable. Check the console for the Firestore error.';
  }

  const mine = serialsFor(item, uid);
  const listings = listingsFor(item, uid);
  // The viewer's own listings are excluded from listingsFor, so they are added back
  // for the panel: they have to be visible in order to be cancelled.
  const ownListings = copiesOf(item.id).filter(copy => copy.owner === uid && copy.listedPrice > 0);
  const rows = [...ownListings, ...listings].sort((a, b) => a.listedPrice - b.listedPrice);
  await loadSellerAvatars(rows.map(copy => copy.owner));
  // Another round trip, so the viewer may have moved on again.
  if (activeItem !== item) return;

  byId('item-listings').replaceChildren(...rows.map(copy => listingRow(copy, uid)));
  byId('item-listings-empty').hidden = rows.length > 0;

  // Copies a player could sell: theirs, not already listed, and past any hold.
  const sellable = mine.filter(copy => !copy.listedPrice && (!copy.relistAfter || copy.relistAfter <= Date.now()));
  const open = byId('item-resale-open');
  open.hidden = !sellable.length;

  const select = byId('item-resale-copy');
  select.replaceChildren(...sellable.map(copy => {
    const option = document.createElement('option');
    option.value = String(copy.serial);
    option.textContent = `Copy #${Number(copy.serial).toLocaleString()}`;
    return option;
  }));

  // Say why there is nothing to sell rather than leaving the button simply absent.
  const hold = byId('item-resale-hold');
  const held = mine.filter(copy => !copy.listedPrice && copy.relistAfter > Date.now());
  hold.hidden = !held.length;
  hold.textContent = held.length
    ? 'A copy you bought has to stay with you for a while before you can list it again.'
    : '';

  showBestPrice(item);
}

function openResaleDialog() {
  payoutNote();
  window.openDialog(byId('item-resale-dialog'), {
    initialFocus: byId('item-resale-price'),
    isBusy: () => byId('item-resale-form').dataset.busy === 'true',
    // openDialog removes the <dialog> from the DOM when it closes by default, which
    // is right for throwaway dialogs but not for this one: it lives in the page
    // markup and has to be openable again.
    removeOnClose: false,
  });
}

async function listCopyFromForm(event) {
  event.preventDefault();
  const item = activeItem;
  const user = auth.currentUser;
  if (!item || !user) return;
  const form = byId('item-resale-form');
  const error = byId('item-resale-error');
  error.hidden = true;
  form.dataset.busy = 'true';

  const serial = Number(byId('item-resale-copy').value);
  const price = Number(byId('item-resale-price').value);
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await listCopy(item, user.uid, serial, price);
    window.closeDialog(byId('item-resale-dialog'));
    byId('item-resale-status').textContent = `Copy #${serial.toLocaleString()} listed for ${price.toLocaleString()} Bux. You receive ${sellerPayout(price).toLocaleString()} Bux when it sells.`;
    form.reset();
    await showResale(item);
    syncBuyButton(item);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  } finally {
    form.dataset.busy = 'false';
    submit.disabled = false;
  }
}

/** Buy somebody else's listed copy, after confirming what it costs. */
function confirmBuyListing(listing) {
  const item = activeItem;
  if (!item) return;
  window.confirmAction({
    title: `Buy copy #${listing.serial}?`,
    description: `This will cost ${Number(listing.listedPrice).toLocaleString()} Bux. Resold copies are held for 7 days before they can be listed again.`,
    confirmLabel: 'Buy copy',
    pendingLabel: 'Buying',
    onConfirm: async () => {
      try {
        const result = await buyListing(item, auth.currentUser.uid, listing.serial);
        owned.add(item.id);
        ownedCopies.set(item.id, result.held);
        userBux -= result.paid;
        // The sale just moved RAP on the server, so show its new figure now.
        showRap(recentAveragePrice(item) ?? item.recentAveragePrice);
        detailError('');
        byId('item-resale-status').textContent = `You bought copy #${Number(listing.serial).toLocaleString()}.`;
      } catch (error) {
        // Repaint before rethrowing: the listing may be the thing that went away, and
        // confirmAction renders the message itself, so it has to propagate.
        await loadCopies(item.id, { force: true });
        await showResale(item);
        syncBuyButton(item);
        throw error;
      }
      await loadCopies(item.id, { force: true });
      await showResale(item);
      syncBuyButton(item);
      render();
    },
  });
}

function resaleAction(event) {
  const item = activeItem;
  const user = auth.currentUser;
  if (!item || !user) return;
  const buy = event.target.closest('[data-buy-serial]');
  const cancel = event.target.closest('[data-cancel-serial]');
  if (buy) {
    const serial = Number(buy.dataset.buySerial);
    const listing = copiesOf(item.id).find(copy => copy.serial === serial);
    if (listing) confirmBuyListing(listing);
    return;
  }
  if (cancel) {
    event.target.disabled = true;
    cancelListing(item, user.uid, Number(cancel.dataset.cancelSerial))
      .then(async () => {
        byId('item-resale-status').textContent = 'Listing cancelled.';
        await showResale(item);
        syncBuyButton(item);
      })
      .catch((error) => {
        byId('item-resale-status').textContent = error.message;
        event.target.disabled = false;
      });
  }
}

function showBrowser() {
  activeItem = null;
  itemView.hidden = true;
  byId('item-resale').hidden = true;
  document.querySelector('.catalog-heading').hidden = false;
  byId('catalog-browser').hidden = false;
}

async function purchase(item) {
  const user = auth.currentUser;
  if (!user) {
    window.location.href = '/bloxverse/auth';
    return;
  }
  if (heldCopies(item.id) >= copiesPerUser(item)) return;
  if (item.off_sale) {
    detailError('This item is off sale and cannot be bought right now.');
    return;
  }
  if (isSoldOut(item)) {
    detailError('This item is sold out.');
    syncBuyButton(item);
    return;
  }
  if (await banGuard(user.uid)) return;

  const buy = byId('item-get');
  const price = Number(buy.dataset.price);
  if (price > 0 && userBux < price) {
    detailError(`You need ${price.toLocaleString()} Bux to buy this item.`);
    return;
  }

  buy.disabled = true;
  motion()?.setPending(buy, true, price > 0 ? 'Buying' : 'Collecting');
  detailStatus(price > 0 ? 'Buying…' : 'Collecting…');
  try {
    // One transaction on the server takes the copy out of the run and grants it to
    // the player, so the run cannot oversell and the grant cannot survive a failed
    // decrement. It also prices the item itself and re-checks the copy ceiling, so a
    // modified client cannot buy it for less or quietly over-own it.
    const nowHeld = await buyItem(item, user.uid);
    owned.add(item.id);
    ownedCopies.set(item.id, nowHeld);
    if (price > 0) {
      // No logTransaction here: the server settles the purchase and writes the
      // history line, so logging from the client too would double-count it.
      userBux -= price;
    }
    detailError('');
    detailStatus(nowHeld > 1
      ? `Copy ${nowHeld} of ${copiesPerUser(item)} added to your inventory.`
      : 'Added to your inventory.');
  } catch (error) {
    if (error instanceof SoldOutError) {
      detailError('This item just sold out.');
      detailStatus('');
    } else if (error instanceof AlreadyOwnedError) {
      detailError('You already own every copy of this item you are allowed.');
      detailStatus('');
    } else {
      detailError(`Purchase failed: ${error.message}`);
      detailStatus('');
    }
  } finally {
    motion()?.setPending(buy, false);
    syncBuyButton(item);
    render();
    // buyItem dropped this tab's copy list because a new copy was just issued, so
    // the marketplace panel is stale until it is read again. Without this the Sell
    // button only appeared after reloading the page.
    if (item.limited) {
      await loadCopies(item.id, { force: true });
      await showResale(item).catch(() => {});
      syncBuyButton(item);
    }
  }
}

// -- wiring ----------------------------------------------------------------

form.addEventListener('submit', event => {
  event.preventDefault();
  applyFilters();
});
form.querySelectorAll('[data-category]').forEach(button => {
  button.addEventListener('click', () => applyFilters(button.dataset.category));
});
byId('catalog-sort').addEventListener('change', () => applyFilters());
byId('catalog-limited').addEventListener('change', () => applyFilters());
let searchTimer;
byId('catalog-query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applyFilters(), 150);
});
byId('catalog-clear').addEventListener('click', () => {
  state = stateFromParams(new URLSearchParams('category=all'));
  byId('catalog-filter-error').hidden = true;
  syncForm();
  syncUrl();
  render();
});
byId('catalog-retry').addEventListener('click', load);

// Marketplace wiring. The dialog is opened through the shared openDialog helper so
// it gets focus trapping and the closing animation like every other dialog.
byId('item-resale-open').addEventListener('click', openResaleDialog);
byId('item-resale-close').addEventListener('click', () => window.closeDialog(byId('item-resale-dialog')));
byId('item-resale-cancel').addEventListener('click', () => window.closeDialog(byId('item-resale-dialog')));
byId('item-resale-price').addEventListener('input', payoutNote);
byId('item-resale-form').addEventListener('submit', listCopyFromForm);
byId('item-listings').addEventListener('click', resaleAction);

// A sale moves the ledger, so the badges, the stock lines and the detail button
// are repainted from the new count instead of waiting for a reload.
onSoldChange(() => {
  if (ready) render();
});

byId('item-get').addEventListener('click', () => {
  const item = activeItem;
  if (!item) return;
  // A listing that undercuts the run is bought through the marketplace, confirmed
  // first, because it is somebody else's copy at their price.
  const serial = Number(byId('item-get').dataset.serial);
  if (serial) {
    const listing = copiesOf(item.id).find(copy => copy.serial === serial);
    if (listing) {
      confirmBuyListing(listing);
      return;
    }
  }
  purchase(item);
});
// Try on is the only media control: it swaps the item on its own for the item
// worn, and toggles back off again. Every wearable has it; emotes do not.
byId('item-try-on').addEventListener('click', () => {
  const item = activeItem;
  if (!item) return;
  if (tryOnButton.getAttribute('aria-pressed') === 'true') {
    showItemOnly(item).catch(error => {
      console.warn('[catalog] Item preview unavailable:', error);
      showFlatPreview(item);
    });
    return;
  }
  showTryOn(item).catch(error => {
    console.warn('[catalog] Try-on unavailable:', error);
    showFlatPreview(item);
    detailError('This item could not be shown on the avatar.');
  });
});

// Mobile: the rail becomes a drawer holding the same <form>.
const filterToggle = byId('catalog-filter-toggle');
const compactFilters = matchMedia('(max-width: 800px)');
let filterDialog;

function syncFilters() {
  const mobile = compactFilters.matches;
  filterToggle.hidden = !mobile;
  form.inert = mobile && !filterDialog;
  filterToggle.setAttribute('aria-expanded', String(Boolean(filterDialog)));
}

function closeFilterDrawer() {
  if (!filterDialog) return;
  const drawer = filterDialog;
  filterDialog = null;
  filterSlot.append(form);
  syncFilters();
  window.closeDialog?.(drawer);
}

function openFilterDrawer() {
  if (!compactFilters.matches) return;
  if (filterDialog) {
    closeFilterDrawer();
    return;
  }
  const drawer = document.createElement('dialog');
  drawer.className = 'ui-drawer';
  drawer.setAttribute('aria-labelledby', 'catalog-filter-title');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-ghost btn-icon';
  close.setAttribute('aria-label', 'Close filters');
  close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  drawer.append(Object.assign(document.createElement('div'), {
    className: 'ui-dialog-header',
    innerHTML: '<h2 id="catalog-filter-title">Filters</h2>',
  }), close, form);
  filterDialog = drawer;
  syncFilters();
  close.addEventListener('click', () => closeFilterDrawer());
  window.openDialog?.(drawer, { initialFocus: close });
}
filterToggle.addEventListener('click', openFilterDrawer);
compactFilters.addEventListener('change', () => {
  closeFilterDrawer();
  syncFilters();
});
syncFilters();

window.addEventListener('popstate', () => {
  state = stateFromParams(new URLSearchParams(location.search));
  syncForm();
  render();
});

// Start on the requested view.
syncForm();
showBrowser();
load();

onAuthStateChanged(auth, async user => {
  if (user) {
    trackPresence(user.uid, null, 'catalog');
    listenBux(user.uid, value => {
      userBux = value;
      // Keep the balance pill in the top-right live: buying here decrements the
      // same field the pill shows.
      const pill = document.getElementById('bux-count');
      if (pill) pill.textContent = Number(value || 0).toLocaleString();
      if (activeItem) syncBuyButton(activeItem);
    });
  } else {
    userBux = 0;
  }
  // Ownership is per-account, so a sign-in or sign-out re-reads it and repaints
  // the cards from "Owned" back to prices.
  await loadOwnership();
  render();
});