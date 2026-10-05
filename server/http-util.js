/**
 * Small HTTP and Firestore helpers shared by the API modules.
 *
 * These live here rather than in one feature module because more than one feature
 * needs them: catalog-trading.js and groups.js both authenticate a caller from a
 * bearer token, read a JSON body, answer with JSON, and append to a player's
 * transaction history. Keeping one copy means the auth and history behaviour cannot
 * drift apart between endpoints.
 */

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Resolve the caller from the Authorization header.
 *
 * Returns the uid, or throws with a status the route should answer. A token that
 * fails verification is never treated as anonymous-but-allowed: these routes all
 * move value, so there is no unauthenticated path through them.
 */
async function requireUid(admin, req) {
  if (!admin) throw Object.assign(new Error('Server cannot reach Firestore.'), { status: 503 });
  const header = String(req.headers.authorization || '');
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Sign in to do that.'), { status: 401 });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch (e) {
    throw Object.assign(new Error('Your session expired. Sign in again.'), { status: 401 });
  }
}

/**
 * The caller's uid when one can be established, or null.
 *
 * For routes that are readable signed out but personalise when signed in. The explore
 * listing uses it: a signed-in player gets the groups they are already in filtered out,
 * and a signed-out visitor gets everything. A missing, malformed or expired token is
 * all the same as no token, because failing a public read on a stale token would show
 * an error to someone who is allowed to see the page.
 */
async function optionalUid(admin, req) {
  if (!admin) return null;
  const header = String((req.headers && req.headers.authorization) || '');
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    return (await admin.auth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

/**
 * Record a movement in the player's transaction history.
 *
 * Written on the server rather than by the client, because the client no longer
 * performs the movement: a purchase, a sale or a group creation is settled here, so
 * the history has to be written from the same place or the two can disagree. The
 * shape matches logTransaction in src/firebase.js, which is what the history views
 * read, plus the optional itemId and otherUserId the transactions page uses.
 */
async function recordTransaction(db, userId, amount, balance, source, description, extra = {}) {
  try {
    await db.collection('transactions').add({
      userId,
      amount,
      balance,
      source,
      description,
      createdAt: new Date().toISOString(),
      // Optional: the item the line is about (for its thumbnail) and the other player
      // in a trade (for their avatar and name). Lines written before these existed
      // simply lack them, and the history falls back to the description.
      ...(extra.itemId ? { itemId: extra.itemId } : {}),
      ...(extra.otherUserId ? { otherUserId: extra.otherUserId } : {}),
    });
  } catch (e) {
    // The money has already moved; failing to write the history line must not fail the
    // action, or the player would be charged for something they never received.
    console.warn('[history] Could not record transaction:', e.message);
  }
}

module.exports = { readJsonBody, send, requireUid, optionalUid, recordTransaction };