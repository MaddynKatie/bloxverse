/**
 * Creator games API: create a game from the web Create page.
 *
 * Data shape:
 *   creatorGames/{gameId}  { name, description, ownerId, createdAt, updatedAt }
 *
 * Kept apart from the `games` collection, which holds play data (per-game players
 * and stats), so creator records never mix with live game state.
 */
const { readJsonBody, send, requireUid } = require('./http-util.js');

const MAX_NAME = 80;
const MAX_DESCRIPTION = 1000;

async function handleCreatorGames(admin, req, res, pathname) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (pathname !== '/api/creator/games' || req.method !== 'POST') {
    return send(res, 404, { error: 'Not found.' });
  }
  let uid;
  try {
    uid = await requireUid(admin, req);
  } catch (error) {
    return send(res, error.status || 401, { error: error.message });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return send(res, 400, { error: error.message });
  }

  const name = String(body.name || '').trim();
  if (!name) return send(res, 400, { error: 'Enter a game name.', field: 'name' });
  if (name.length > MAX_NAME) return send(res, 400, { error: `Game names can be at most ${MAX_NAME} characters.`, field: 'name' });
  if (/[\u0000-\u001f\u007f]/.test(name)) return send(res, 400, { error: 'Game names cannot contain control characters.', field: 'name' });

  const description = String(body.description == null ? '' : body.description).trim().slice(0, MAX_DESCRIPTION);
  const now = admin.firestore.FieldValue.serverTimestamp();
  try {
    const db = admin.firestore();
    const counterRef = db.collection('creatorCounters').doc('creatorGames');
    // Sequential IDs (1, 2, 3...) come from a counter bumped in the same transaction.
    const id = await db.runTransaction(async tx => {
      const counter = await tx.get(counterRef);
      const next = (counter.exists ? Number(counter.data().next) || 0 : 0) + 1;
      tx.set(counterRef, { next });
      tx.set(db.collection('creatorGames').doc(String(next)), {
        name,
        description,
        ownerId: uid,
        createdAt: now,
        updatedAt: now,
      });
      return String(next);
    });
    return send(res, 201, { id, name, description });
  } catch (error) {
    console.warn('[creator] create game failed:', error.message);
    return send(res, 500, { error: 'Could not create the game. Please try again.' });
  }
}

module.exports = { handleCreatorGames };
