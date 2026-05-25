import { sitePath } from './paths.js';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, getDoc, deleteDoc, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment, collection, getDocs, query, where } from 'firebase/firestore';
import { ProfanityFilter } from 'glin-profanity';

const _filter = new ProfanityFilter({
  detectLeetspeak: true,
  leetspeakLevel: 'moderate',
  normalizeUnicode: true,
  allLanguages: true,
  wordBoundaries: true,
  allowObfuscatedMatch: true,
  fuzzyToleranceLevel: 0.8
});

export function isProfane(text) {
  if (!text) return false;
  return _filter.checkProfanity(text).containsProfanity;
}

export function maskProfanity(text) {
  if (!text) return text;
  const result = _filter.checkProfanity(text);
  if (!result.containsProfanity) return text;
  let cleaned = text;
  const leetMap = {
    'a': '[aA4@\u00C0-\u00C5\u0430\u03B1\u0250]', 
    'b': '[bB8\u03B2\u0299]', 
    'c': '[cC(<{\u00A2\u0441\u03C2\u03BF\u0254]',
    'd': '[dD|)]',
    'e': '[eE3\u00E8-\u00EB\u0435\u03B5\u01DD]',
    'g': '[gG69]',
    'h': '[hH#\u0445\u0265]',
    'i': '[iI1!|!\u00EC-\u00EF\u0456\u03B9\u0131]',
    'l': '[lL1|!|_]',
    'o': '[oO0\u00F2-\u00F6\u043E\u03BF\u03F5\u0251]',
    'p': '[pP\u00FE\u0440\u03C1]',
    's': '[sS5$]',
    't': '[tT7+\u2020\u0164\u0165\u0287]',
    'u': '[uUvV\u00F9-\u00FC\u0443\u03BC\u028C]',
    'x': '[xX%*]',
    'z': '[zZ2\u0240]'
  };
  result.profaneWords.forEach(word => {
    const pattern = word.split('').map(c => {
      const l = c.toLowerCase();
      return (leetMap[l] || l) + '[\\s._\\-*]*';
    }).join('');
    const regex = new RegExp(pattern, "gi");
    cleaned = cleaned.replace(regex, (m) => '*'.repeat(m.length));
  });
  return cleaned;
}

const firebaseConfig = {
  apiKey: "AIzaSyA-4DyZMqHgMCme2-hicVg4AV5ax-_fnmY",
  authDomain: "bloxverse-154b2.firebaseapp.com",
  projectId: "bloxverse-154b2",
  storageBucket: "bloxverse-154b2.firebasestorage.app",
  messagingSenderId: "209592007747",
  appId: "1:209592007747:web:e1ff36337655ff484568f6",
  measurementId: "G-273FC0DR2H"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { getDoc, doc, setDoc, deleteDoc, onSnapshot, collection } from 'firebase/firestore';

/**
 * Get a user's roles. Returns an array e.g. ['admin', 'developer'] or [].
 *
 * Firestore structure — collection: 'roles', document id: userId
 * { roles: ['admin', 'developer'] }
 */
export async function getRoles(userId) {
  try {
    const snap = await getDoc(doc(db, 'roles', userId));
    if (!snap.exists()) return [];
    const data = snap.data();
    // Support both old single 'role' string and new 'roles' array for migration
    if (data.roles) return Array.isArray(data.roles) ? data.roles : [data.roles];
    if (data.role) return [data.role];
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * Check if a user is currently banned.
 * Returns the ban document data if banned, or null if not banned.
 *
 * Firestore structure — collection: 'bans', document id: userId
 * {
 *   banned:        true,
 *   reason:        "Exploiting",           // shown in the reason box
 *   detail:        "Asset Name:XYZ",       // optional extra detail line
 *   moderatorNote: "Custom mod message",   // optional override of default note
 *   bannedAt:      Timestamp,              // when the ban was issued
 *   expiresAt:     Timestamp | null,       // null = permanent ban
 * }
 */
export async function checkBan(userId) {
  try {
    const snap = await getDoc(doc(db, 'bans', userId));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data.banned) return null;
    // If a timed ban has expired, treat as not banned
    if (data.expiresAt) {
      const expiry = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
      if (expiry <= new Date()) return null;
    }
    return data;
  } catch (e) {
    console.warn('[Ban] Could not check ban status:', e);
    return null;
  }
}

/**
 * Global ban guard. Checks if user is banned and redirects if necessary.
 * Call this in any page's auth listener.
 */
export async function banGuard(userId) {
  if (!userId) return false;
  const banData = await checkBan(userId);
  if (banData) {
    window.location.href = sitePath('ban.html');
    return true;
  }
  return false;
}

export function listenBux(userId, callback, username = null, email = null) {
  const userRef = doc(db, 'users', userId);
  return onSnapshot(userRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data()?.bux || 0);
    } else {
      // Create user doc with all fields if it doesn't exist
      setDoc(userRef, { bux: 0, username: username || 'Player', email: email || '', friends: [], following: [], followers: [], createdAt: new Date().toISOString() }, { merge: true });
      callback(0);
    }
  });
}

export function setBux(userId, amount) {
  return setDoc(doc(db, 'users', userId), { bux: amount }, { merge: true });
}

export function updateBux(userId, amount) {
  return updateDoc(doc(db, 'users', userId), { bux: amount });
}

export function trackPresence(userId, gameId) {
  const presenceRef = doc(db, 'presence', userId);

  function updatePresence(data) {
    return setDoc(presenceRef, { ...data, lastSeen: serverTimestamp() }, { merge: true });
  }

  const inGame = !!gameId;
  updatePresence({ online: true, inGame, gameId: inGame ? gameId : null });

  const cleanup = () => {
    updatePresence({ online: false, inGame: false, gameId: null });
  };
  window.addEventListener('beforeunload', cleanup);

  return {
    setInGame(inGame) {
      return updatePresence({ online: true, inGame, gameId: inGame ? gameId : null });
    },
    goOffline() {
      cleanup();
    }
  };
}

export async function incrementGameVisits(gameId) {
  const ref = doc(db, 'gameStats', gameId);
  await setDoc(ref, { visits: increment(1) }, { merge: true });
}

export async function getGameStats(gameId) {
  try {
    const snap = await getDoc(doc(db, 'gameStats', gameId));
    return snap.data() || { visits: 0 };
  } catch (e) {
    console.warn('Could not load game stats:', e);
    return { visits: 0 };
  }
}

const CLOUD_NAME = 'dvkbiobph';
const UPLOAD_PRESET = 'bloxverse_upload';

export async function uploadToCloudinary(jsonData, publicId) {
  // Sanitize filename: alphanumeric and underscores only
  const sanitized = (publicId || 'game').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const blob = new Blob([JSON.stringify(jsonData)], { type: 'application/json' });
  const formData = new FormData();
  formData.append('file', blob, sanitized + '.json');
  formData.append('upload_preset', UPLOAD_PRESET);
  if (publicId) formData.append('public_id', sanitized);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, {
    method: 'POST',
    body: formData,
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error?.message || 'Cloudinary upload failed');
  return result.secure_url;
}

export async function uploadSoundToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', 'bloxverse_upload'); // use the raw preset for audio
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, {
    method: 'POST',
    body: formData,
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error?.message || 'Cloudinary upload failed');
  return result.secure_url;
}

export async function publishGame(data) {
  if (isProfane(data.name) || isProfane(data.description)) {
    throw new Error('Profanity detected in game name or description. Please clean it up before publishing.');
  }
  // Upload map + scripts + lighting to Cloudinary
  const gameContent = data.gameContent || { parts: data.mapData || [], scripts: data.scripts || {} };
  const mapUrl = await uploadToCloudinary(gameContent, data.name);
  // Store only metadata in Firestore
  const ref = doc(collection(db, 'publishedGames'));
  await setDoc(ref, {
    name: data.name,
    description: data.description || '',
    category: data.category || 'User Created',
    authorId: data.authorId,
    authorName: data.authorName || 'Player',
    icon: data.icon || './assets/icons/demo.png',
    mapUrl,
    visits: 0,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function deleteGame(gameId, userId) {
  const ref = doc(db, 'publishedGames', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Game not found');
  if (snap.data().authorId !== userId) throw new Error('Not authorized');
  await deleteDoc(ref);
  // Also clean up game stats
  try { await deleteDoc(doc(db, 'gameStats', gameId)); } catch {}
}

export async function softDeleteGame(gameId) {
  const ref = doc(db, 'publishedGames', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Game not found');
  const data = snap.data();
  await updateDoc(ref, {
    _originalName: data.name,
    name: '[ Content Deleted ]',
    _originalDescription: data.description,
    description: '',
    deleted: true,
  });
}

export async function recoverGame(gameId) {
  const ref = doc(db, 'publishedGames', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Game not found');
  const data = snap.data();
  await updateDoc(ref, {
    name: data._originalName || data.name,
    description: data._originalDescription || '',
    deleted: false,
    _originalName: null,
    _originalDescription: null,
  });
}

export async function adminDeleteGame(gameId) {
  const ref = doc(db, 'publishedGames', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Game not found');
  await deleteDoc(ref);
  try { await deleteDoc(doc(db, 'gameStats', gameId)); } catch {}
}

export async function updateGame(gameId, userId, data) {
  const ref = doc(db, 'publishedGames', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Game not found');
  if (snap.data().authorId !== userId) throw new Error('Not authorized');
  const updateFields = {};
  if (data.name !== undefined) updateFields.name = data.name;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.category !== undefined) updateFields.category = data.category;
  if (data.icon !== undefined) updateFields.icon = data.icon;
  if (data.mapData !== undefined || data.scripts !== undefined) {
    // Re-upload game content to Cloudinary
    const existing = snap.data();
    const gameContent = {
      parts: data.mapData || existing.mapUrl ? null : [],
      scripts: data.scripts || {},
    };
    // If we have mapData, upload it; otherwise keep existing Cloudinary URL
    if (data.mapData !== undefined) {
      const mapUrl = await uploadToCloudinary(gameContent, 'blx_' + gameId);
      updateFields.mapUrl = mapUrl;
    }
  }
  if (Object.keys(updateFields).length === 0) return;
  await updateDoc(ref, updateFields);
}

export async function getPresenceCountForGame(gameId) {
  try {
    const q = query(collection(db, 'presence'), where('inGame', '==', true));
    const snap = await getDocs(q);
    let count = 0;
    snap.forEach(d => { if (d.data().gameId === gameId) count++; });
    return count;
  } catch (e) {
    console.warn('Could not count presence:', e);
    return 0;
  }
}

export async function getBux(userId) {
  const snap = await getDoc(doc(db, 'users', userId));
  return snap.data()?.bux || 0;
}

export async function followUser(followerId, followingId) {
  try {
    // Add to follower's following list
    await updateDoc(doc(db, 'users', followerId), {
      following: arrayUnion(followingId)
    });
    
    // Add to following user's followers list
    await updateDoc(doc(db, 'users', followingId), {
      followers: arrayUnion(followerId)
    });
    
    return true;
  } catch (e) {
    console.error('Error following user', e);
    return false;
  }
}

export async function unfollowUser(followerId, followingId) {
  try {
    // Remove from follower's following list
    await updateDoc(doc(db, 'users', followerId), {
      following: arrayRemove(followingId)
    });
    
    // Remove from following user's followers list
    await updateDoc(doc(db, 'users', followingId), {
      followers: arrayRemove(followerId)
    });
    
    return true;
  } catch (e) {
    console.error('Error unfollowing user', e);
    return false;
  }
}

export async function getFollowing(userId) {
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.data()?.following || [];
  } catch (e) {
    console.error('Error getting following', e);
    return [];
  }
}

export async function getFollowers(userId) {
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.data()?.followers || [];
  } catch (e) {
    console.error('Error getting followers', e);
    return [];
  }
}

export async function getUserProfile(userId) {
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error('Error getting user profile', e);
    return null;
  }
}

export function calculateAge(birthdayStr) {
  if (!birthdayStr) return 0;
  const [y, m, d] = birthdayStr.split('-').map(Number);
  const birth = new Date(y, m - 1, d);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export async function addTrustedFriend(userId, friendId) {
  try {
    await setDoc(doc(db, 'users', userId), {
      trustedFriends: arrayUnion(friendId)
    }, { merge: true });
  } catch (e) {
    console.error('Error adding trusted friend:', e);
    throw e;
  }
}

export async function removeTrustedFriend(userId, friendId) {
  try {
    await setDoc(doc(db, 'users', userId), {
      trustedFriends: arrayRemove(friendId)
    }, { merge: true });
  } catch (e) {
    console.error('Error removing trusted friend:', e);
    throw e;
  }
}
