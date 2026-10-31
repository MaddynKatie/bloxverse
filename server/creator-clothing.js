/**
 * Creator clothing API: list the caller's clothing, submit a new item for review,
 * edit it, and delete it.
 *
 * Routes:
 *   GET    /api/creator/clothing                 list the caller's items
 *   POST   /api/creator/clothing                 submit a new item for review
 *   PATCH  /api/creator/clothing/{id}            edit name, description, price, on sale
 *   POST   /api/creator/clothing/{id}/delete     delete the caller's item
 *
 * Data shape:
 *   creatorClothing/{itemId}  { name, type, description, imageUrl, price, onSale,
 *                               state, ownerId, createdAt, updatedAt }
 *
 * `state` is 'in_review' on submit. Approval moves an item to the catalog and is not
 * handled here yet, so nothing a creator submits goes on sale without that step.
 *
 * The image is uploaded to Cloudinary from the browser (the same unsigned upload the
 * catalog thumbnails use). The server only accepts a URL on this project's Cloudinary
 * account, so a creator cannot point an item at an arbitrary remote image.
 */
const { readJsonBody, send, requireUid, recordTransaction } = require('./http-util.js');

const UPLOAD_FEE = 10;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 1000;
const MIN_PRICE = 5;
const MAX_PRICE = 1000000;
const TYPES = new Set(['shirt', 'pants']);
const IMAGE_PREFIX = 'https://res.cloudinary.com/dvkbiobph/image/upload/';

function toItem(id, data) {
  return {
    id,
    name: data.name || '',
    description: data.description || '',
    type: data.type || '',
    state: data.state || 'in_review',
    price: Number(data.price) || 0,
    on_sale: data.onSale !== false,
    thumbnail: data.imageUrl || '',
  };
}

/** Validates the name, description, price and sale flag shared by submit and edit. */
function readFields(body, { requireName }) {
  const fields = {};
  if (body.name !== undefined || requireName) {
    const name = String(body.name || '').trim();
    if (!name) return { error: { status: 400, error: 'Enter a name for your clothing.', field: 'name' } };
    if (name.length > MAX_NAME) return { error: { status: 400, error: `Names can be at most ${MAX_NAME} characters.`, field: 'name' } };
    if (/[\u0000-\u001f\u007f]/.test(name)) return { error: { status: 400, error: 'Names cannot contain control characters.', field: 'name' } };
    fields.name = name;
  }
  if (body.description !== undefined || requireName) {
    const description = String(body.description || '').trim();
    if (description.length > MAX_DESCRIPTION) return { error: { status: 400, error: `Descriptions can be at most ${MAX_DESCRIPTION} characters.`, field: 'description' } };
    fields.description = description;
  }
  if (body.price !== undefined || requireName) {
    const price = Number(body.price);
    if (!Number.isInteger(price) || price < MIN_PRICE || price > MAX_PRICE) {
      return { error: { status: 400, error: `Price must be between ${MIN_PRICE} and ${MAX_PRICE.toLocaleString('en-US')}.`, field: 'price' } };
    }
    fields.price = price;
  }
  if (body.on_sale !== undefined || requireName) {
    fields.onSale = body.on_sale === undefined ? true : Boolean(body.on_sale);
  }
  return { fields };
}

async function handleCreatorClothing(admin, req, res, pathname) {
  res.setHeader('Cache-Control', 'private, no-store');
  const match = pathname.match(/^\/api\/creator\/clothing(?:\/([A-Za-z0-9_-]+)(\/delete)?)?$/);
  if (!match) return send(res, 404, { error: 'Not found.' });
  const itemId = match[1] || '';
  const isDelete = Boolean(match[2]);

  const allowed = itemId
    ? (isDelete ? req.method === 'POST' : req.method === 'PATCH')
    : (req.method === 'GET' || req.method === 'POST');
  if (!allowed) return send(res, 404, { error: 'Not found.' });

  let uid;
  try {
    uid = await requireUid(admin, req);
  } catch (error) {
    return send(res, error.status || 401, { error: error.message });
  }

  const items = admin.firestore().collection('creatorClothing');

  // Loads an item owned by the caller. Returns null when it is missing or belongs to someone else.
  async function ownedItem() {
    const snap = await items.doc(itemId).get();
    if (!snap.exists || snap.data().ownerId !== uid) return null;
    return snap;
  }

  if (!itemId && req.method === 'GET') {
    try {
      const [snap, profile] = await Promise.all([
        items.where('ownerId', '==', uid).get(),
        admin.firestore().collection('users').doc(uid).get(),
      ]);
      const list = snap.docs
        .map(doc => ({ doc, created: doc.data().createdAt }))
        .sort((a, b) => (b.created && b.created.toMillis ? b.created.toMillis() : 0) - (a.created && a.created.toMillis ? a.created.toMillis() : 0))
        .map(({ doc }) => toItem(doc.id, doc.data()));
      return send(res, 200, { items: list, balance: Number(profile.get('bux')) || 0, uploadFee: UPLOAD_FEE });
    } catch (error) {
      console.warn('[creator] list clothing failed:', error.message);
      return send(res, 500, { error: 'Could not load your clothing. Please try again.' });
    }
  }

  let body;
  try {
    body = isDelete ? {} : await readJsonBody(req);
  } catch (error) {
    return send(res, 400, { error: error.message });
  }

  if (isDelete) {
    try {
      const snap = await ownedItem();
      if (!snap) return send(res, 404, { error: 'That item does not exist or you do not own it.' });
      await snap.ref.delete();
      return send(res, 200, { ok: true });
    } catch (error) {
      console.warn('[creator] delete clothing failed:', error.message);
      return send(res, 500, { error: 'Could not delete that item. Please try again.' });
    }
  }

  if (itemId) {
    const { fields, error } = readFields(body, { requireName: false });
    if (error) return send(res, error.status, { error: error.error, field: error.field });
    try {
      const snap = await ownedItem();
      if (!snap) return send(res, 404, { error: 'That item does not exist or you do not own it.' });
      const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (fields.name !== undefined) update.name = fields.name;
      if (fields.description !== undefined) update.description = fields.description;
      if (fields.price !== undefined) update.price = fields.price;
      if (fields.onSale !== undefined) update.onSale = fields.onSale;
      await snap.ref.update(update);
      const merged = { ...snap.data(), ...update };
      return send(res, 200, toItem(itemId, merged));
    } catch (error) {
      console.warn('[creator] edit clothing failed:', error.message);
      return send(res, 500, { error: 'Could not save your changes. Please try again.' });
    }
  }

  const { fields, error } = readFields(body, { requireName: true });
  if (error) return send(res, error.status, { error: error.error, field: error.field });

  const type = String(body.type || '');
  if (!TYPES.has(type)) return send(res, 400, { error: 'Choose a shirt or pants.', field: 'type' });

  const imageUrl = String(body.imageUrl || '');
  if (!imageUrl.startsWith(IMAGE_PREFIX)) return send(res, 400, { error: 'Upload an image first.', field: 'image' });

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const itemRef = items.doc();
  const record = {
    name: fields.name,
    type,
    description: fields.description,
    imageUrl,
    price: fields.price,
    onSale: fields.onSale,
    state: 'in_review',
    ownerId: uid,
    createdAt: now,
    updatedAt: now,
  };
  let balance;
  try {
    // The fee and the item are one transaction: a player is never charged for an item
    // that was not written, and an item is never written without its fee.
    balance = await db.runTransaction(async txn => {
      const userRef = db.collection('users').doc(uid);
      const user = await txn.get(userRef);
      const current = Number(user.get('bux')) || 0;
      if (current < UPLOAD_FEE) {
        throw Object.assign(new Error('insufficient_bux'), { status: 402 });
      }
      txn.create(itemRef, record);
      txn.update(userRef, { bux: current - UPLOAD_FEE });
      return current - UPLOAD_FEE;
    });
  } catch (error) {
    if (error.status === 402) {
      return send(res, 402, { error: `You need ${UPLOAD_FEE} Bux to upload. Earn more and try again.`, code: 'insufficient_bux' });
    }
    console.warn('[creator] submit clothing failed:', error.message);
    return send(res, 500, { error: 'Could not submit your clothing. Please try again.' });
  }

  // Written after the transaction so a history failure cannot undo the upload.
  await recordTransaction(db, uid, -UPLOAD_FEE, balance, 'Clothing', `Uploaded ${fields.name}`, { itemId: itemRef.id });
  return send(res, 201, { ...toItem(itemRef.id, record), balance });
}

module.exports = { handleCreatorClothing };
