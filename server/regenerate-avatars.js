/**
 * Regenerate avatars for ALL users: reset every avatar to the new default
 * (white head+arms / purple torso / dark-purple legs, smile face, no
 * clothing/pants/accessories) and re-render both profile pictures (full-body
 * and circular head shot) using a headless Chrome 3D render, uploading them
 * to Cloudinary under SINGULAR public_ids per user so subsequent saves EDIT
 * the same asset instead of creating new ones every time.
 *
 * Usage (from server/):
 *   node regenerate-avatars.js                # everyone
 *   node regenerate-avatars.js --limit 10     # first 10 users (test)
 *   node regenerate-avatars.js --uid <uid>    # one user
 *   node regenerate-avatars.js --keep-previews# skip Cloudinary upload/re-preview, just reset fields
 */
'use strict';

const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let admin = null;
let cloudinary = null;

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
  console.warn('[RegenAvatars] Firebase Admin unavailable:', e.message);
  process.exit(1);
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
  console.warn('[RegenAvatars] Cloudinary unavailable (will still reset docs, but no new previews):', e.message);
  cloudinary = null;
}

// ─── New default avatar ───────────────────────────────────────────────────────
const NEW_DEFAULT_COLORS = {
  Head: '#ffffff',
  Torso: '#8350fb',
  'L Arm': '#ffffff',
  'R Arm': '#ffffff',
  'L Leg': '#400eb4',
  'R Leg': '#400eb4',
};
const DEFAULT_MODEL = 'male';

const PROJECT_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const LIMIT = parseArgInt('--limit');
const UID = parseArgValue('--uid');
const KEEP_PREVIEWS = args.includes('--keep-previews');

function parseArgValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
function parseArgInt(name) {
  const v = parseArgValue(name);
  return v ? parseInt(v, 10) : null;
}

// ─── Tiny static file server (serves the repo root so avatar-render.html and
//     its imported assets/models load correctly over http for Chrome). ─────────
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
};

function startStaticServer(root) {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
    } catch {
      res.writeHead(400); res.end('bad request'); return;
    }
    const filePath = path.normalize(path.join(root, pathname.replace(/^\/+/, '')));
    if (!filePath.startsWith(root)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); res.end('not found'); return;
      }
      const type = MIME[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function avatarConfig() {
  return {
    colors: { ...NEW_DEFAULT_COLORS },
    model: DEFAULT_MODEL,
    face: 'smile',
    clothing: null,
    pants: null,
    accessories: [],
  };
}

function uploadPng(dataUrl, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(dataUrl, {
      public_id: publicId,
      resource_type: 'image',
      overwrite: true,
      invalidate: true,
    }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

// Best-effort cleanup of legacy per-save previews (old public_ids were
// `<username>_avatar_<ts>` / `<username>_avatar_head_<ts>`).
function publicIdsFromCloudinaryUrl(assetUrl) {
  const out = [];
  if (!assetUrl || typeof assetUrl !== 'string' || !assetUrl.includes('res.cloudinary.com')) return out;
  try {
    const parsed = new URL(assetUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return out;
    let publicParts = parts.slice(uploadIndex + 1);
    if (publicParts[0]?.startsWith('v') && /^\d+$/.test(publicParts[0].slice(1))) publicParts = publicParts.slice(1);
    if (!publicParts.length) return out;
    const publicId = decodeURIComponent(publicParts.join('/')).replace(/\.[^/.]+$/, '');
    if (publicId) out.push(publicId);
  } catch (_) { /* ignore */ }
  return out;
}

async function destroyLegacyPreviews(userData) {
  const candidates = [];
  for (const field of ['avatarPreview', 'avatarPreviewHead']) {
    const oldUrls = Array.isArray(userData[field]) ? userData[field] : [userData[field]];
    for (const u of oldUrls || []) candidates.push(...publicIdsFromCloudinaryUrl(u));
  }
  const seen = new Set();
  for (const publicId of candidates) {
    if (seen.has(publicId)) continue;
    seen.add(publicId);
    // Never delete the new singular ids (they end in `_head` or are exactly `u_<uid>`).
    if (publicId.startsWith('u_') && publicId.split('_').length === 2) continue;
    if (publicId.endsWith('_head') && publicId.startsWith('u_')) continue;
    try {
      await cloudinary.uploader.destroy(publicId);
      console.log('  [cleanup] destroyed legacy preview', publicId);
    } catch (e) {
      console.warn('  [cleanup] failed to destroy', publicId, e.message);
    }
  }
}

async function updateUserForDefault(db, uid, previewUrls) {
  const update = {
    avatarBodyColors: { ...NEW_DEFAULT_COLORS },
    avatarFace: 'smile',
    avatarClothing: admin.firestore.FieldValue.delete(),
    avatarPants: admin.firestore.FieldValue.delete(),
    avatarAccessories: [],
  };
  const ts = Date.now();
  if (previewUrls) {
    update.avatarPreview = previewUrls.full + '?t=' + ts;
    update.avatarPreviewHead = previewUrls.head + '?t=' + ts;
  }
  await db.collection('users').doc(uid).update(update);
}

async function processUser(db, browser, page, uid, userData, isTestSingle) {
  if (!userData || typeof userData !== 'object') userData = {};

  // 1. Render the new default avatar (headless 3D). Reuse one scene render
  //    since every user gets the same default look in this pass.
  const previews = {};
  if (!KEEP_PREVIEWS && cloudinary) {
    const result = await page.evaluate(cfg => window.__renderAvatar(cfg), avatarConfig());
    if (result && result.full && result.head) {
      const publicId = 'u_' + uid.replace(/[^a-zA-Z0-9_-]/g, '_');
      const [fullRes, headRes] = await Promise.all([
        uploadPng(result.full, publicId),
        uploadPng(result.head, publicId + '_head'),
      ]);
      previews.full = fullRes.secure_url;
      previews.head = headRes.secure_url;
      await destroyLegacyPreviews(userData);
    } else {
      console.warn(`  [${uid}] render produced no image, skipping upload`);
    }
  }

  await updateUserForDefault(db, uid, previews.full && previews.head ? previews : null);
  console.log(`[${uid}] reset to default${previews.full ? ' + new previews' : ''}${!KEEP_PREVIEWS && !cloudinary ? ' (cloudinary off)' : ''}`);

  if (isTestSingle) {
    // First run also serves to warm up the cached model.
  }
}

async function main() {
  const db = admin.firestore();
  const server = await startStaticServer(PROJECT_ROOT);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  console.log('Render page:', `${baseUrl}/avatar-render.html`);
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 400 });
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('error') || text.includes('failed') || text.includes('THREE.WebGLProgram')) {
      console.log('  [page]', text.slice(0, 300));
    }
  });
  await page.goto(`${baseUrl}/avatar-render.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__avatarRenderReady === true, { timeout: 60000 });

  let processed = 0;
  let failed = 0;

  const handleDoc = async (docSnap) => {
    const uid = docSnap.id;
    try {
      await processUser(db, browser, page, uid, docSnap.data());
      processed++;
    } catch (e) {
      failed++;
      console.error(`  [${uid}] ERROR:`, e.message);
    }
  };

  if (UID) {
    const snap = await db.collection('users').doc(UID).get();
    if (!snap.exists) {
      console.error(`User ${UID} not found`);
    } else {
      await handleDoc(snap);
    }
  } else {
    const batchSize = 100;
    let lastVisible = null;
    while (LIMIT === null || processed < LIMIT) {
      let query = db.collection('users').orderBy('__name__').limit(batchSize);
      if (lastVisible) query = query.startAfter(lastVisible);
      const snap = await query.get();
      if (snap.empty) break;
      for (const docSnap of snap.docs) {
        if (LIMIT !== null && processed >= LIMIT) break;
        await handleDoc(docSnap);
      }
      lastVisible = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < batchSize) break;
    }
  }

  await browser.close();
  server.close();
  console.log(`\nDone. processed=${processed} failed=${failed}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});