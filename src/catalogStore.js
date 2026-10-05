/**
 * Client-side catalog store.
 *
 * Seeds from the bundled local item modules (works offline / on first paint),
 * then overlays the server catalog (`GET /api/catalog`) when it is reachable.
 * The server catalog is authoritative for metadata + asset URLs; the local copy
 * is only a fallback so dev/offline still functions.
 */
import { getAllAccessories } from './accessories.js';
import { getAllClothing } from './clothing.js';
import { getAllFaces } from './faces.js';
import { getAllEmotes } from './emotes.js';
import { fetchApi } from './api.js';

let _server = null;
let _loaded = false;

const SCALAR_FIELDS = ['id', 'name', 'description', 'price', 'author', 'category', 'icon', 'looping', 'created', 'updated'];
// Limited/off-sale/variant fields flow from the server as well. They are kept
// separate because they may be boolean (limited, off_sale) not just strings, so
// the undefined-check in mergeByType handles them the same way.
const EXTRA_FIELDS = ['limited', 'off_sale', 'stock', 'total_stock', 'copies_per_user', 'family', 'family_id'];

async function loadEmoteAnim(entry) {
  if (!entry.fileUrl || entry.keyframes) return;
  try {
    const res = await fetch(entry.fileUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    entry.duration = data.duration;
    entry.keyframes = data.keyframes;
  } catch (e) {
    console.warn('[catalog] Failed to load emote anim:', entry.id, e);
  }
}

/**
 * Fetch the server catalog once. Safe to call multiple times; the result is kept
 * and emote animation data is preloaded into the server entries.
 */
export async function loadCatalog() {
  if (_loaded) return;
  _loaded = true;
  try {
    const res = await fetchApi('/api/catalog');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _server = await res.json();
    await Promise.all((_server.emotes || []).map(loadEmoteAnim));
  } catch (e) {
    console.warn('[catalog] Server catalog unavailable; using local catalog.', e);
  }
}

/**
 * Merge local seeds with the server list for one category.
 * Server metadata wins; the local item's meshPath/texturePath survive only as a
 * fallback when the server entry has no Cloudinary asset for that slug.
 */
function mergeByType(local, server) {
  const locMap = new Map(local.map(i => [i.id, i]));
  const out = [];
  const seen = new Set();
  for (const s of server || []) {
    if (!s || !s.id) continue;
    seen.add(s.id);
    const loc = locMap.get(s.id) || {};
    const item = { ...loc };
    for (const f of SCALAR_FIELDS) if (s[f] !== undefined) item[f] = s[f];
    for (const f of EXTRA_FIELDS) {
      // Server omits the field entirely when it's not set, so `undefined` means
      // "not configured" and we fall back to whatever the local entry says.
      // When the server explicitly sends false/0 those will still be undefined
      // in the Cloudinary context and won't arrive, so this is correct.
      if (s[f] !== undefined) item[f] = s[f];
      // Clean up stale local limiteds when the server says the item is no longer
      // limited (field present with falsy value -- shouldn't happen with current
      // server code but guard it anyway).
      else if (f === 'limited' || f === 'off_sale') delete item[f];
    }
    for (const f of ['meshPath', 'texturePath', 'fileUrl', 'file', 'keyframes', 'duration']) {
      if (s[f] !== undefined) item[f] = s[f];
    }
    out.push(item);
  }
  for (const loc of local) if (!seen.has(loc.id)) out.push(loc);
  return out;
}

export function getAccessoriesStore() {
  return mergeByType(getAllAccessories(), _server && _server.accessories);
}
export function getClothingStore() {
  return mergeByType(getAllClothing(), _server && _server.clothing);
}
export function getFacesStore() {
  return mergeByType(getAllFaces(), _server && _server.faces);
}
export function getEmotesStore() {
  return mergeByType(getAllEmotes(), _server && _server.emotes);
}
export function findAccessoryStore(id) {
  return getAccessoriesStore().find(a => a.id === id) || null;
}
export function findClothingStore(id) {
  return getClothingStore().find(c => c.id === id) || null;
}
export function findFaceStore(id) {
  return getFacesStore().find(f => f.id === id) || null;
}
export function findEmoteStore(id) {
  return getEmotesStore().find(e => e.id === id) || null;
}