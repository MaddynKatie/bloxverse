/**
 * Live copy counts for limited catalog runs, and the read side of the marketplace.
 *
 * server/catalog.js reads the run size out of the Cloudinary asset context, which
 * is static configuration: limited="true" stock="100" total_stock="100". Static
 * config cannot go down when somebody buys something, so the number of copies
 * actually sold is kept in Firestore, one doc per item:
 *
 *   catalogStock/{itemId} -> { sold, stock?, copies?, rap?, rapExact?, rapResales? }
 *
 * `sold` is the running count. `stock` and `copies` optionally override the context
 * values, so a run can be resized or a copy ceiling raised without re-uploading the
 * asset. `rap` is the recent average price of resales, folded by the server on every
 * resale so nobody has to maintain it (`rapExact` and `rapResales` are its working
 * state). The doc is absent until an item sells its first copy, which is why a
 * missing doc means zero rather than an error.
 *
 * Each player's copies live in `ownedCopies` on the user document, a map of item id
 * to how many they hold, because ownedItems is an array of ids and so cannot
 * express duplicates. How many they are allowed is configured per item with
 * copies_per_user (default 1).
 *
 * Resale needs to know which physical copy a player holds, because a limited run
 * that sells out should still be buyable from whoever listed one. Each copy of a
 * limited item therefore gets its own document:
 *
 *   catalogStock/{itemId}/copies/{serial} -> {
 *     owner, ownerName, price, acquiredAt, listedPrice?, listedAt?, relistAfter?
 *   }
 *
 * The serial is the number it had when it was issued, so it is also the count under
 * the parent run's `sold`. Resale only applies to limited items, matching the
 * reference.
 *
 * This module only reads. Buying, listing and buying a listing are all settled by
 * server/catalog-trading.js with the Admin SDK, because the client cannot be trusted
 * with money: a resale has to debit one player and credit another in a single atomic
 * step, which security rules cannot verify, and the copy ledger needs exactly one
 * writer. The local caches here are kept in step from what the server reports back.
 */
import { db, auth } from './firebase.js';
import { fetchApi } from './api.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from 'firebase/firestore';

/** itemId -> { sold: number, stock: number | null, copies: number | null } */
const counts = new Map();
const listeners = new Set();

export class SoldOutError extends Error {
  constructor() {
    super('This limited item is sold out.');
    this.name = 'SoldOutError';
  }
}

export class AlreadyOwnedError extends Error {
  constructor() {
    super('You already own every copy you are allowed.');
    this.name = 'AlreadyOwnedError';
  }
}

/**
 * How many copies of this item one player may hold.
 *
 * Configured per item with the copies_per_user key in the Cloudinary context, and
 * overridable in Firestore alongside the run size. Defaults to 1, so an item
 * nobody configured is single-copy and nobody can buy two by accident.
 */
export function copiesPerUser(item) {
  const override = entry(item?.id).copies;
  if (override !== null && override !== undefined && Number.isFinite(Number(override))) {
    return Math.max(1, Number(override));
  }
  const configured = Number(item?.copies_per_user);
  if (Number.isFinite(configured) && configured >= 1) return Math.floor(configured);
  return 1;
}

function entry(id) {
  return counts.get(id) || { sold: 0, stock: null, copies: null, rap: null, rapSales: 0 };
}

/** Copies of this item already sold. Zero when nothing has sold yet. */
export function soldCount(id) {
  return entry(id).sold;
}

/**
 * Recent average price: the server's running average of what copies resell for, the
 * way Roblox calculates RAP. Each resale pulls it 10% of the way toward the sale
 * price (see nextRap in server/catalog-trading.js).
 *
 * Null until a copy has been resold. Original purchases do not count: they are the
 * run's own price, not a market signal.
 */
export function recentAveragePrice(item) {
  return entry(item?.id).rap ?? null;
}

/**
 * The run size, preferring a Firestore override over the Cloudinary context.
 *
 * Falls back to total_stock when stock is absent: a run configured only with its
 * size is a full run, not an unlimited one, and treating it as unlimited would put
 * "Infinity remaining" on the detail page.
 *
 * Returns Infinity when neither is configured, which reads as unlimited.
 */
export function baselineFor(item) {
  if (!item) return Infinity;
  const override = entry(item.id).stock;
  if (override !== null && override !== undefined && Number.isFinite(Number(override))) {
    return Number(override);
  }
  const configured = Number(item.stock);
  if (Number.isFinite(configured)) return configured;
  const total = Number(item.total_stock);
  return Number.isFinite(total) ? total : Infinity;
}

/** Copies left. Infinity for anything that is not a limited run. */
export function remaining(item) {
  if (!item || !item.limited) return Infinity;
  const baseline = baselineFor(item);
  if (!Number.isFinite(baseline)) return Infinity;
  return Math.max(0, baseline - soldCount(item.id));
}

export function isSoldOut(item) {
  return !!item?.limited && remaining(item) <= 0;
}

/**
 * The item as its views should see it: `stock` replaced by what is genuinely left,
 * and `total_stock` filled in with the effective run size when the asset never
 * declared one.
 *
 * Passed to itemCard() and limitedBadge() so every surface agrees on the same
 * numbers. Resolving total_stock here rather than in the card keeps catalog_view
 * free of ledger state -- it just reads the two numbers off the item.
 */
export function withRemaining(item) {
  if (!item || !item.limited) return item;
  const baseline = baselineFor(item);
  return {
    ...item,
    stock: remaining(item),
    total_stock: Number.isFinite(baseline) ? baseline : item.total_stock,
  };
}

/**
 * Read the ledger for a set of ids in one pass. Missing docs are normal, so they
 * are recorded as zero rather than logged.
 */
export async function loadSoldCounts(ids) {
  const wanted = [...new Set(ids.filter(Boolean))].filter(id => !counts.has(id));
  if (!wanted.length) return;
  await Promise.all(wanted.map(async id => {
    try {
      const snap = await getDoc(doc(db, 'catalogStock', id));
      if (!snap.exists()) {
        counts.set(id, { sold: 0, stock: null, copies: null, rap: null, rapSales: 0 });
        return;
      }
      const data = snap.data() || {};
      counts.set(id, {
        sold: Number(data.sold) || 0,
        stock: data.stock === undefined ? null : Number(data.stock),
        copies: data.copies === undefined ? null : Number(data.copies),
        // Only a RAP the resale formula produced counts. A document written before
        // resale RAP existed has an old original-sales average and no rapResales,
        // which is not a market price, so it reads as no RAP rather than being
        // shown. This is what lets those documents be left alone in Firestore.
        rap: Number(data.rapResales) > 0 ? Number(data.rap) || null : null,
        rapSales: Number(data.rapSales) || 0,
      });
    } catch (e) {
      console.warn('[catalog] Could not read copy count:', id, e);
      counts.set(id, { sold: 0, stock: null, copies: null, rap: null, rapSales: 0 });
    }
  }));
  notify();
}

/**
 * Call a trading endpoint on the backend.
 *
 * Everything that moves Bux or moves a copy goes through the server, which settles
 * it with the Admin SDK. This only carries the intent and the auth token.
 *
 * The server's failure codes are turned back into the error classes the views
 * already handle, so a sold-out run still reads as "sold out" rather than as a
 * generic failure.
 */
async function trade(path, { method = 'POST', body = null } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to trade items.');
  let res;
  try {
    res = await fetchApi(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw new Error('Could not reach the trading server.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.code === 'sold_out') throw new SoldOutError();
    if (data.code === 'already_owned') throw new AlreadyOwnedError();
    throw new Error(data.error || 'That did not work.');
  }
  return data;
}

/**
 * Sell one copy to a player.
 *
 * The purchase is settled by the server rather than by a transaction here, for two
 * reasons that both come down to the client not being trustworthy with money. A
 * resale has to debit one player and credit another in one atomic step, which
 * security rules cannot verify; and the copy ledger needs exactly one writer, or a
 * tampered client could invent a copy and sell it. The server also prices the item
 * from the catalog, so a modified client cannot buy it for a Bux.
 *
 * Only the cache is maintained here, from what the server reports back.
 *
 * Returns how many copies the player holds afterwards.
 */
export async function buyItem(item, uid) {
  if (!item?.id || !uid) throw new Error('Cannot buy an item without an id and a user.');
  const limited = !!item.limited;
  const result = await trade('/api/catalog/purchase', {
    method: 'POST',
    body: { itemId: item.id },
  });

  if (limited) {
    const sold = Number(result.sold);
    const rap = result.rap ?? null;
    // The server also carries the run's stock and copies overrides through, but
    // they are unchanged by a purchase, so the cached ones are still accurate.
    // A purchase does not move RAP, so keep the cached figure if the server sent none.
    if (Number.isFinite(sold)) counts.set(item.id, { ...entry(item.id), sold, rap: rap ?? entry(item.id).rap });
    // A copy was just issued, so this tab's copy list is stale.
    copies.delete(item.id);
  }
  notify();
  return Number(result.held) || 1;
}

/** Views re-read the ledger after a purchase so cards and the detail panel agree. */
export function onSoldChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.warn('[catalog] Copy-count listener failed:', e);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Resale
 *
 * Limited runs can sell out and still be buyable, because a player who
 * is done with their copy can list it. Everything here is limited-only:
 * an unlimited item has no scarcity to arbitrage, and the reference
 * hides the marketplace for those too.
 * ------------------------------------------------------------------ */

/** itemId -> copies[] */
const copies = new Map();

/**
 * The marketplace's cut is the seller's, so the seller sets the price they want to
 * receive and the fee comes out of it. Floor rather than round, so the platform
 * never pays out a fraction of a Bux and rounding can never favour the seller.
 */
export function sellerPayout(price) {
  return Math.floor((Number(price) * 80) / 100);
}

/** The fee taken out of a sale price. */
export function marketplaceFee(price) {
  return Number(price) - sellerPayout(price);
}

export function copiesOf(id) {
  return copies.get(id) || [];
}

/**
 * Copies of this item currently listed for sale, cheapest first.
 *
 * Sorted on price so callers can take [0] as the best offer without sorting again,
 * and filtered to exclude the viewer's own listings: you cannot buy your own copy,
 * and showing it to you would advertise a price you set yourself.
 */
export function listingsFor(item, uid) {
  if (!item?.limited) return [];
  return copiesOf(item.id)
    .filter(copy => copy.listedPrice > 0 && copy.owner !== uid)
    .sort((a, b) => a.listedPrice - b.listedPrice);
}

/** Serials this player holds, so the sell form can offer them. */
export function serialsFor(item, uid) {
  if (!item?.limited || !uid) return [];
  return copiesOf(item.id)
    .filter(copy => copy.owner === uid)
    .sort((a, b) => a.serial - b.serial);
}

/**
 * The cheapest way to get this item, which is what the reference calls Best Price.
 *
 * A cheaper listing always wins over buying from the run, because the run charges
 * the original price. Null for anything that cannot be obtained at all: no stock
 * left and nothing listed. Non-limited items return null because the reference
 * shows no Best Price for them.
 */
export function bestOffer(item, uid) {
  if (!item?.limited) return null;
  const [cheapest] = listingsFor(item, uid);
  const buyable = !item.off_sale && remaining(item) > 0;
  if (cheapest && (!buyable || cheapest.listedPrice < Number(item.price))) {
    return { resale: true, price: cheapest.listedPrice, serial: cheapest.serial };
  }
  if (buyable) return { resale: false, price: Number(item.price), serial: null };
  return null;
}

/**
 * Read every copy of an item.
 *
 * Runs are small (a limited edition is a few hundred copies at most) so the whole
 * subcollection is read in one pass rather than queried per user or per listing.
 * The copy ledger is only loaded for the item being looked at, not for the whole
 * catalog, so browsing stays one document per limited item.
 */
// Items whose last copy read failed, so a view can say so instead of showing an
// empty marketplace that looks the same as having nothing to sell.
const copyReadFailed = new Set();

export function copiesFailed(id) {
  return copyReadFailed.has(id);
}

export async function loadCopies(id, { force = false } = {}) {
  if (!id) return [];
  if (!force && copies.has(id)) return copies.get(id);
  try {
    const snap = await getDocs(collection(db, 'catalogStock', id, 'copies'));
    const list = snap.docs.map(copyDoc => {
      const data = copyDoc.data() || {};
      const listed = Number(data.listedPrice);
      return {
        serial: Number(copyDoc.id),
        owner: data.owner || '',
        ownerName: data.ownerName || '',
        price: Number(data.price) || 0,
        listedPrice: Number.isFinite(listed) && listed > 0 ? listed : null,
        listedAt: data.listedAt || null,
        relistAfter: Number(data.relistAfter) || 0,
      };
    }).sort((a, b) => a.serial - b.serial);
    copies.set(id, list);
    copyReadFailed.delete(id);
    return list;
  } catch (e) {
    copyReadFailed.add(id);
    // Not cached: a failed read has to be retried next time, or one blip would hide
    // the Sell button and every listing until the page was reloaded.
    console.warn('[catalog] Could not read copies:', id, e);
    return [];
  }
}

/** Drop the cached copies for an item, so the next read comes from Firestore. */
export function invalidateCopies(id) {
  copies.delete(id);
}

/**
 * When this copy becomes listable again, or 0 when it can be listed now.
 *
 * Read from the copy document rather than from the cached list because the hold is
 * set from a server timestamp at purchase time, which the cache does not know yet.
 */
export async function relistAvailableAt(id, serial) {
  const snap = await getDoc(doc(db, 'catalogStock', id, 'copies', String(serial)));
  if (!snap.exists()) throw new Error('That copy no longer exists.');
  return Number((snap.data() || {}).relistAfter) || 0;
}

/**
 * Put one of the player's own copies up for sale.
 *
 * The server checks the copy really is theirs, that it is not already listed, that
 * any hold has expired, and that the price is not below what they paid for it. None
 * of that can be checked on the client, because the client is the thing being
 * checked.
 */
export async function listCopy(item, uid, serial, price) {
  if (!item?.id || !uid) throw new Error('Cannot list a copy without an item and a user.');
  await trade('/api/catalog/resale/listings', {
    body: { itemId: item.id, serial: Number(serial), price: Number(price) },
  });
  invalidateCopies(item.id);
  notify();
}

/** Take one of the player's own listings back down. */
export async function cancelListing(item, uid, serial) {
  if (!item?.id || !uid) throw new Error('Cannot cancel a listing without an item and a user.');
  await trade(`/api/catalog/resale/listings/${encodeURIComponent(item.id)}/${Number(serial)}`, {
    method: 'DELETE',
  });
  invalidateCopies(item.id);
  notify();
}

/**
 * Buy a listed copy: the copy moves to the buyer and the seller is paid 80% of the
 * asking price.
 *
 * The run's sold count is not touched: the copy already left the run once, when it
 * was first sold, and a resale only changes who holds it. Giving the slot back would
 * let the run sell a brand new copy for every resale.
 *
 * The per-player ceiling is re-checked server-side, so somebody already holding their
 * limit cannot buy a cheap listing either.
 */
export async function buyListing(item, uid, serial) {
  if (!item?.id || !uid) throw new Error('Cannot buy a copy without an item and a user.');
  const result = await trade(
    `/api/catalog/resale/listings/${encodeURIComponent(item.id)}/${Number(serial)}/buy`,
    { body: { copiesPerUser: copiesPerUser(item) } },
  );

  invalidateCopies(item.id);
  // The sale moved RAP on the server, which sends the new figure back. The run's
  // sold count is unchanged by a resale, so only RAP is updated in the cache.
  const rap = Number(result.rap) > 0 ? Number(result.rap) : entry(item.id).rap;
  counts.set(item.id, { ...entry(item.id), rap });
  notify();
  return {
    held: Number(result.held) || 1,
    paid: Number(result.paid) || 0,
    payout: Number(result.payout) || 0,
    rap,
  };
}