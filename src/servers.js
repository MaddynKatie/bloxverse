import { db } from './firebase.js';
import {
  collection, doc, setDoc, deleteDoc, getDocs, query, where, orderBy,
  runTransaction, serverTimestamp, arrayUnion, onSnapshot,
} from 'firebase/firestore';

export const DEFAULT_MAX_PLAYERS = 10;

export function getServerMaxPlayers(game) {
  return (game && typeof game.maxPlayers === 'number' && game.maxPlayers > 0)
    ? game.maxPlayers
    : DEFAULT_MAX_PLAYERS;
}

/**
 * Atomically add a user to a specific server. Returns:
 *   { status: 'joined', serverId }
 *   { status: 'full', serverId }
 *   { status: 'notfound', serverId }
 *   { status: 'error' }
 */
export async function joinServer(serverId, uid, maxPlayers) {
  const ref = doc(db, 'servers', serverId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { status: 'notfound', serverId };
      const data = snap.data();
      const players = data.players || [];
      if (players.includes(uid)) return { status: 'joined', serverId };
      const cap = (typeof data.maxPlayers === 'number' && data.maxPlayers > 0)
        ? data.maxPlayers
        : (maxPlayers || DEFAULT_MAX_PLAYERS);
      if (players.length >= cap) return { status: 'full', serverId };
      tx.update(ref, {
        players: arrayUnion(uid),
        playerCount: players.length + 1,
        status: players.length + 1 >= cap ? 'full' : 'open',
        lastActive: serverTimestamp(),
      });
      return { status: 'joined', serverId };
    });
  } catch (e) {
    console.warn('[Servers] joinServer error:', e);
    return { status: 'error' };
  }
}

/**
 * Join an open server for this game, or create a new one if none are open.
 * Returns { status: 'joined', serverId, created? }.
 */
export async function findOrCreateServer(gameId, uid, maxPlayers) {
  try {
    const q = query(collection(db, 'servers'), where('gameId', '==', gameId));
    const snap = await getDocs(q);
    const candidates = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
    for (const s of candidates) {
      const cap = (typeof s.maxPlayers === 'number' && s.maxPlayers > 0)
        ? s.maxPlayers
        : (maxPlayers || DEFAULT_MAX_PLAYERS);
      if ((s.players || []).length >= cap) continue;
      const res = await joinServer(s.id, uid, cap);
      if (res.status === 'joined') return res;
    }
  } catch (e) {
    console.warn('[Servers] find open server error:', e);
  }
  const ref = doc(collection(db, 'servers'));
  await setDoc(ref, {
    gameId,
    players: [uid],
    playerCount: 1,
    maxPlayers: maxPlayers || DEFAULT_MAX_PLAYERS,
    status: (maxPlayers || DEFAULT_MAX_PLAYERS) > 1 ? 'open' : 'full',
    createdAt: serverTimestamp(),
    lastActive: serverTimestamp(),
  });
  return { status: 'joined', serverId: ref.id, created: true };
}

export async function enqueueForServer(serverId, uid, username) {
  try {
    await setDoc(doc(db, 'servers', serverId, 'queue', uid), {
      joinedAt: serverTimestamp(),
      username: username || '',
    });
    return true;
  } catch (e) {
    console.warn('[Servers] enqueue error:', e);
    return false;
  }
}

export async function dequeueFromServer(serverId, uid) {
  try {
    await deleteDoc(doc(db, 'servers', serverId, 'queue', uid));
  } catch (e) {}
}

/**
 * Remove a user from a server (and its queue). Deletes the server doc when empty.
 */
export async function leaveServer(serverId, uid) {
  if (!serverId || !uid) return;
  await dequeueFromServer(serverId, uid);
  const ref = doc(db, 'servers', serverId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const players = (data.players || []).filter(p => p !== uid);
      if (players.length === 0) {
        tx.delete(ref);
      } else {
        tx.update(ref, {
          players,
          playerCount: players.length,
          status: players.length >= (data.maxPlayers || DEFAULT_MAX_PLAYERS) ? 'full' : 'open',
          lastActive: serverTimestamp(),
        });
      }
    });
  } catch (e) {
    console.warn('[Servers] leaveServer error:', e);
  }
}

/**
 * Live server doc listener. Calls cb(null) if the server no longer exists.
 */
export function watchServer(serverId, cb) {
  return onSnapshot(doc(db, 'servers', serverId), (snap) => {
    if (snap.exists()) cb({ id: snap.id, ...snap.data() });
    else cb(null);
  }, () => cb(null));
}

/**
 * Live queue listener. cb({ position, total }) where position is 1-based or null.
 */
export function watchQueue(serverId, uid, cb) {
  return onSnapshot(query(collection(db, 'servers', serverId, 'queue'), orderBy('joinedAt', 'asc')), (snap) => {
    const docs = snap.docs;
    const idx = docs.findIndex(d => d.id === uid);
    cb({ position: idx === -1 ? null : idx + 1, total: docs.length, uids: docs.map(d => d.id) });
  }, () => cb({ position: null, total: 0, uids: [] }));
}
