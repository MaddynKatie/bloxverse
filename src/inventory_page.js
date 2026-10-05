// Inventory page.
//
// Ported from the reference unused\uirevamp\inventory.js.
//
// Two deliberate differences, both because BloxVerse has no REST backend:
//
//   1. Ownership. The reference fetches /api/inventory/owned plus
//      /api/inventory/copies. BloxVerse stores the owned item ids as an array on
//      users/{uid}.ownedItems (see catalog.html loadOwnedItems), so that one
//      document replaces both endpoints.
//   2. The catalog. The reference pulls /api/catalog/init and filters it with
//      filterCatalog() from catalog_model.js, a module BloxVerse never ported.
//      The catalog itself is catalogStore.js, and the matching search/filter is
//      written out here so the reference's behaviour is preserved without
//      inventing a model layer.
//
// The reference's category list (accessories/hair/shirt/pant/face) does not
// match our catalog either -- our stores use Hair, Hat, Front Accessory, Back
// Accessory, Face Accessory, Shirts, Pants and Templates -- so the options are
// built from the categories actually present instead of being hardcoded.
import { auth, db } from './firebase.js';
import { doc, getDoc } from 'firebase/firestore';
  import { renderAccountCluster } from './shell.js';
import { onAuthStateChanged } from 'firebase/auth';
import { loadCatalog, getAccessoriesStore, getClothingStore, getFacesStore, getEmotesStore } from './catalogStore.js';
import { itemCard } from './catalog_view.js';
import { loadSoldCounts, withRemaining } from './catalog_stock.js';

const byId = id => document.getElementById(id);
const groups = byId('inventory-groups');
const limitedGroup = byId('inventory-limited-group');
const limitedGrid = byId('inventory-limited-products');
const regularGroup = byId('inventory-regular-group');
const regularGrid = byId('inventory-regular-products');
const categorySelect = byId('inventory-category');
const retryBtn = byId('inventory-retry');

let items = [];
let loading = false;

function buildCatalog() {
  const accs = getAccessoriesStore().map(a => ({ ...a, type: 'accessory' }));
  const clothes = getClothingStore().map(c => ({ ...c, type: 'shirt' }));
  const faces = getFacesStore().map(f => ({ ...f, type: 'face' }));
  const emotes = getEmotesStore().map(e => ({ ...e, type: 'emote' }));
  return [...accs, ...clothes, ...faces, ...emotes];
}

// The reference filter is a fixed five-option list (inventory.html:218-223):
// all / accessories / hair / shirt / pant / face, always present regardless of
// what the player owns. Ours is keyed off the store an item came from rather than
// its `category` field, because faces carry no category at all (src/faces.js) and
// would otherwise be unreachable. Clothing splits on its real category; the
// 'Templates' shirt template folds into Shirts because it is a shirt.
// Hair is the one group that is not a store: both accessories and clothing carry
// a 'Hair' category, so it is matched before the store is consulted.
function groupOf(item) {
  if (item.category === 'Hair') return 'hair';
  switch (item.type) {
    case 'accessory': return 'accessories';
    case 'face': return 'face';
    case 'emote': return 'emote';
    case 'shirt': return item.category === 'Pants' ? 'pant' : 'shirt';
    default: return 'other';
  }
}

const CATEGORY_GROUPS = [
  { label: 'Accessories', value: 'accessories' },
  { label: 'Hair', value: 'hair' },
  { label: 'Shirts', value: 'shirt' },
  { label: 'Pants', value: 'pant' },
  { label: 'Faces', value: 'face' },
];

function state() {
  return {
    category: categorySelect.value,
    q: byId('inventory-query').value.trim(),
  };
}

// Stand-in for the reference's filterCatalog(items, state). Hair is the one group
// that is not a store: both accessories and clothing carry a 'Hair' category.
function filterCatalog(catalog, { category, q }) {
  const needle = q.toLowerCase();
  return catalog.filter(item => {
    if (category !== 'all' && groupOf(item) !== category) return false;
    if (!needle) return true;
    return item.name.toLowerCase().includes(needle) || item.author.toLowerCase().includes(needle);
  });
}

// The reference list is fixed, so it is emitted unconditionally; an empty bucket
// simply yields no cards when selected.
function buildCategoryOptions() {
  categorySelect.replaceChildren(new Option('All items', 'all'));
  for (const group of CATEGORY_GROUPS) categorySelect.append(new Option(group.label, group.value));
}

function plural(n) {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

function render() {
  const visible = filterCatalog(items, state());
  const limited = visible.filter(item => item.limited);
  const regular = visible.filter(item => !item.limited);
  // withRemaining() so a Limited badge here reads the same as the one on the
  // catalog card; passed straight through, it would show the static Cloudinary
  // run size and never notice a run selling out.
  limitedGrid.replaceChildren(...limited.map(item => itemCard(withRemaining(item), { owned: true, showLimitedDetails: false })));
  regularGrid.replaceChildren(...regular.map(item => itemCard(item, { owned: true })));
  limitedGroup.hidden = !limited.length;
  regularGroup.hidden = !regular.length;
  groups.hidden = !visible.length;
  byId('inventory-limited-count').textContent = plural(limited.length);
  byId('inventory-regular-count').textContent = plural(regular.length);
  if (limited.length) window.BloxVerseMotion.reveal(limitedGrid);
  if (regular.length) window.BloxVerseMotion.reveal(regularGrid);
  byId('inventory-count').textContent = plural(visible.length);

  const empty = visible.length === 0;
  byId('inventory-state').hidden = !empty;
  retryBtn.hidden = true;
  // Only offer the catalog link for a genuinely empty inventory; if the player
  // has items but none match the filter, a "browse catalog" link is noise.
  byId('inventory-state-action').hidden = !empty || items.length > 0;
  if (empty) {
    const filtering = Boolean(state().q) || categorySelect.value !== 'all';
    byId('inventory-state-title').textContent = filtering ? 'No matching items' : 'Your inventory is empty';
    byId('inventory-state-message').textContent = filtering ? 'Try a different search or category.' : 'Items you collect will appear here.';
  }
}

function fail(error) {
  byId('inventory-count').textContent = '';
  byId('inventory-state').hidden = false;
  byId('inventory-state-title').textContent = 'Unable to load your inventory';
  byId('inventory-state-message').textContent = error.name === 'TypeError'
    ? 'Check your connection and try again.'
    : error.message;
  byId('inventory-state-action').hidden = true;
  retryBtn.hidden = false;
}

async function load() {
  if (loading) return;
  loading = true;
  byId('inventory-results').setAttribute('aria-busy', 'true');
  byId('inventory-loading').hidden = false;
  byId('inventory-state').hidden = true;
  groups.hidden = true;
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in to see your inventory.');

    // loadCatalog() merges any server-side catalog edits into the local stores,
    // so it must resolve before the stores are read.
    await loadCatalog();
    const catalog = buildCatalog();
const snapshot = await getDoc(doc(db, 'users', user.uid));
      const profile = snapshot.data() || {};
      const ownedIds = new Set(profile.ownedItems || []);

      // Same empty #navRight slot as the catalog page: the top-right cluster
      // (balance pill, profile link, account menu) only renders when a
      // controller asks for it, and the document just read has everything.
      renderAccountCluster(user, {
        username: profile.username || user.displayName,
        bux: profile.bux || 0,
        userNum: profile.userIdNum,
        preview: profile.avatarPreviewHead || profile.avatarPreview || null,
        sitePath: (p) => `/bloxverse${p}`,
        onLogout: () => { location.replace('/bloxverse/auth'); },
      });

    items = catalog.filter(item => ownedIds.has(item.id));
    await loadSoldCounts(items.filter(item => item.limited).map(item => item.id));
    buildCategoryOptions();
    render();
  } catch (error) {
    fail(error);
  } finally {
    loading = false;
    byId('inventory-loading').hidden = true;
    byId('inventory-results').setAttribute('aria-busy', 'false');
  }
}

let searchTimer;
byId('inventory-query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 150);
});
categorySelect.addEventListener('change', render);
retryBtn.addEventListener('click', load);

onAuthStateChanged(auth, user => {
  // Guard against a signed-out visitor rendering a stale grid.
  if (!user) {
    items = [];
    groups.hidden = true;
    byId('inventory-loading').hidden = true;
    byId('inventory-state').hidden = false;
    byId('inventory-state-title').textContent = 'Sign in to see your inventory';
    byId('inventory-state-message').textContent = 'Your items appear here once you sign in.';
    byId('inventory-state-action').hidden = true;
    retryBtn.hidden = true;
    return;
  }
  load();
});