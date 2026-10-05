// Avatar editor.
//
// Ported from the Vortex reference unused\uirevamp\avatar.js. The reference is a
// server-rendered page talking to /api/catalog/init, /api/inventory/owned and
// PUT /api/clothing/outfit. BloxVerse has none of those endpoints, so the same
// flow runs against the user doc and the local catalog store:
//
//   item list     -> src/catalogStore.js (server catalog, local fallback)
//   owned items   -> users/{uid}.ownedItems
//   save          -> the same avatar* fields the previous editor wrote
//   save previews -> viewer.snapshotBody()/snapshotHead() -> Cloudinary
//
// The Firestore field names are unchanged, so existing avatars keep their
// clothing, colors, face and accessories. Body type is now persisted too: the
// previous editor let you switch Male/Female but never wrote it, so the choice
// was silently lost on reload.

import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, getDoc, doc, setDoc, trackPresence, banGuard, assignUserIdNum } from './firebase.js';
import { createViewer } from './avatar-viewer.js';
import { loadCatalog, getAccessoriesStore, getClothingStore, getFacesStore, findAccessoryStore } from './catalogStore.js';
import { itemImage } from './catalog_view.js';
import { publishCatalogThumbnail } from './catalog-thumbnails.js';
import { renderAccountCluster } from './shell.js';

const byId = (id) => document.getElementById(id);
const controls = byId('avatar-controls');
const status = byId('avatar-status');
const saveBtn = byId('save');
const resetBtn = byId('avatar-reset');
const motion = () => window.BloxVerseMotion;

const STARTING_ITEMS = ['palhair', 'smile', 'blueandblackmotorcycleshirt'];

const accessoryLabels = {
  hat: 'Hats', hair: 'Hair', face_accessory: 'Face Accessories',
  neck_accessory: 'Neck Accessories', shoulder_accessory: 'Shoulder Accessories',
  front_accessory: 'Front Accessories', back_accessory: 'Back Accessories',
  waist_accessory: 'Waist Accessories',
};
const sections = { shirt: 'Shirts', pant: 'Pants', face: 'Faces', ...accessoryLabels };
const typeOrder = Object.keys(sections);

// Our catalogs group accessories by display category; the reference groups them
// by slot so only one of a kind can be worn at a time.
const accessoryType = {
  'Hair': 'hair',
  'Hat': 'hat',
  'Face Accessory': 'face_accessory',
  'Front Accessory': 'front_accessory',
  'Back Accessory': 'back_accessory',
  'Neck Accessory': 'neck_accessory',
  'Shoulder Accessory': 'shoulder_accessory',
  'Waist Accessory': 'waist_accessory',
};

// Body colors live in a named map in Firestore but the swatches and the viewer
// both work in the reference's six-slot array order.
const slotNames = ['Head', 'Torso', 'L Arm', 'R Arm', 'L Leg', 'R Leg'];
const slotDefaults = ['#ffffff', '#8350fb', '#ffffff', '#ffffff', '#400eb4', '#400eb4'];

// Both body types use the same silhouette here, so these paths are set once
// instead of being re-applied on every body-type change.
const bodyColorPaths = [
  'M31.92 9.61c0-4.09 4.49-5.34 8.1-5.34 3.6 0 7.87 1.22 7.87 5.34v6.97c0 1.82-1.18 3.47-2.56 3.47H34.49c-1.39 0-2.57-1.65-2.57-3.47V9.61Z',
  'M28.05 20.45c.04-.48.46-.87.94-.87h21.99c.46 0 .86.37.9.84l2.29 26.49c.05.56-.36 1.03-.91 1.03H26.75c-.55 0-.96-.47-.91-1.03l2.21-26.46Z',
  'M16.22 21.26c.07-.47.48-.86.94-.89l10.02-.65c.54-.04.94.39.9.95l-2.06 26.37c-.03.5-.44.9-.92.9H12.55c-.58 0-.97-.5-.86-1.11l4.53-25.57Z',
  'M63.72 21.37c-.08-.43-.49-.83-.94-.88l-9.92-.95c-.56-.06-.97.38-.93.98l2.26 26.51c.03.51.43.91.91.91h12.42c.63 0 1.02-.5.9-1.13l-4.7-25.44Z',
  'M25.88 48.65c0-.45.37-.82.82-.82h12.46c.46 0 .82.37.82.82v26.74c0 .46-.36.83-.82.83H26.7c-.45 0-.82-.37-.82-.83V48.65Z',
  'M40.2 48.65c0-.45.37-.82.83-.82h12.2c.46 0 .82.37.82.82v26.74c0 .46-.36.83-.82.83h-12.2c-.46 0-.83-.37-.83-.83V48.65Z',
];

let viewer = null;
let items = [];
let ownedIds = new Set();
let outfit = null;
let savedOutfit = null;
let uid = null;
let busy = false;
let activeSlot = null;
let category = 'all';

const CLOUD_NAME = 'dvkbiobph';
const UPLOAD_PRESET = 'bloxverse_upload';
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// -- Colors -------------------------------------------------------------------

const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value);

function colorsToDoc(colors) {
  const doc_ = {};
  colors.forEach((hex, slot) => { doc_[slotNames[slot]] = hex; });
  return doc_;
}

function colorsFromUser(data) {
  if (data.avatarBodyColors) {
    return slotNames.map((name, slot) => (
      isHex(data.avatarBodyColors[name]) ? data.avatarBodyColors[name] : slotDefaults[slot]
    ));
  }
  // The oldest docs stored one shared value per limb pair.
  const legacy = data.avatarColors;
  if (!legacy) return slotDefaults.slice();
  const colors = slotDefaults.slice();
  const put = (slot, value) => { if (isHex(value)) colors[slot] = value; };
  put(0, legacy.Head);
  put(1, legacy.Body);
  if (isHex(legacy.Arms)) { put(2, legacy.Arms); put(3, legacy.Arms); }
  if (isHex(legacy.Legs)) { put(4, legacy.Legs); put(5, legacy.Legs); }
  return colors;
}

function setStatus(message) { status.textContent = message; }

// Hoists the swatch under the pointer above its neighbours so the hovered limb
// is never overlapped by the next one along.
function raiseOutline(event) {
  const swatch = event.target.closest?.('.color-cell');
  if (!swatch || swatch.parentNode.lastElementChild === swatch) return;
  const focused = document.activeElement === swatch;
  swatch.parentNode.append(swatch);
  if (focused) swatch.focus({ preventScroll: true });
}

function syncControls() {
  document.querySelectorAll('.type-btn').forEach((button) => {
    const active = button.dataset.type === outfit.body_type;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  outfit.body_colors.forEach((hex, slot) => {
    const swatch = byId(`swatch-${slot}`);
    if (!swatch) return;
    swatch.style.fill = hex;
    swatch.setAttribute('aria-disabled', String(busy));
    swatch.setAttribute('tabindex', busy ? '-1' : '0');
  });
  const dirty = JSON.stringify(outfit) !== JSON.stringify(savedOutfit);
  saveBtn.disabled = busy || !dirty;
  resetBtn.disabled = busy || !dirty;
  controls.disabled = busy;
}

// -- Items --------------------------------------------------------------------

function buildItems() {
  const all = [];
  for (const item of getClothingStore()) {
    all.push({ ...item, type: item.category === 'Pants' ? 'pant' : 'shirt' });
  }
  for (const item of getFacesStore()) all.push({ ...item, type: 'face' });
  for (const item of getAccessoriesStore()) {
    all.push({ ...item, type: accessoryType[item.category] || 'front_accessory' });
  }
  return all;
}

// A new catalog category still gets a section instead of disappearing.
function orderedTypes() {
  const extra = [...new Set(items.map((item) => item.type))].filter((type) => !typeOrder.includes(type));
  return [...typeOrder, ...extra];
}

const sectionLabel = (type) => sections[type]
  || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const ownedItem = (id, type) => !!id && ownedIds.has(id)
  && items.some((item) => item.id === id && item.type === type);

function isEquipped(item) {
  if (!outfit) return false;
  return item.type in accessoryLabels
    ? outfit.accessory_ids.includes(item.id)
    : outfit[`${item.type}_id`] === item.id;
}

function inCategory(item) {
  return category === 'all'
    || (category === 'accessories' ? item.type === 'hat' || item.type.endsWith('_accessory') : item.type === category);
}

function buildCard(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-card catalog-product' + (isEquipped(item) ? ' equipped' : '');
  button.dataset.itemId = item.id;
  button.setAttribute('aria-pressed', String(isEquipped(item)));
  const info = document.createElement('span');
  info.className = 'catalog-product-info';
  const name = document.createElement('span');
  name.className = 'catalog-product-name';
  name.textContent = item.name;
  name.title = item.name;
  info.append(name);
  button.append(itemImage(item), info);
  button.addEventListener('click', () => toggleEquip(item));
  return button;
}

function buildGrid() {
  const grid = byId('market-grid');
  const query = byId('avatar-search').value.trim().toLocaleLowerCase();
  grid.replaceChildren();
  for (const type of orderedTypes()) {
    const matching = items
      .filter((item) => ownedIds.has(item.id) && item.type === type && inCategory(item)
        && item.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!matching.length) continue;
    const heading = document.createElement('h2');
    heading.className = 'avatar-section-divider';
    heading.textContent = sectionLabel(type);
    grid.append(heading);
    for (const item of matching) grid.append(buildCard(item));
  }
  if (!grid.children.length) {
    const empty = document.createElement('p');
    empty.className = 'catalog-muted';
    empty.style.gridColumn = '1 / -1';
    if (ownedIds.size && (query || category !== 'all')) {
      empty.textContent = 'No items match your filters.';
    } else {
      empty.append('You don\'t own any items yet. ');
      const link = document.createElement('a');
      link.href = '/bloxverse/catalog';
      link.textContent = 'Browse the catalog';
      empty.append(link);
    }
    grid.replaceChildren(empty);
  }
  grid.style.display = 'grid';
  motion()?.reveal(grid, '.catalog-product');
}

function syncCards() {
  byId('market-grid').querySelectorAll('[data-item-id]').forEach((card) => {
    const active = isEquipped(items.find((item) => item.id === card.dataset.itemId));
    card.classList.toggle('equipped', active);
    card.setAttribute('aria-pressed', String(active));
  });
}

// -- Wearing items ------------------------------------------------------------

// Optional: publish the render as the item's catalog thumbnail, which is what
// profile.html reads to show equipped items. Off by default so merely opening the
// editor does not upload the whole catalog.
const publishingEnabled = () => {
  try { return localStorage.getItem('bv:catalogThumbs:publish') === '1'; } catch { return false; }
};

// The preview renderer needs the same kind vocabulary profile.html uses.
const previewKind = (item) => {
  if (item.type === 'face') return 'face';
  if (item.type in accessoryLabels) return 'accessory';
  return item.type === 'pant' ? 'pants' : 'clothing';
};

function maybePublishThumbnail(item) {
  if (!publishingEnabled()) return;
  const kind = previewKind(item);
  const source = item.texturePath || item.meshPath || item.id;
  (async () => {
    try {
      const { renderItemPreview } = await import('./item-preview.js');
      const image = await renderItemPreview({ ...item, kind });
      if (image) await publishCatalogThumbnail({ id: item.id, kind, source }, image);
    } catch (e) {
      console.warn('[avatar] catalog thumbnail publish failed:', e);
    }
  })();
}

// Swaps one rendered preview into an already-built card, so tiles fill in while
// the batch renders rather than after it.
function paintPreview(itemId, dataUrl) {
  const card = byId('market-grid').querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
  const wrap = card?.querySelector('.catalog-product-image');
  if (!wrap) return;
  const image = document.createElement('img');
  image.src = dataUrl;
  image.alt = '';
  wrap.replaceChildren(image);
}

// Renders a preview for every catalog item, once per browser, and re-renders only
// the items whose asset actually changed. The cache is shared with profile.html,
// so a visit here spares that page the same 25 renders.
//
// Intentionally not awaited by load(): the editor is usable while this runs, and
// three.js arrives lazily so the page does not pay for it up front.
async function warmPreviews() {
  if (!items.length) return;
  try {
    const { ensureItemPreviews } = await import('./item-preview.js');
    await ensureItemPreviews(
      items.map((item) => ({ ...item, kind: previewKind(item) })),
      (item, dataUrl) => paintPreview(item.id, dataUrl),
    );
  } catch (e) {
    console.warn('[avatar] preview warm-up failed:', e);
  }
}

async function toggleEquip(item) {
  if (busy || !outfit) return;
  busy = true;
  const previous = structuredClone(outfit);
  try {
    if (item.type in accessoryLabels) {
      const ids = new Set(outfit.accessory_ids);
      if (ids.has(item.id)) ids.delete(item.id);
      else {
        // One of a kind: a second hat would z-fight with the first.
        for (const id of ids) {
          if (items.find((entry) => entry.id === id)?.type === item.type) ids.delete(id);
        }
        ids.add(item.id);
      }
      outfit.accessory_ids = [...ids];
      await viewer.setAccessories(outfit.accessory_ids);
    } else {
      const key = `${item.type}_id`;
      let id = outfit[key] === item.id ? null : item.id;
      // A face is always worn: the head material has nothing to show without one.
      if (item.type === 'face' && id === null) {
        id = items.find((entry) => entry.type === 'face' && entry.id === 'smile')?.id ?? item.id;
      }
      outfit[key] = id;
      await ({ shirt: viewer.applyShirt, pant: viewer.applyPant, face: viewer.applyFace })[item.type](id);
    }
    setStatus('');
    maybePublishThumbnail(item);
  } catch (error) {
    outfit = previous;
    setStatus(`Could not preview this item. ${error.message}`);
  } finally {
    busy = false;
    syncControls();
    syncCards();
  }
}

// -- Persistence --------------------------------------------------------------

// The viewer reads the user doc's own field names, so the editor's outfit is
// translated on the way in and out.
function toViewerOutfit(source) {
  return {
    avatarColors: colorsToDoc(source.body_colors),
    avatarBodyType: source.body_type,
    avatarClothing: source.shirt_id,
    avatarPants: source.pant_id,
    avatarFace: source.face_id,
    avatarAccessories: source.accessory_ids,
  };
}

async function uploadPreview(dataUrl, fileName) {
  if (!dataUrl) return null;
  // No public_id: the unsigned preset cannot overwrite, so a fixed id would
  // return the first uploaded URL forever. Letting Cloudinary assign a fresh id
  // guarantees a new asset per save, and the cache-buster keeps it out of caches.
  const form = new FormData();
  form.append('file', await (await fetch(dataUrl)).blob(), fileName);
  form.append('upload_preset', UPLOAD_PRESET);
  const res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  const data = await res.json();
  if (!data?.secure_url) throw new Error(data?.error?.message || 'upload failed');
  return `${data.secure_url}?t=${Date.now()}`;
}

async function refreshPreviews() {
  if (!viewer) return null;
  const update = {};
  const body = await uploadPreview(viewer.snapshotBody(256), 'avatarPreview.png');
  const head = await uploadPreview(viewer.snapshotHead(256), 'avatarPreviewHead.png');
  if (body) update.avatarPreview = body;
  if (head) update.avatarPreviewHead = head;
  if (!Object.keys(update).length) return null;
  await setDoc(doc(db, 'users', uid), update, { merge: true });
  return update;
}

function refreshNavAvatar(previews) {
  const src = previews?.avatarPreviewHead || previews?.avatarPreview;
  if (!src) return;
  const img = document.querySelector('#navRight img, .site-account img, .site-profile img');
  if (img) img.src = src;
}

async function save() {
  if (busy || !outfit) return;
  busy = true;
  syncControls();
  setStatus('Saving your avatar');
  motion()?.setPending(saveBtn, true, 'Saving your avatar');
  try {
    await setDoc(doc(db, 'users', uid), {
      avatarClothing: outfit.shirt_id,
      avatarPants: outfit.pant_id,
      avatarFace: outfit.face_id,
      avatarAccessories: outfit.accessory_ids,
      avatarBodyColors: colorsToDoc(outfit.body_colors),
      avatarBodyType: outfit.body_type,
    }, { merge: true });
    savedOutfit = structuredClone(outfit);
    setStatus('Avatar saved.');
    syncControls();
    try {
      refreshNavAvatar(await refreshPreviews());
    } catch (e) {
      // The outfit is already saved; a failed thumbnail must not report failure.
      console.warn('[avatar] preview refresh failed:', e);
    }
  } catch (error) {
    setStatus(`Unable to save. ${error.message}`);
  } finally {
    busy = false;
    motion()?.setPending(saveBtn, false);
    syncControls();
  }
}

async function reset() {
  if (busy || !savedOutfit) return;
  busy = true;
  syncControls();
  try {
    await viewer.loadOutfit(toViewerOutfit(savedOutfit));
    outfit = structuredClone(savedOutfit);
    syncCards();
    setStatus('Changes reset.');
  } catch (error) {
    setStatus(`Unable to reset. ${error.message}`);
  } finally {
    busy = false;
    syncControls();
  }
}

// -- Wiring -------------------------------------------------------------------

document.querySelector('.colors-grid').addEventListener('pointerover', raiseOutline);
document.querySelector('.colors-grid').addEventListener('focusin', raiseOutline);
bodyColorPaths.forEach((d, slot) => byId(`swatch-${slot}`).setAttribute('d', d));

saveBtn.addEventListener('click', save);
resetBtn.addEventListener('click', reset);

document.querySelectorAll('.type-btn').forEach((button) => button.addEventListener('click', async () => {
  const type = button.dataset.type;
  if (busy || !outfit || outfit.body_type === type) return;
  busy = true;
  syncControls();
  try {
    await viewer.applyModel(type);
    outfit.body_type = type;
    setStatus('');
  } catch (error) {
    setStatus(`Unable to update body type. ${error.message}`);
  } finally {
    busy = false;
    syncControls();
  }
}));

document.querySelectorAll('.color-cell').forEach((cell) => {
  const pick = () => {
    if (busy || !outfit) return;
    activeSlot = Number(cell.dataset.slot);
    byId('color-picker').value = outfit.body_colors[activeSlot];
    byId('color-picker').click();
  };
  cell.addEventListener('click', pick);
  cell.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    pick();
  });
});

byId('color-picker').addEventListener('input', (event) => {
  if (activeSlot === null || busy) return;
  outfit.body_colors[activeSlot] = event.target.value;
  viewer.applyBodyColor(activeSlot, event.target.value);
  syncControls();
  setStatus('');
});

byId('avatar-search').addEventListener('input', () => { if (outfit) buildGrid(); });
byId('avatar-categories').querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
  category = button.dataset.category;
  byId('avatar-categories').querySelectorAll('[data-category]').forEach((other) => {
    other.setAttribute('aria-pressed', String(other === button));
  });
  if (outfit) buildGrid();
}));
byId('avatar-retry').addEventListener('click', () => start());

async function load() {
  busy = true;
  controls.disabled = true;
  byId('avatar-retry').hidden = true;
  setStatus('Loading your avatar');
  try {
    await loadCatalog();
    items = buildItems();

    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : {};
    if (Array.isArray(data.ownedItems) && data.ownedItems.length) {
      ownedIds = new Set(data.ownedItems);
    } else {
      ownedIds = new Set(STARTING_ITEMS);
      await setDoc(doc(db, 'users', uid), { ownedItems: [...STARTING_ITEMS] }, { merge: true });
    }

    if (!viewer) {
      viewer = await createViewer(byId('preview-canvas'), {
        width: 210, height: 266, rotateToggle: byId('rotate-toggle'), transparent: true,
      });
    }
    if (!viewer) throw new Error('3D preview is unavailable in this browser.');

    outfit = {
      shirt_id: ownedItem(data.avatarClothing, 'shirt') ? data.avatarClothing : null,
      pant_id: ownedItem(data.avatarPants, 'pant') ? data.avatarPants : null,
      face_id: ownedItem(data.avatarFace, 'face') ? data.avatarFace : 'smile',
      body_type: (data.avatarBodyType || data.bodyType) === 'female' ? 'female' : 'male',
      body_colors: colorsFromUser(data),
      accessory_ids: (Array.isArray(data.avatarAccessories) ? data.avatarAccessories : [])
        .filter((id) => findAccessoryStore(id) && ownedIds.has(id)),
    };

    await viewer.loadOutfit(toViewerOutfit(outfit));
    savedOutfit = structuredClone(outfit);
    buildGrid();
    warmPreviews();
    busy = false;
    syncControls();
    setStatus('');
  } catch (error) {
    busy = false;
    setStatus(`Unable to load your avatar. ${error.message}`);
    byId('avatar-retry').hidden = false;
  }
}

function start() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.replace('/bloxverse/auth');
      return;
    }
    if (await banGuard(user.uid)) return;
    assignUserIdNum(user.uid).catch(() => {});
    uid = user.uid;
    trackPresence(user.uid, null, 'avatar');

    // Shell state, so it gets its own read: a 3D/catalog failure below must not
    // leave the top-right corner empty.
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      const profile = snap.exists() ? snap.data() : {};
      renderAccountCluster(user, {
        username: profile.username || user.displayName,
        bux: profile.bux || 0,
        userNum: profile.userIdNum,
        preview: profile.avatarPreviewHead || profile.avatarPreview || null,
        sitePath: (p) => `/bloxverse${p}`,
        onLogout: () => { location.replace('/bloxverse/auth'); },
      });
    } catch (error) {
      console.warn('[avatar] account cluster failed:', error);
    }

    await load();
  });
}

start();
