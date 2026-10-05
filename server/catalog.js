// Server-side catalog: every item is a Cloudinary asset. Items are found by
// their Cloudinary folder (the one you see in the Media Library).
//
//   Identity : the asset's public id .../burgerhead.glb  -> id "burgerhead"
//   Metadata : stored in the asset's Cloudinary context (key/values)
//
// Context keys are read generously so either works:
//   name        -> "title" OR the built-in "caption" field
//   description -> "description" OR the built-in "alt" field
//   price       -> number, defaults 0 (drops to FREE)
//   author      -> creator name, defaults "BloxVerse"
//   category    -> category label (clothing defaults to "Shirts"; pants MUST
//                  set category=Pants)
//   icon        -> emoji/letter icon shown before a generated preview exists
//   looping     -> "true"/"false" (emotes), defaults false
//   created     -> created date string
//   updated     -> updated date string
//
// Limited / off-sale / variants (all optional):
//   limited     -> "true" marks item as a limited edition (shows badge)
//   off_sale    -> "true" marks item as off-sale (overrides price label)
//   stock       -> run size in copies (integer, e.g. "100"). This is the BASELINE,
//                  not a live counter: Cloudinary context cannot change when
//                  somebody buys, so copies actually sold are counted in Firestore
//                  at catalogStock/{id} and the client subtracts them. Remaining is
//                  stock - sold. Stock may also be set in Firestore instead, which
//                  wins over this value, so a run can be resized without touching
//                  the asset. Every player can hold one copy of an item.
//   total_stock -> original run size (integer, e.g. "100"). Used for the
//                  "n of m sold" readout; falls back to being the run size when
//                  stock is not given.
//   copies_per_user -> how many copies one player may hold (integer, e.g. "3").
//                  Leave it off for single-copy items. Every player can always
//                  hold one; this raises the ceiling for that item only.
//   rap         -> optional starting figure for the recent average price, in
//                  Volts (e.g. "500"). Normally RAP is the running average of
//                  sale prices kept in Firestore; this only seeds it.
//   family      -> display name shared across variant items (e.g. "Classic Cap")
//   family_id   -> slug shared across all variants of the same item
//                  (e.g. "classic-cap"). Items sharing a family_id are collapsed
//                  into one card in the catalog grid.
//
// To add an item:
//   1. Upload to Cloudinary, then drag the asset into the "accessories",
//      "clothing", "faces" or "emotes" folder in the Media Library.
//      (Resource type: GLB/JSON "Raw" or "Auto"; PNG files "Image".)
//   2. Open the asset → Editor → Context: fill Caption (name), Alt text
//      (description) and add the custom keys above as needed.
// Done -- no code, no JSON files, no URL copying.

const CACHE_TTL_MS = 30000;

const CATEGORIES = [
  { key: 'accessories', assetField: 'meshPath', folder: 'accessories', resourceTypes: ['raw', 'image'] },
  { key: 'clothing', assetField: 'texturePath', folder: 'clothing', resourceTypes: ['image'], defaultCategory: 'Shirts' },
  { key: 'faces', assetField: 'texturePath', folder: 'faces', resourceTypes: ['image'], defaultCategory: 'Faces' },
  { key: 'emotes', assetField: 'fileUrl', folder: 'emotes', resourceTypes: ['raw'], defaultCategory: 'Emotes' },
];

function slugToId(slug) {
  return slug.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

function str(v) {
  return v === undefined || v === null ? undefined : String(v);
}

function itemFromResource(res, cat) {
  const custom = (res.context && res.context.custom) || res.context || {};
  const slug = slugToId(res.public_id);
  const item = {
    id: slug,
    name: str(custom.title) || str(custom.caption) || str(custom.name) || slug,
    description: str(custom.description) || str(custom.alt) || '',
    price: Number(str(custom.price)) || 0,
    author: str(custom.author) || 'BloxVerse',
    category: str(custom.category) || cat.defaultCategory || 'Other',
    created: str(custom.created),
    updated: str(custom.updated),
  };

  // Limited / off-sale / variant fields -- all optional; omitted from the
  // response when not set so the client can distinguish "false" from "not set".
  if (str(custom.limited) === 'true') item.limited = true;
  if (str(custom.off_sale) === 'true') item.off_sale = true;
  if (str(custom.stock) !== undefined && str(custom.stock) !== '') {
    const stock = parseInt(str(custom.stock), 10);
    if (!isNaN(stock)) item.stock = stock;
  }
  if (str(custom.total_stock) !== undefined && str(custom.total_stock) !== '') {
    const total = parseInt(str(custom.total_stock), 10);
    if (!isNaN(total)) item.total_stock = total;
  }
  // How many copies one player may hold. Omitted when unset, and the client treats a
  // missing value as 1, so an item nobody configured stays single-copy.
  if (str(custom.copies_per_user) !== undefined && str(custom.copies_per_user) !== '') {
    const copies = parseInt(str(custom.copies_per_user), 10);
    if (!isNaN(copies) && copies >= 1) item.copies_per_user = copies;
  }
  if (str(custom.family)) item.family = str(custom.family);
  if (str(custom.family_id)) item.family_id = str(custom.family_id);

  // A starting figure for RAP. Normally RAP is the running average of sale prices
  // kept in Firestore, because a static context value cannot move once people start
  // buying; this is only for seeding one by hand.
  if (str(custom.rap) !== undefined && str(custom.rap) !== '') {
    const rap = parseInt(str(custom.rap), 10);
    if (!isNaN(rap) && rap >= 0) item.recentAveragePrice = rap;
  }

  // Auto-derive sold-out from stock when limited=true and stock is present.
  if (item.limited && item.stock !== undefined && item.stock <= 0) {
    item.off_sale = true;
  }

  if (cat.key === 'emotes') {
    item.file = slug + '.json';
    item.looping = str(custom.looping) === 'true';
  }
  if (str(custom.icon)) item.icon = str(custom.icon);
  item[cat.assetField] = res.secure_url || null;
  return item;
}

async function queryAll(cloud, params) {
  const out = [];
  let cursor = null;
  do {
    const page = { ...params };
    if (cursor) page.next_cursor = cursor;
    const res = await cloud.api.resources(page);
    out.push(...(res.resources || []));
    cursor = res.next_cursor || null;
  } while (cursor);
  return out;
}

let cachePromise = null;
let cacheTime = 0;

async function buildCatalog(cloud) {
  const result = { source: 'cloudinary', version: 3, generatedAt: new Date().toISOString() };
  for (const cat of CATEGORIES) result[cat.key] = [];

  // No credentials means no Cloudinary listing. Saying so beats reporting
  // source: "cloudinary" with every category empty, which reads like a broken
  // folder layout rather than an unconfigured server.
  if (!cloud) {
    result.source = 'unconfigured';
    result.error = 'Cloudinary credentials are not set on this server (CLOUDINARY_URL, or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET).';
    return result;
  }

  // Find every item by folder, exactly as it appears in the Media Library.
  for (const cat of CATEGORIES) {
    try {
      const seen = new Set();
      const items = [];
      const push = r => {
        const candidate = itemFromResource(r, cat);
        if (!seen.has(candidate.id) && candidate[cat.assetField]) {
          seen.add(candidate.id);
          items.push(candidate);
        }
      };
      // 1) The Media Library "asset folder" (public ids stay whatever they were).
      for (const rt of cat.resourceTypes) {
        for (const r of await queryAll(cloud, { type: 'upload', resource_type: rt, max_results: 500, context: true })) {
          if (String(r.asset_folder || '') === cat.folder) push(r);
        }
      }
      // 2) Assets uploaded INTO the folder (public id carries the prefix).
      for (const rt of cat.resourceTypes) {
        for (const r of await queryAll(cloud, { type: 'upload', resource_type: rt, prefix: cat.folder + '/', max_results: 100, context: true })) {
          push(r);
        }
      }
      result[cat.key] = items;
    } catch (e) {
      // The Cloudinary SDK does not reject API failures with an Error. It rejects
      // with a plain object carrying the parsed response body on `error`, so
      // e.message is undefined and the actual reason ("api_secret mismatch", 401)
      // was being logged as the literal string "undefined". Pull it out properly.
      const reason = describeCloudinaryError(e);
      console.warn(`[catalog] Cloudinary listing failed for ${cat.folder}: ${reason}`);
      // Surfaced in the response too, so a browser hitting /api/catalog shows the
      // cause instead of four silently empty categories.
      result.errors = result.errors || {};
      result.errors[cat.key] = reason;
    }
  }
  return result;
}

/**
 * A readable one-liner from whatever the Cloudinary SDK rejected with.
 *
 * Covers the three shapes seen in practice: an Error from the synchronous
 * validation (must supply cloud_name), the plain object carrying `error` from a
 * rejected API call, and a string.
 */
function describeCloudinaryError(e) {
  if (!e) return 'Unknown Cloudinary error.';
  const body = e.error;
  const detail = (body && (body.message || body.error))
    || e.message
    || (typeof e === 'string' ? e : null)
    || 'Unknown Cloudinary error.';
  const code = (body && body.http_code) || e.http_code;
  return code ? `${detail} (HTTP ${code})` : String(detail);
}

// Memoized wrapper so repeated hits within the TTL don't hammer Cloudinary.
function getCatalog(cloud) {
  const now = Date.now();
  if (cachePromise && now - cacheTime < CACHE_TTL_MS) return cachePromise;
  cacheTime = now;
  cachePromise = buildCatalog(cloud).then(data => data);
  return cachePromise;
}

module.exports = { getCatalog };