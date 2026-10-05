// Catalog view helpers.
//
// Ported from the Vortex reference unused\uirevamp\catalog_view.js.
//
// The reference builds item thumbnails from image endpoints (/api/catalog/
// thumbnail/:id) and renders face cards as live 3D snapshots. BloxVerse has no
// image server, so a thumbnail is produced by rendering the item once in the
// browser (src/item-preview.js) and keeping the PNG in a localStorage cache
// keyed by item id and the asset it was rendered from -- so a changed asset
// re-renders, and everything else never does. That cache is shared with
// profile.html. A published Cloudinary render under the same deterministic
// public_id (src/catalog-thumbnails.js) is the second choice, for items this
// browser has not rendered yet, and the reference's glyph fallback covers the
// rest.
import { catalogThumbnailUrl } from './catalog-thumbnails.js';
import { cachedPreview } from './item-preview.js';

// The reference builds its price label and its missing-preview fallback out of
// per-asset SVGs (unused\uirevamp\catalog_view.js assetIcon): a coin in front of
// every paid price, and a category glyph when there is nothing to show. Our
// asset folder already ships the whole reference icon set at the same names --
// accessories, avatar, catalog, chevron, faces, friends, hair, home, pants,
// search, shirts -- plus price.svg and bux.svg for the two the reference calls
// price.svg and volts.svg. The colour is baked into the file because these load
// through <img>, where currentColor resolves to black rather than the label's
// own colour: price.svg uses the same purple as .catalog-product-price.is-paid.
const ICONS = { price: 'price.svg', volts: 'bux.svg' };

export function assetIcon(name, size = 24) {
  const image = document.createElement('img');
  image.src = `assets/icons/${ICONS[name] || `${name}.svg`}`;
  image.alt = '';
  image.width = size;
  image.height = size;
  image.className = 'catalog-icon';
  return image;
}

// The reference falls back to per-type category icons. We ship no per-type icon
// set, so the fallback is a Font Awesome glyph in the same slot.
const FALLBACK_ICON = {
  shirt: 'fa-shirt',
  pant: 'fa-shirt',
  face: 'fa-face-smile',
};

function missingImage(item) {
  const glyph = document.createElement('i');
  glyph.className = 'fa-solid ' + (FALLBACK_ICON[item.type] || 'fa-glasses') + ' catalog-missing-image';
  glyph.setAttribute('aria-hidden', 'true');
  return glyph;
}

function previewImage(src) {
  const image = document.createElement('img');
  image.src = src;
  image.alt = '';
  image.decoding = 'async';
  return image;
}

// `detail` swaps in the reference's detail-page class (unused\uirevamp\catalog_view.js:34).
// The two are not interchangeable: the card image is a rounded thumbnail with
// hover zoom, while .catalog-detail-image is a borderless, edge-to-edge letterbox
// inside the 1:1 .item-media frame with its own fixed img size.
export function itemImage(item, detail = false) {
  const wrap = document.createElement('span');
  // ui-thumbnail is the reference's card-image class: it clips the image and adds
  // the hover zoom. Match it so item cards behave like the catalog's.
  wrap.className = (detail ? 'catalog-detail-image' : 'catalog-product-image ui-thumbnail')
    + (item.type === 'face' ? ' is-face' : '');
  // A preview this browser has already rendered beats the published URL: it is
  // on screen with no network at all, so an item nobody has uploaded yet still
  // shows a real render rather than a 404 into the fallback glyph.
  const local = cachedPreview(item);
  if (local) {
    wrap.append(previewImage(local));
    return wrap;
  }
  const url = catalogThumbnailUrl(item);
  if (!url) {
    wrap.append(missingImage(item));
    return wrap;
  }
  const image = previewImage(url);
  image.loading = detail ? 'eager' : 'lazy';
  image.addEventListener('error', () => {
    wrap.replaceChildren(missingImage(item));
  }, { once: true });
  wrap.append(image);
  return wrap;
}

export function priceLabel(item) {
  const label = document.createElement('span');
  label.className = 'catalog-product-price';
  if (item.off_sale) {
    label.textContent = 'OFF SALE';
  } else if (item.price > 0) {
    label.classList.add('is-paid');
    // Icon then number, in .catalog-product-price's 4px flex gap -- the
    // reference's layout, which a bare number collapses.
    label.append(assetIcon('price', 16), document.createTextNode(item.price.toLocaleString()));
    label.setAttribute('aria-label', `${item.price.toLocaleString()} Bux`);
  } else label.textContent = 'FREE';
  return label;
}

export function limitedBadge(item) {
  // `stock` reaches here already resolved by catalog_stock.withRemaining() on the
  // catalog page, so this is the live count rather than the Cloudinary run size.
  // An absent count must read as sold out rather than silently as "not sold out".
  const soldOut = !(Number(item.stock) > 0);
  const badge = document.createElement('span');
  badge.className = 'catalog-limited-badge' + (soldOut ? ' is-sold-out' : '');
  badge.setAttribute('aria-label', soldOut ? 'Limited, sold out' : 'Limited');
  badge.innerHTML = `<i class="fa-solid fa-bolt" aria-hidden="true"></i>${soldOut ? 'Sold out' : 'Limited'}`;
  return badge;
}

// Ported from the reference itemCard (unused\uirevamp\catalog_view.js:72). The
// reference links into /catalog/:id detail pages BloxVerse does not have, so the
// card is a plain element here and opens nothing. `owned` swaps the price for an
// "Owned" readout that reverts to the price on hover, which is what the
// reference does for inventory cards; the limited branch is kept so a catalog
// entry that gains a limited flag renders like the reference without new code.
export function itemCard(item, { owned = false, ownershipText = '', showLimitedDetails = true } = {}) {
  const link = document.createElement('a');
  link.href = `/bloxverse/catalog?item=${encodeURIComponent(item.id)}`;
  // Reference uses item.family as the card display name for variant families.
  link.setAttribute('aria-label', item.family || item.name);
  link.className = 'ui-card catalog-product';
  link.dataset.itemId = item.id;

  const info = document.createElement('span');
  info.className = 'catalog-product-info';
  const name = document.createElement('span');
  name.className = 'catalog-product-name';
  name.textContent = item.family || item.name;
  name.title = name.textContent;

  // `stock` is what is genuinely left and `total_stock` the run size, both resolved
  // by catalog_stock.withRemaining() before the card is built. Formatting them
  // straight off the item would throw on a limited asset that never declared a
  // run size, taking the whole card down with it.
  const total = Number(item.total_stock) || 0;
  const left = Number(item.stock) || 0;
  const soldOut = item.limited && !(left > 0);

  // A limited run with nothing left reads OFF SALE rather than a price nobody can
  // pay. The reference gets this for free because its API already flips off_sale
  // once stock hits zero; ours can only find out from the live ledger, so the
  // card has to apply it. The detail page is deliberately left alone -- its
  // showPrices() forces off_sale off for limited items so it can keep showing
  // "Original Price" next to the real number (item.js:154).
  const price = priceLabel(soldOut ? { ...item, off_sale: true } : item);

  if (owned && !item.limited) {
    const actual = [...price.childNodes];
    const bought = document.createTextNode('Owned');
    price.replaceChildren(bought);
    price.classList.add('is-bought');
    link.addEventListener('mouseenter', () => {
      price.replaceChildren(...actual);
      price.classList.remove('is-bought');
    });
    link.addEventListener('mouseleave', () => {
      price.replaceChildren(bought);
      price.classList.add('is-bought');
    });
  }

  info.append(name, price);
  if (item.limited) {
    link.classList.add('is-limited');
    if (showLimitedDetails) {
      const stock = document.createElement('span');
      stock.className = 'catalog-product-stock';
      stock.textContent = !total
        ? soldOut ? 'Sold out' : `${left.toLocaleString()} available`
        : soldOut
          ? `${total.toLocaleString()} copies sold`
          : `${left.toLocaleString()} of ${total.toLocaleString()} available`;
      info.append(stock);
    }
    if (soldOut) link.classList.add('is-sold-out');
    link.append(limitedBadge(item));
  }
  if (ownershipText) {
    const ownership = document.createElement('span');
    ownership.className = 'catalog-product-ownership';
    ownership.textContent = ownershipText;
    info.append(ownership);
  }
  // Reference: items with family_id (variant families) get a rainbow brush badge.
  if (item.family_id) {
    const stack = document.createElement('span');
    stack.className = 'catalog-variants-badge';
    stack.setAttribute('aria-label', 'Multiple variations');
    stack.innerHTML = '<i class="fa-solid fa-brush" aria-hidden="true"></i>';
    link.append(stack);
  }
  if (owned) {
    const badge = document.createElement('span');
    badge.className = 'catalog-owned-badge';
    badge.title = 'Owned';
    badge.setAttribute('aria-label', 'Owned');
    badge.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    link.append(badge);
  }
  link.prepend(itemImage(item));
  link.append(info);
  return link;
}
