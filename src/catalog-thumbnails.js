// Per-item rendered thumbnails -- the equivalent of the reference's
// GET /api/catalog/thumbnail/:id and faceSnapshot().
//
// The reference renders each catalog item once on the server and serves a PNG
// by id. BloxVerse has no image server, but avatar.html already renders every
// item on the live avatar and Cloudinary is already the project's image host,
// so we publish those renders under a deterministic public_id per item. That
// gives the same contract: a stable, publicly readable rendered PNG addressed
// by item id, which any page can use without booting three.js.
//
// A public_id that has never been uploaded simply 404s, so callers can use the
// URL directly and fall back on the img error event.

const CLOUD_NAME = 'dvkbiobph';
const UPLOAD_PRESET = 'bloxverse_upload';
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
const DELIVERY_BASE = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload`;

// Addressed by item id, like the reference's /api/catalog/thumbnail/:id. Catalog
// ids are already kind-prefixed (face_smile, pants_errorpants, ...), so no extra
// kind segment is needed. The public_id is deliberately flat: a '/' would be
// parsed by the delivery URL as a transformation segment, which Cloudinary
// rejects with a 400.
const publicIdFor = (item) => `bv_catalog_thumb_${item.id}`;

// The rendered PNG for an item, or null when we have no id to address it by.
export function catalogThumbnailUrl(item) {
  if (!item || !item.id) return null;
  return `${DELIVERY_BASE}/${publicIdFor(item)}.png`;
}

// The preview source the thumbnail was rendered from, so a changed texture
// republishes instead of leaving a stale image behind.
const sourceOf = (item) => item.source || item.texturePath || item.meshPath || item.id || '';

const PUBLISHED_KEY = 'bv:catalogThumbs:v1';

function publishedMap() {
  try { return JSON.parse(localStorage.getItem(PUBLISHED_KEY)) || {}; } catch { return {}; }
}

export function isCatalogThumbnailPublished(item) {
  const source = sourceOf(item);
  return !!source && publishedMap()[publicIdFor(item)] === source;
}

// Publishes a rendered preview (data URL or blob URL) as the item's thumbnail.
// Idempotent per (item, source): re-running after a texture change overwrites,
// but an unchanged item is a no-op so we never re-upload the whole catalog.
export async function publishCatalogThumbnail(item, image) {
  const url = catalogThumbnailUrl(item);
  if (!url || !image) return null;
  const source = sourceOf(item);
  if (isCatalogThumbnailPublished(item)) return url;

  const blob = image instanceof Blob ? image : await (await fetch(image)).blob();
  const formData = new FormData();
  formData.append('file', blob, `${publicIdFor(item)}.png`);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('public_id', publicIdFor(item));
  formData.append('overwrite', 'true');
  formData.append('invalidate', 'true');

  const res = await fetch(UPLOAD_URL, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`catalog thumbnail upload failed (${res.status})`);

  try {
    const map = publishedMap();
    map[publicIdFor(item)] = source;
    localStorage.setItem(PUBLISHED_KEY, JSON.stringify(map));
  } catch { /* storage blocked; the upload still landed */ }
  return url;
}
