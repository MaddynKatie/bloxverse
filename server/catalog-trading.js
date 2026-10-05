/**
 * Catalog trading: original purchases and resale settlement for limited runs.
 *
 * The client never moves a copy and never moves Bux. It asks for an outcome and this
 * module decides it, using the Admin SDK, which is not subject to the security
 * rules. That split is the whole point:
 *
 *  - A sale has to debit one player and credit another in one atomic step, and
 *    security rules cannot express that. They evaluate each document on its own and
 *    their get() calls see pre-transaction state, so a rule can confirm a buyer has
 *    the Bux but never that the Bux actually left.
 *  - The copy ledger is only safe if this module is its only writer. A client able
 *    to create a copy document could invent one and list it, and the next buyer
 *    would pay real Bux for a copy that never existed.
 *
 * So even an ordinary purchase goes through here. The client cannot be trusted with
 * the price either: it sends an item id and this looks the real price up in the
 * catalog, or a modified client could buy a hat for one Bux.
 *
 * Endpoints, matching the reference's shape:
 *   POST   /api/catalog/purchase                            { itemId }
 *   POST   /api/catalog/resale/listings                     { itemId, serial, price }
 *   DELETE /api/catalog/resale/listings/:itemId/:serial
 *   POST   /api/catalog/resale/listings/:itemId/:serial/buy  { copiesPerUser }
 *
 * Ownership lives in catalogStock/{itemId}/copies/{serial}. Clients may read those
 * documents but never write them (see firestore.rules).
 */
const { getCatalog } = require('./catalog.js');
const { readJsonBody, send, requireUid, recordTransaction } = require('./http-util.js');

const RELIST_HOLD_MS = 7 * 24 * 60 * 1000;

/** The seller sets the price they receive; the marketplace fee comes out of it. */
function sellerPayout(price) {
  return Math.floor((price * 80) / 100);
}

/**
 * What a player already holds of an item.
 *
 * ownedCopies is the count, but a player who owned an item before ownedCopies
 * existed has no entry for it while still holding one, so a missing entry falls back
 * to whether the id is in ownedItems. Without that a legacy holder would appear to
 * hold none and be able to exceed their ceiling.
 */
function heldCopies(profile, itemId) {
  const registry = (profile && profile.ownedCopies) || {};
  const counted = Number(registry[itemId]);
  if (Number.isFinite(counted) && counted > 0) return counted;
  const owned = (profile && profile.ownedItems) || [];
  return owned.includes(itemId) ? 1 : 0;
}

/**
 * RAP (recent average price), the way Roblox does it.
 *
 * Only resales move it: an original purchase is the run's own price, not a market
 * signal. The first resale sets it to the sale price, and every later one pulls it
 * 10% of the way toward that sale, so one outlier barely moves it while a real
 * trend does. The unrounded figure is carried in rapExact because rounding it every
 * step would stall the average on cheap items, where 10% of the gap is under a Bux.
 */
const RAP_WEIGHT = 0.1;

function nextRap(stock, price) {
  const resales = Number(stock.rapResales) || 0;
  const exactBefore = Number(stock.rapExact);
  const previous = Number.isFinite(exactBefore) && exactBefore > 0 ? exactBefore : Number(stock.rap);
  const exact = resales > 0 && Number.isFinite(previous) && previous > 0
    ? previous + (price - previous) * RAP_WEIGHT
    : price;
  return { rap: Math.max(1, Math.round(exact)), rapExact: exact, rapResales: resales + 1 };
}

/**
 * Find an item by id across every category in the catalog.
 *
 * The response carries more than category lists -- source, version, generatedAt and
 * errors -- so only the arrays are walked. Iterating every value blindly throws on
 * the first non-array it reaches, which is the version number.
 */
async function findItem(cloudinary, itemId) {
  const catalog = await getCatalog(cloudinary);
  for (const list of Object.values(catalog || {})) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && item.id === itemId) return item;
    }
  }
  return null;
}

/**
 * Buy one copy from the run at its published price.
 *
 * The price, the run size and the copy ceiling all come from the catalog and the
 * run document, never from the request. Everything is re-read inside the
 * transaction so two players racing for the last copy cannot both win, and so an
 * admin's resize takes effect on the next purchase.
 */
async function purchase(admin, cloudinary, res, uid, body) {
  const itemId = String(body.itemId || '');
  if (!itemId) return send(res, 400, { error: 'Missing item.' });

  // Outside the transaction: the first call after a cold cache reaches Cloudinary.
  const item = await findItem(cloudinary, itemId);
  if (!item) {
    // An item that is genuinely absent and a catalog the server could not read look
    // identical from here, and they need different fixes, so they get different
    // messages. The detail page surfaces this verbatim.
    const catalog = await getCatalog(cloudinary).catch(() => null);
    if (catalog && catalog.source === 'unconfigured') {
      return send(res, 503, { error: catalog.error || 'This server cannot read the item catalog right now.' });
    }
    if (catalog && catalog.errors) {
      const [key, reason] = Object.entries(catalog.errors)[0] || [];
      return send(res, 503, { error: `This server cannot read the item catalog right now (${key}: ${reason}).` });
    }
    return send(res, 404, { error: 'That item is not in the catalog.' });
  }
  if (item.off_sale) return send(res, 409, { error: 'That item is off sale.' });

  const price = Math.max(0, Math.floor(Number(item.price) || 0));
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;
  const userRef = db.collection('users').doc(uid);
  const stockRef = db.collection('catalogStock').doc(itemId);
  const limited = !!item.limited;

  let result;
  try {
    result = await db.runTransaction(async txn => {
      const [userSnap, stockSnap] = await Promise.all([txn.get(userRef), txn.get(stockRef)]);
      const profile = userSnap.data() || {};
      const stock = stockSnap.data() || {};
      const heldBefore = heldCopies(profile, itemId);

      // A Firestore override wins over the context value, which is how a run is
      // resized without re-uploading the asset.
      const ceiling = Math.max(1, Number(stock.copies) || Math.floor(Number(item.copies_per_user)) || 1);
      if (heldBefore >= ceiling) {
        throw Object.assign(new Error('You already own every copy you are allowed.'), { status: 409, code: 'already_owned' });
      }
      if (price > 0 && Number(profile.bux) < price) {
        throw Object.assign(new Error('You do not have enough Bux.'), { status: 402, code: 'no_bux' });
      }

      const patch = {};
      if (limited) {
        const sold = Number(stock.sold) || 0;
        const next = sold + 1;
        const baseline = Number.isFinite(Number(stock.stock))
          ? Number(stock.stock)
          : (Number.isFinite(Number(item.stock))
            ? Number(item.stock)
            : (Number.isFinite(Number(item.total_stock)) ? Number(item.total_stock) : Infinity));
        if (Number.isFinite(baseline) && next > baseline) {
          throw Object.assign(new Error('This limited item is sold out.'), { status: 409, code: 'sold_out' });
        }

        patch.sold = next;
        // Carried through rather than dropped, so an admin's overrides survive.
        if (stock.stock !== undefined && stock.stock !== null) patch.stock = stock.stock;
        if (stock.copies !== undefined && stock.copies !== null) patch.copies = stock.copies;

        txn.set(stockRef, patch, { merge: true });
        // A copy bought from the run is listable straight away. Only a copy that
        // came off the secondary market gets the hold, which is what stops somebody
        // buying and relisting all day to nudge the visible price.
        txn.set(stockRef.collection('copies').doc(String(next)), {
          owner: uid,
          ownerName: profile.username || '',
          price: price || null,
          acquiredAt: Date.now(),
          relistAfter: 0,
        });
      }

      const held = heldBefore + 1;
      const userPatch = {
        ownedItems: FieldValue.arrayUnion(itemId),
        ownedCopies: { ...(profile.ownedCopies || {}), [itemId]: held },
      };
      if (price > 0) userPatch.bux = FieldValue.increment(-price);
      txn.update(userRef, userPatch);

      // The resulting balance is known here because the user document was read in
      // this transaction, which is what the history line records as the new balance.
      return { held, price, sold: patch.sold, rap: Number(stock.rapResales) > 0 ? stock.rap : null, name: item.name, balance: Number(profile.bux) - price };
    });
  } catch (e) {
    return send(res, e.status || 500, { code: e.code || null, error: e.message || 'Could not buy that item.' });
  }

  if (price > 0) {
    await recordTransaction(db, uid, -price, result.balance, 'Catalog', `Bought ${result.name || itemId}`, { itemId });
  }
  return send(res, 200, { ok: true, ...result });
}

/** Put one of the caller's copies up for sale. */
async function listCopy(admin, res, uid, itemId, serial, body) {
  const asking = Math.floor(Number(body.price));
  if (!Number.isFinite(asking) || asking < 1) {
    return send(res, 400, { error: 'Enter a price of at least 1 Bux.' });
  }

  const db = admin.firestore();
  const copyRef = db.collection('catalogStock').doc(itemId).collection('copies').doc(String(serial));

  try {
    await db.runTransaction(async txn => {
      const snap = await txn.get(copyRef);
      if (!snap.exists) throw Object.assign(new Error('That copy no longer exists.'), { status: 404 });
      const copy = snap.data() || {};
      if (copy.owner !== uid) throw Object.assign(new Error('You can only list copies you own.'), { status: 403 });
      if (copy.listedPrice) throw Object.assign(new Error('That copy is already listed.'), { status: 409 });

      const readyAt = Number(copy.relistAfter) || 0;
      if (readyAt > Date.now()) {
        throw Object.assign(new Error('That copy has to stay with you for a while before you can list it.'), { status: 409 });
      }

      // The floor is what this copy cost. The reference has no floor at all, which
      // lets anybody dump a run at 1 Bux and take the whole market with it; not
      // being able to sell at a loss is a much smaller problem than that.
      const paid = Number(copy.price) || 0;
      if (paid > 0 && asking < paid) {
        throw Object.assign(new Error(`List it for at least ${paid} Bux.`), { status: 400 });
      }

      txn.update(copyRef, {
        listedPrice: asking,
        listedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    return send(res, e.status || 500, { code: e.code || null, error: e.message || 'Could not list that copy.' });
  }

  return send(res, 200, { ok: true, serial: Number(serial), price: asking });
}

/** Take one of the caller's own listings back down. */
async function cancelListing(admin, res, uid, itemId, serial) {
  const db = admin.firestore();
  const copyRef = db.collection('catalogStock').doc(itemId).collection('copies').doc(String(serial));

  try {
    await db.runTransaction(async txn => {
      const snap = await txn.get(copyRef);
      if (!snap.exists) throw Object.assign(new Error('That copy no longer exists.'), { status: 404 });
      const copy = snap.data() || {};
      if (copy.owner !== uid) throw Object.assign(new Error('You can only cancel your own listings.'), { status: 403 });
      txn.update(copyRef, { listedPrice: null, listedAt: null });
    });
  } catch (e) {
    return send(res, e.status || 500, { code: e.code || null, error: e.message || 'Could not cancel that listing.' });
  }

  return send(res, 200, { ok: true, serial: Number(serial) });
}

/**
 * Buy a listed copy.
 *
 * The copy moves to the buyer, the buyer is charged the asking price, the seller is
 * paid 80% of it, and the sale is folded into the item's RAP. The run's sold count
 * does not change: the copy already left the run when it was first bought, and a
 * resale only changes who holds it. All of it inside one transaction, so two buyers racing for the same listing cannot both win and a
 * half-finished sale cannot exist.
 *
 * The per-player ceiling is re-checked here rather than trusted from the client:
 * somebody already holding their limit can still find a cheap listing.
 */
async function buyListing(admin, cloudinary, res, uid, itemId, serial, body) {
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;
  const stockRef = db.collection('catalogStock').doc(itemId);
  const copyRef = stockRef.collection('copies').doc(String(serial));
  // Read outside the transaction: a transaction cannot await anything once it has
  // started writing, and the catalog may have to reach Cloudinary on a cold cache.
  const item = await findItem(cloudinary, itemId);
  const itemName = (item && item.name) || itemId;

  let result;
  try {
    result = await db.runTransaction(async txn => {
      const copySnap = await txn.get(copyRef);
      if (!copySnap.exists) throw Object.assign(new Error('That listing is gone.'), { status: 404 });
      const copy = copySnap.data() || {};
      const price = Number(copy.listedPrice);
      if (!(price > 0)) throw Object.assign(new Error('That listing is no longer available.'), { status: 409 });

      const seller = copy.owner;
      if (!seller || seller === uid) throw Object.assign(new Error('You cannot buy your own listing.'), { status: 400 });

      // Every read before the first write.
      const buyerRef = db.collection('users').doc(uid);
      const sellerRef = db.collection('users').doc(seller);
      const [buyerSnap, sellerSnap, stockSnap] = await Promise.all([
        txn.get(buyerRef),
        txn.get(sellerRef),
        txn.get(stockRef),
      ]);

      const buyer = buyerSnap.data() || {};
      const heldBefore = heldCopies(buyer, itemId);
      const stock = stockSnap.data() || {};
      const ceiling = Math.max(1, Number(stock.copies) || Math.floor(Number(body.copiesPerUser)) || 1);
      if (heldBefore >= ceiling) {
        throw Object.assign(new Error('You already own every copy you are allowed.'), { status: 409, code: 'already_owned' });
      }
      if (Number(buyer.bux) < price) throw Object.assign(new Error('You do not have enough Bux.'), { status: 402, code: 'no_bux' });

      const sellerProfile = sellerSnap.data() || {};
      const sellerRegistry = (sellerProfile.ownedCopies) || {};
      const sellerHeld = Math.max(0, heldCopies(sellerProfile, itemId) - 1);
      // The sale folds into RAP inside the transaction, so two sales landing
      // together cannot both read the same old average and lose one.
      const rapPatch = nextRap(stock, price);
      // `sold` is deliberately not touched: a resale moves an existing copy between
      // players, it does not return one to the run, so the run's stock is unchanged.
      txn.set(stockRef, rapPatch, { merge: true });

      txn.update(copyRef, {
        owner: uid,
        ownerName: buyer.username || '',
        price,
        acquiredAt: Date.now(),
        relistAfter: Date.now() + RELIST_HOLD_MS,
        listedPrice: null,
        listedAt: null,
      });

      const held = heldBefore + 1;
      txn.update(buyerRef, {
        ownedItems: FieldValue.arrayUnion(itemId),
        ownedCopies: { ...(buyer.ownedCopies || {}), [itemId]: held },
        bux: FieldValue.increment(-price),
      });

      txn.update(sellerRef, {
        ownedCopies: { ...sellerRegistry, [itemId]: sellerHeld },
        bux: FieldValue.increment(sellerPayout(price)),
        // At zero copies the id has to leave ownedItems too, or the seller keeps
        // showing the item in their inventory and on their avatar.
        ...(sellerHeld === 0 ? { ownedItems: FieldValue.arrayRemove(itemId) } : {}),
      });

      return {
        serial: Number(serial),
        paid: price,
        payout: sellerPayout(price),
        held,
        sellerHeld,
        seller,
        rap: rapPatch.rap,
        buyerBalance: Number(buyer.bux) - price,
        sellerBalance: Number(sellerProfile.bux) + sellerPayout(price),
      };
    });
  } catch (e) {
    return send(res, e.status || 500, { code: e.code || null, error: e.message || 'Could not buy that copy.' });
  }

  // Both sides of the trade get a history line: the buyer paid full price, the seller
  // received the price less the marketplace fee.
  await Promise.all([
    recordTransaction(db, uid, -result.paid, result.buyerBalance, 'Marketplace', `Bought ${itemName} #${result.serial}`, { itemId, otherUserId: result.seller }),
    recordTransaction(db, result.seller, result.payout, result.sellerBalance, 'Marketplace', `Sold ${itemName} #${result.serial}`, { itemId, otherUserId: uid }),
  ]);

  return send(res, 200, { ok: true, ...result });
}

/**
 * Route a resale request. Returns true when it handled one, so the caller can fall
 * through to its other routes.
 */
async function handleResale(admin, cloudinary, req, res, pathname, method) {
  if (!pathname.startsWith('/api/catalog/resale/') && pathname !== '/api/catalog/purchase') {
    return false;
  }

  try {
    return await route(admin, cloudinary, req, res, pathname, method);
  } catch (e) {
    // requireUid throws for an absent or expired token, which happens before any
    // handler has a chance to catch it.
    if (!res.headersSent) send(res, e.status || 500, { code: e.code || null, error: e.message || 'Trading request failed.' });
    return true;
  }
}

async function route(admin, cloudinary, req, res, pathname, method) {
  // POST /api/catalog/purchase
  if (pathname === '/api/catalog/purchase') {
    if (method !== 'POST') {
      send(res, 405, { error: 'Method not allowed.' });
      return true;
    }
    const body = await readJsonBody(req);
    if (!body.itemId) {
      send(res, 400, { error: 'Missing item.' });
      return true;
    }
    const uid = await requireUid(admin, req);
    await purchase(admin, cloudinary, res, uid, body);
    return true;
  }

  // POST /api/catalog/resale/listings
  if (pathname === '/api/catalog/resale/listings') {
    if (method !== 'POST') {
      send(res, 405, { error: 'Method not allowed.' });
      return true;
    }
    const body = await readJsonBody(req);
    const { itemId, serial } = body;
    if (!itemId || !Number.isFinite(Number(serial))) {
      send(res, 400, { error: 'Missing item or serial.' });
      return true;
    }
    const uid = await requireUid(admin, req);
    await listCopy(admin, res, uid, String(itemId), Number(serial), body);
    return true;
  }

  // /api/catalog/resale/listings/:itemId/:serial[/buy]
  const rest = pathname.replace('/api/catalog/resale/listings/', '');
  const [rawItem, rawSerial, action] = rest.split('/');
  if (!rawItem || !rawSerial || !Number.isFinite(Number(rawSerial))) return false;
  const itemId = decodeURIComponent(rawItem);
  const serial = Number(rawSerial);
  const uid = await requireUid(admin, req);

  if (action === 'buy') {
    if (method !== 'POST') {
      send(res, 405, { error: 'Method not allowed.' });
      return true;
    }
    await buyListing(admin, cloudinary, res, uid, itemId, serial, await readJsonBody(req));
    return true;
  }
  if (!action) {
    if (method !== 'DELETE') {
      send(res, 405, { error: 'Method not allowed.' });
      return true;
    }
    await cancelListing(admin, res, uid, itemId, serial);
    return true;
  }

  send(res, 404, { error: 'Unknown resale route.' });
  return true;
}

module.exports = { handleResale, sellerPayout, RELIST_HOLD_MS };