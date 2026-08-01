const { WebSocketServer } = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const { GameServer } = require('./game-server.js');
let admin = null;
let cloudinary = null;

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyA-4DyZMqHgMCme2-hicVg4AV5ax-_fnmY';
const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';
const ACCOUNT_PURGE_SECRET = process.env.ACCOUNT_PURGE_SECRET || '';

try {
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
      let parsed = JSON.parse(serviceAccountJson);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      admin.initializeApp({ credential: admin.credential.cert(parsed) });
    } else {
      admin.initializeApp();
    }
  }
} catch (e) {
  console.warn('[AccountDeletion] Firebase Admin unavailable:', e.message);
  admin = null;
}

try {
  cloudinary = require('cloudinary').v2;
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ secure: true });
  } else if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  } else {
    cloudinary = null;
  }
} catch (e) {
  console.warn('[AccountDeletion] Cloudinary admin unavailable:', e.message);
  cloudinary = null;
}

// Recovery codes: 10 codes of form xxxxx-xxxxx (no ambiguous I/O/0/1)
const RECOVERY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_RE = /^[A-Z0-9]{5}-[A-Z0-9]{5}$/;

function generateRecoveryCodes(count) {
  const codes = [];
  const bytes = crypto.randomBytes(count * 10);
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 10; j++) {
      code += RECOVERY_CHARSET[bytes[i * 10 + j] % RECOVERY_CHARSET.length];
      if (j === 4) code += '-';
    }
    codes.push(code);
  }
  return codes;
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
}

function findRecoveryCode(code, hashes) {
  if (!Array.isArray(hashes)) return -1;
  const target = hashRecoveryCode(code.toUpperCase());
  return hashes.indexOf(target);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function cloudinaryPublicIdsFromUrl(assetUrl) {
  if (!assetUrl || typeof assetUrl !== 'string' || !assetUrl.includes('res.cloudinary.com')) return [];
  try {
    const parsed = new URL(assetUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return [];

    const resourceType = parts[1] || 'image';
    let publicParts = parts.slice(uploadIndex + 1);
    if (publicParts[0]?.startsWith('v') && /^\d+$/.test(publicParts[0].slice(1))) {
      publicParts = publicParts.slice(1);
    }
    if (!publicParts.length) return [];

    const publicIdWithExt = decodeURIComponent(publicParts.join('/'));
    const publicIdNoExt = publicIdWithExt.replace(/\.[^/.]+$/, '');
    const candidates = new Set([publicIdWithExt, publicIdNoExt]);
    return Array.from(candidates).map(publicId => ({ resourceType, publicId })).filter(x => x.publicId);
  } catch (_) {
    return [];
  }
}

async function destroyCloudinaryAssets(urls) {
  const results = [];
  if (!cloudinary) return results;
  const seen = new Set();

  for (const assetUrl of urls) {
    for (const asset of cloudinaryPublicIdsFromUrl(assetUrl)) {
      const key = `${asset.resourceType}:${asset.publicId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const result = await cloudinary.uploader.destroy(asset.publicId, { resource_type: asset.resourceType });
        results.push({ ...asset, result: result.result || 'ok' });
      } catch (e) {
        results.push({ ...asset, error: e.message });
      }
    }
  }

  return results;
}

async function deleteQuerySnapshot(db, querySnapshot) {
  let count = 0;
  let batch = db.batch();
  let pending = 0;

  for (const docSnap of querySnapshot.docs) {
    batch.delete(docSnap.ref);
    pending += 1;
    count += 1;
    if (pending >= 450) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) await batch.commit();
  return count;
}

async function deleteDocTree(docRef) {
  const subcollections = await docRef.listCollections();
  for (const subcollection of subcollections) {
    const snap = await subcollection.get();
    for (const child of snap.docs) {
      await deleteDocTree(child.ref);
    }
  }
  await docRef.delete();
}

async function removeUidFromUserArrays(db, uid) {
  const fields = ['friends', 'followers', 'following', 'trustedFriends'];
  let updated = 0;

  for (const field of fields) {
    const snap = await db.collection('users').where(field, 'array-contains', uid).get();
    if (snap.empty) continue;
    let batch = db.batch();
    let pending = 0;
    for (const docSnap of snap.docs) {
      batch.update(docSnap.ref, { [field]: admin.firestore.FieldValue.arrayRemove(uid) });
      pending += 1;
      updated += 1;
      if (pending >= 450) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();
  }

  return updated;
}

function removeLocalGameScripts(gameId) {
  if (!gameId) return false;
  const scriptsDir = path.resolve(__dirname, '../assets/games', gameId);
  const allowedRoot = path.resolve(__dirname, '../assets/games');
  if (!scriptsDir.startsWith(allowedRoot + path.sep)) return false;
  if (!fs.existsSync(scriptsDir)) return false;
  fs.rmSync(scriptsDir, { recursive: true, force: true });
  return true;
}

async function purgeAccount(uid, options = {}) {
  if (!admin) throw new Error('Firebase Admin is not configured');
  const db = admin.firestore();
  const now = new Date();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) return { uid, skipped: 'user-not-found' };

  const userData = userSnap.data() || {};
  const scheduledFor = userData.accountDeletionScheduledFor ? new Date(userData.accountDeletionScheduledFor) : null;
  if (!options.force && (userData.accountDeletionRequested !== true || !scheduledFor || scheduledFor > now)) {
    return { uid, skipped: 'not-due' };
  }

  const cloudinaryUrls = [
    userData.avatarPreview,
    userData.avatarPreviewHead,
  ];
  const deletedGameIds = [];

  const gamesSnap = await db.collection('publishedGames').where('authorId', '==', uid).get();
  for (const gameDoc of gamesSnap.docs) {
    const game = gameDoc.data() || {};
    cloudinaryUrls.push(game.mapUrl, game.icon);
    deletedGameIds.push(gameDoc.id);
    await deleteDocTree(gameDoc.ref);
    await db.collection('gameStats').doc(gameDoc.id).delete().catch(() => {});
    removeLocalGameScripts(gameDoc.id);
  }

  const counts = {
    publishedGames: deletedGameIds.length,
    transactions: await deleteQuerySnapshot(db, await db.collection('transactions').where('userId', '==', uid).get()),
    friendRequestsFrom: await deleteQuerySnapshot(db, await db.collection('friendRequests').where('from', '==', uid).get()),
    friendRequestsTo: await deleteQuerySnapshot(db, await db.collection('friendRequests').where('to', '==', uid).get()),
    reportsByUser: await deleteQuerySnapshot(db, await db.collection('reports').where('reporterId', '==', uid).get()),
    reportsAboutUser: await deleteQuerySnapshot(db, await db.collection('reports').where('reportedId', '==', uid).get()),
    supportRequests: await deleteQuerySnapshot(db, await db.collection('supportRequests').where('userId', '==', uid).get()),
    userArrayReferences: await removeUidFromUserArrays(db, uid),
  };

  await Promise.all([
    db.collection('presence').doc(uid).delete().catch(() => {}),
    db.collection('roles').doc(uid).delete().catch(() => {}),
    db.collection('bans').doc(uid).delete().catch(() => {}),
    userData.userIdNum ? db.collection('userIds').doc(String(userData.userIdNum)).delete().catch(() => {}) : Promise.resolve(),
    userData.username ? db.collection('usernames').doc(String(userData.username).toLowerCase()).delete().catch(() => {}) : Promise.resolve(),
  ]);

  try {
    const gameVisitGroups = await db.collectionGroup('visitors').where(admin.firestore.FieldPath.documentId(), '==', uid).get();
    counts.gameVisitRecords = await deleteQuerySnapshot(db, gameVisitGroups);
  } catch (e) {
    counts.gameVisitRecords = -1;
    counts.errors = counts.errors || [];
    counts.errors.push(`visitors: ${e.message}`);
  }
  try {
    const gamePlayerGroups = await db.collectionGroup('players').where(admin.firestore.FieldPath.documentId(), '==', uid).get();
    counts.gamePlayerRecords = await deleteQuerySnapshot(db, gamePlayerGroups);
  } catch (e) {
    counts.gamePlayerRecords = -1;
    counts.errors = counts.errors || [];
    counts.errors.push(`players: ${e.message}`);
  }
  const cloudinaryResults = await destroyCloudinaryAssets(cloudinaryUrls);

  await deleteDocTree(userRef);
  await admin.auth().deleteUser(uid).catch(e => {
    if (e.code !== 'auth/user-not-found') throw e;
  });

  return {
    uid,
    deleted: true,
    counts,
    deletedGameIds,
    cloudinaryDeleted: cloudinaryResults,
    cloudinaryConfigured: !!cloudinary,
  };
}

async function purgeDueAccounts() {
  if (!admin) return { skipped: 'firebase-admin-not-configured' };
  const db = admin.firestore();
  const now = new Date();
  const due = await db.collection('users')
    .where('accountDeletionRequested', '==', true)
    .limit(100)
    .get();

  const results = [];
  for (const docSnap of due.docs) {
    const scheduledFor = docSnap.data().accountDeletionScheduledFor ? new Date(docSnap.data().accountDeletionScheduledFor) : null;
    if (!scheduledFor || scheduledFor > now) continue;
    results.push(await purgeAccount(docSnap.id));
  }
  return { processed: results.length, results };
}

// Store scripts in memory (in production, use a database)
const gameScripts = new Map();

// gameId -> GameServer instance
const gameServers = new Map();

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Purge-Secret');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Handle script API endpoints
  if (pathname.startsWith('/api/game-scripts/') && req.method === 'GET') {
    const gameId = pathname.replace('/api/game-scripts/', '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(gameScripts.get(gameId) || {}));
    return;
  }

  // sendBeacon endpoint: reliably remove a user from a server on page unload
  if (pathname === '/api/leave-server' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { serverId, userId } = body;
      if (!serverId || !userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing serverId or userId' }));
        return;
      }
      const result = await removeUserFromServer(serverId, userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (pathname === '/api/account-deletions/purge' && req.method === 'POST') {
    try {
      const headerSecret = req.headers['x-purge-secret'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!ACCOUNT_PURGE_SECRET || headerSecret !== ACCOUNT_PURGE_SECRET) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const body = await readJsonBody(req);
      const result = body.uid
        ? await purgeAccount(body.uid, { force: body.force === true })
        : await purgeDueAccounts();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/save-script' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { gameId, scriptName, code, userId } = data;

        if (!gameId || !scriptName || !code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        if (!gameScripts.has(gameId)) {
          gameScripts.set(gameId, {});
        }
        gameScripts.get(gameId)[scriptName] = { code, savedAt: new Date().toISOString(), userId };

        // Also save to filesystem for persistence
        const scriptsDir = path.join(__dirname, '../assets/games', gameId);
        if (!fs.existsSync(scriptsDir)) {
          fs.mkdirSync(scriptsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(scriptsDir, `${scriptName}.lua`), code);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/publish-scripts' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { gameId, scripts, userId } = data;

        if (!gameId || !scripts) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        // Save all scripts
        const scriptsDir = path.join(__dirname, '../assets/games', gameId);
        if (!fs.existsSync(scriptsDir)) {
          fs.mkdirSync(scriptsDir, { recursive: true });
        }

        for (const [scriptName, scriptData] of Object.entries(scripts)) {
          fs.writeFileSync(path.join(scriptsDir, `${scriptName}.lua`), scriptData.code || '');
          if (!gameScripts.has(gameId)) {
            gameScripts.set(gameId, {});
          }
          gameScripts.get(gameId)[scriptName] = {
            code: scriptData.code,
            publishedAt: new Date().toISOString(),
            userId
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, publishedAt: new Date().toISOString() }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── 2FA Endpoints ────────────────────────────────────────────────────────────

  if (pathname === '/api/2fa/setup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, password, username } = JSON.parse(body);
        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email and password required' }));
          return;
        }

        // Verify password via Firebase Auth REST API
        const signInRes = await fetch(`${FIREBASE_AUTH_URL}:signInWithPassword?key=${FIREBASE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        });
        const signInData = await signInRes.json();
        if (!signInRes.ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: signInData.error?.message === 'INVALID_PASSWORD' ? 'Current password is incorrect' : (signInData.error?.message || 'Authentication failed') }));
          return;
        }

        // Generate TOTP secret using otplib (authenticator app shows the username)
        const secret = authenticator.generateSecret();
        const account = username || email;
        const otpauthUrl = authenticator.keyuri(encodeURIComponent(account), 'BloxVerse', secret);
        const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 200, margin: 1 });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ qr_code: qrCodeDataUrl, secret }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/2fa/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, code, secret } = JSON.parse(body);
        if (!email || !code || !secret) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email, code, and secret required' }));
          return;
        }

        const isValid = authenticator.check(code, secret);
        if (!isValid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid code. Try again.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/2fa/recover' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, code, recoveryCodes } = JSON.parse(body);
        if (!email || !code || !Array.isArray(recoveryCodes)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email, code, and recovery codes required' }));
          return;
        }

        const usedIndex = findRecoveryCode(code, recoveryCodes);
        if (usedIndex === -1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid recovery code. Try again.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, usedIndex }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/2fa/generate-recovery' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, password, secret, code, recoveryCode, recoveryCodes } = JSON.parse(body);
        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email and password required' }));
          return;
        }

        // Verify password
        const signInRes = await fetch(`${FIREBASE_AUTH_URL}:signInWithPassword?key=${FIREBASE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        });
        const signInData = await signInRes.json();
        if (!signInRes.ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: signInData.error?.message === 'INVALID_PASSWORD' ? 'Current password is incorrect' : (signInData.error?.message || 'Authentication failed') }));
          return;
        }

        // Verify identity: TOTP code OR an existing recovery code
        const validTotp = code && secret && authenticator.check(code, secret);
        const validRecovery = recoveryCode && findRecoveryCode(recoveryCode, recoveryCodes) !== -1;
        if (!validTotp && !validRecovery) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid code. Try again.' }));
          return;
        }

        const codes = generateRecoveryCodes(10);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          codes,
          hashedCodes: codes.map(hashRecoveryCode),
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/2fa/disable' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, password, code, secret, recoveryCode, recoveryCodes } = JSON.parse(body);
        if (!email || !password || (!code && !recoveryCode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email, password, and code required' }));
          return;
        }

        // Verify password
        const signInRes = await fetch(`${FIREBASE_AUTH_URL}:signInWithPassword?key=${FIREBASE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        });
        const signInData = await signInRes.json();
        if (!signInRes.ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: signInData.error?.message === 'INVALID_PASSWORD' ? 'Current password is incorrect' : (signInData.error?.message || 'Authentication failed') }));
          return;
        }

        const validTotp = code && secret && authenticator.check(code, secret);
        const validRecovery = recoveryCode && findRecoveryCode(recoveryCode, recoveryCodes) !== -1;
        if (!validTotp && !validRecovery) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid code. Try again.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Default response
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('BloxVerse WebSocket Server Running');
});

const wss = new WebSocketServer({ server });

// gameId[:serverId] -> set of client sockets
const games = new Map();

/**
 * Remove a user from the Firestore "servers" doc (and their queue entry).
 * Deletes the server (and its queue) when empty. Used by both the WS-close
 * cleanup and the sendBeacon /api/leave-server endpoint.
 */
async function removeUserFromServer(serverId, userId) {
  if (!admin) return { ok: false, skipped: 'firebase-admin-not-configured' };
  const ref = admin.firestore().collection('servers').doc(serverId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, removed: false };
  const data = snap.data();
  const players = (data.players || []).filter(p => p !== userId);
  await ref.collection('queue').doc(userId).delete().catch(() => {});
  if (players.length === 0) {
    const queueSnap = await ref.collection('queue').get();
    const deletes = queueSnap.docs.map(d => d.ref.delete());
    if (deletes.length) await Promise.allSettled(deletes);
    await ref.delete();
    return { ok: true, removed: true, deleted: true };
  }
  await ref.update({
    players,
    playerCount: players.length,
    status: players.length >= (data.maxPlayers || 10) ? 'full' : 'open',
    lastActive: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, removed: true };
}

/**
 * Remove a user from the Firestore "servers" doc when their WebSocket closes.
 * This keeps server cards accurate even if the client closes the tab without
 * an explicit leave (which is the common case). Skips removal if the same
 * user still has a live socket in the room (e.g. page refresh).
 */
async function cleanupServerMembership(ws) {
  if (!admin || !ws.serverId || !ws.userId) return;
  const room = games.get(ws.roomKey);
  if (room && Array.from(room).some(c => c !== ws && c.userId === ws.userId && c.readyState === 1)) {
    return;
  }
  try {
    const r = await removeUserFromServer(ws.serverId, ws.userId);
    if (r.deleted) console.log(`[Server ${ws.serverId}] Deleted (empty after ${ws.userId} left)`);
  } catch (e) {
    console.warn(`[Server ${ws.serverId}] Could not clean up membership:`, e.message);
  }
}

// Tracks when a player was last seen connected to a server, so we can
// distinguish "joined but socket not open yet" from "disconnected".
const serverSeenAt = new Map(); // `${serverId}:${uid}` -> Date.now()
const RECONCILE_GRACE_MS = 90 * 1000;

/**
 * Periodically reconcile the Firestore "servers" docs against live WebSocket
 * connections. Any player whose socket is gone for longer than the grace
 * period is pruned, and servers left with zero players are shut down
 * (deleted, along with their queue). This covers tab-closes/refreshes where
 * neither the client nor the WS-close cleanup could run.
 */
async function reconcileServers() {
  if (!admin) return;
  try {
    const snap = await admin.firestore().collection('servers').get();
    const now = Date.now();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const serverId = docSnap.id;
      const gameId = data.gameId;
      if (!gameId) continue;
      const roomKey = `${gameId}:${serverId}`;
      const room = games.get(roomKey);
      const liveIds = room
        ? Array.from(room).filter(c => c.readyState === 1).map(c => c.userId)
        : [];
      const liveSet = new Set(liveIds);
      const players = data.players || [];
      const keep = [];
      for (const p of players) {
        const key = `${serverId}:${p}`;
        if (liveSet.has(p)) {
          serverSeenAt.set(key, now);
          keep.push(p);
        } else if ((serverSeenAt.get(key) || 0) && now - (serverSeenAt.get(key) || 0) > RECONCILE_GRACE_MS) {
          // Was connected recently but is gone now — prune.
        } else {
          if (!serverSeenAt.has(key)) serverSeenAt.set(key, now);
          keep.push(p);
        }
      }
      if (keep.length === 0) {
        // Shut the server down.
        const queueSnap = await docSnap.ref.collection('queue').get();
        const deletes = queueSnap.docs.map(d => d.ref.delete());
        if (deletes.length) await Promise.allSettled(deletes);
        await docSnap.ref.delete();
        serverSeenAt.forEach((_, key) => { if (key.startsWith(serverId + ':')) serverSeenAt.delete(key); });
        console.log(`[Server ${serverId}] Shut down (no players)`);
      } else if (keep.length !== players.length) {
        await docSnap.ref.update({
          players: keep,
          playerCount: keep.length,
          status: keep.length >= (data.maxPlayers || 10) ? 'full' : 'open',
          lastActive: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Server ${serverId}] Pruned ${players.length - keep.length} stale player(s)`);
      }
    }
    if (serverSeenAt.size > 2000) {
      const cutoff = now - 30 * 60 * 1000;
      serverSeenAt.forEach((t, key) => { if (t < cutoff) serverSeenAt.delete(key); });
    }
  } catch (e) {
    console.warn('[Servers] reconcile error:', e.message);
  }
}

wss.on('connection', (ws, req) => {
  const parsedUrl = url.parse(req.url, true);
  const { gameId, userId, username, serverId } = parsedUrl.query;

  if (!gameId || !userId) {
    ws.close(1008, 'Missing gameId or userId');
    return;
  }

  ws.gameId = gameId;
  ws.serverId = serverId || null;
  ws.userId = userId;
  ws.username = username || 'Player';
  // Each logical server (instance) gets its own room so players in different
  // servers of the same game never see each other.
  const roomKey = serverId ? `${gameId}:${serverId}` : gameId;
  ws.roomKey = roomKey;

  if (!games.has(roomKey)) {
    games.set(roomKey, new Set());
  }
  const room = games.get(roomKey);
  room.add(ws);

  // Initialize GameServer for this game if not already running
  if (!gameServers.has(roomKey)) {
    const gs = new GameServer(gameId, room);
    gameServers.set(roomKey, gs);
  }
  const gs = gameServers.get(roomKey);

  function broadcastPlayerList(targetRoom) {
    const players = Array.from(targetRoom).map(c => ({ userId: c.userId, username: c.username }));
    const msg = JSON.stringify({ type: 'playerList', players });
    for (const client of targetRoom) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  console.log(`User ${userId} joined game ${gameId}${serverId ? ` (server ${serverId})` : ''}. Total in room: ${room.size}`);

  broadcastPlayerList(room);
  const joinMsg = JSON.stringify({ type: 'chat', system: true, message: `${ws.username} joined.` });
  for (const client of room) {
    if (client.readyState === 1) client.send(joinMsg);
  }

  // Notify game server script
  gs.handlePlayerJoin(userId, ws.username);

  ws.on('message', (message) => {
    const currentRoom = games.get(ws.roomKey);
    if (!currentRoom) return;

    let data;
    let isChat = false;
    let isVoice = false;
    try {
      data = JSON.parse(message);
      if (data.type === 'chat') {
        isChat = true;
        if (!data.userId) data.userId = userId;

        // Route to server-side game script for processing
        if (data.message && typeof data.message === 'string') {
          gs.handleChat(data.userId, data.message);
        }
      } else if (data.type === 'voice-offer' || data.type === 'voice-answer' || data.type === 'voice-ice') {
        isVoice = true;
        if (!data.userId) data.userId = userId;
      }
    } catch (e) {}

    const msgToSend = isChat ? JSON.stringify(data) : message;

    for (const client of currentRoom) {
      if (client.readyState !== 1) continue;
      // Send back to sender for chat; for voice/others, skip sender unless targeted relay should still exclude sender
      if (client === ws && !isChat) continue;
      // Targeted relay: if payload specifies targetUserId, only send to that peer
      if (isVoice && data.targetUserId && client.userId !== data.targetUserId) continue;
      client.send(msgToSend);
    }
  });

  ws.on('close', () => {
    const currentRoom = games.get(ws.roomKey);
    if (currentRoom) {
      currentRoom.delete(ws);
      gs.handlePlayerLeave(userId, ws.username);
      if (currentRoom.size === 0) {
        games.delete(ws.roomKey);
        const oldGs = gameServers.get(ws.roomKey);
        if (oldGs) {
          oldGs.destroy();
          gameServers.delete(ws.roomKey);
          console.log(`[GameServer ${ws.roomKey}] Destroyed (no players left)`);
        }
      } else {
        const leaveMsg = JSON.stringify({ type: 'leave', userId });
        const chatMsg = JSON.stringify({ type: 'chat', system: true, message: `${ws.username} left.` });
        for (const client of currentRoom) {
          if (client.readyState === 1) {
            client.send(leaveMsg);
            client.send(chatMsg);
          }
        }
        broadcastPlayerList(currentRoom);
      }
    }
    cleanupServerMembership(ws);
    console.log(`User ${userId} left game ${gameId}.`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
  if (admin) {
    purgeDueAccounts().catch(e => console.warn('[AccountDeletion] Initial purge failed:', e.message));
    setInterval(() => {
      purgeDueAccounts().catch(e => console.warn('[AccountDeletion] Scheduled purge failed:', e.message));
    }, 60 * 60 * 1000);
    reconcileServers().catch(e => console.warn('[Servers] Initial reconcile failed:', e.message));
    setInterval(() => {
      reconcileServers().catch(e => console.warn('[Servers] Scheduled reconcile failed:', e.message));
    }, 60 * 1000);
  }
});
