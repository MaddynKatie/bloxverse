const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { requireUid, send, readJsonBody } = require('./http-util.js');

const MAX_PROJECT_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[1-9]\d*$/;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readProject(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PROJECT_BYTES) throw fail(413, 'Project exceeds the 10 MB limit.');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (data.length < 8 || data.toString('ascii', 0, 3) !== 'BVP') throw fail(400, 'Invalid project file.');
  return data;
}

// Backblaze B2 via its S3-compatible API. Configure with B2_KEY_ID,
// B2_APPLICATION_KEY, B2_BUCKET and B2_ENDPOINT (e.g. https://s3.us-west-004.backblazeb2.com).
function storageConfigured() {
  return Boolean(process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY && process.env.B2_BUCKET && process.env.B2_ENDPOINT);
}

function storageClient() {
  // Accept the endpoint with or without a scheme and with a trailing slash.
  const endpoint = 'https://' + process.env.B2_ENDPOINT.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const region = (endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/) || [])[1] || 'us-west-004';
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: false,
    // Newer SDKs add default checksums that Backblaze's S3 API may reject.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APPLICATION_KEY },
  });
}

async function readObject(s3, key) {
  const result = await s3.send(new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
}

async function writeObject(s3, key, bytes) {
  await s3.send(new PutObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key, Body: bytes, ContentType: 'application/octet-stream', ContentDisposition: 'attachment' }));
}

async function removeFile(s3, key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key }));
  } catch (err) {
    console.warn('[Studio] Unable to delete obsolete project file:', err.message);
  }
}

async function handleStudioProjects(admin, req, res, pathname) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const uid = await requireUid(admin, req);
    const match = pathname.match(/^\/api\/studio\/projects(?:\/(\d+))?$/);
    if (!match || (match[1] && !PROJECT_ID.test(match[1]))) throw fail(404, 'Project not found.');
    // Project IDs come from one global sequence (1, 2, 3...) shared by all users.
    // Each project lives in studioProjects/{id} and records its ownerId.
    const db = admin.firestore();
    const counterRef = db.collection('studioCounters').doc('projects');
    const projects = db.collection('studioProjects');
    if (!match[1] && req.method === 'POST') {
      let body;
      try { body = await readJsonBody(req); } catch (error) { throw fail(400, error.message); }
      const name = String(body.name || '').trim();
      if (!name) throw fail(400, 'Enter a game name.');
      if (name.length > 120) throw fail(400, 'Game names can be at most 120 characters.');
      const description = String(body.description == null ? '' : body.description).trim().slice(0, 1000);
      const visibility = body.visibility === 'public' ? 'public' : 'private';
      const id = await db.runTransaction(async tx => {
        const counter = await tx.get(counterRef);
        const next = (Number(counter.exists ? counter.data().last : 0) || 0) + 1;
        tx.set(counterRef, { last: next }, { merge: true });
        tx.set(projects.doc(String(next)), { ownerId: uid, name, description, visibility, revision: 0, updatedAt: new Date().toISOString() });
        return next;
      });
      return send(res, 201, { id: String(id), name, description, visibility, revision: 0 });
    }
    if (!match[1] && req.method === 'GET') {
      const snapshot = await projects.where('ownerId', '==', uid).get();
      const list = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name, description: doc.data().description || '', visibility: doc.data().visibility === 'public' ? 'public' : 'private', revision: doc.data().revision, updatedAt: doc.data().updatedAt }));
      list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return send(res, 200, { projects: list });
    }
    if (!match[1]) throw fail(405, 'Method not allowed.');
    if (!storageConfigured()) throw fail(503, 'Cloud storage is not configured on the server.');
    const s3 = storageClient();
    const ref = projects.doc(match[1]);
    if (req.method === 'GET') {
      const doc = await ref.get();
      if (!doc.exists || doc.data().ownerId !== uid) throw fail(404, 'Project not found.');
      const data = doc.data();
      if (!data.fileKey) throw fail(409, 'This project has not been saved yet.');
      let bytes;
      try { bytes = await readObject(s3, data.fileKey); } catch { throw fail(502, 'Could not retrieve the project file.'); }
      // A concurrent save may have replaced the file while it was being fetched.
      const current = await ref.get();
      if (!current.exists || current.data().revision !== data.revision) throw fail(409, 'Project changed while opening. Please retry.');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Project-Revision': String(data.revision), 'X-Project-Name': encodeURIComponent(data.name) });
      return res.end(bytes);
    }
    if (req.method !== 'POST') throw fail(405, 'Method not allowed.');
    const saveId = String(req.headers['x-save-id'] || '');
    const revisionText = String(req.headers['x-project-revision'] || '');
    if (!UUID.test(saveId) || !/^(0|[1-9]\d*)$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText))) throw fail(400, 'Invalid save metadata.');
    const expected = Number(revisionText);
    let name;
    try { name = decodeURIComponent(String(req.headers['x-project-name'] || 'Untitled')); } catch { throw fail(400, 'Invalid project name.'); }
    name = name.trim().slice(0, 120) || 'Untitled';
    let description = '';
    try { description = decodeURIComponent(String(req.headers['x-project-description'] || '')); } catch { throw fail(400, 'Invalid project description.'); }
    description = description.trim().slice(0, 1000);
    const visibility = req.headers['x-project-visibility'] === 'public' ? 'public' : 'private';
    const bytes = await readProject(req);
    const existing = await ref.get();
    if (existing.exists && existing.data().ownerId !== uid) throw fail(404, 'Project not found.');
    if (existing.exists && existing.data().saveId === saveId) return send(res, 200, { revision: existing.data().revision });
    if ((existing.exists ? existing.data().revision : 0) !== expected) throw fail(409, 'This project was changed elsewhere. Reopen it before saving.');
    // Each save gets a unique object key; the bucket must stay private.
    const newKey = `projects/${uid}/${match[1]}/${saveId}.bvp`;
    try { await writeObject(s3, newKey, bytes); } catch (err) { console.warn('[Studio] B2 upload failed:', err.name, err.message); throw fail(502, 'Cloud upload failed.'); }
    let result;
    try {
      result = await admin.firestore().runTransaction(async tx => {
        const latest = await tx.get(ref);
        const current = latest.exists ? latest.data() : null;
        if (current?.saveId === saveId) return { revision: current.revision, duplicate: true };
        if ((current?.revision || 0) !== expected) throw fail(409, 'This project was changed elsewhere. Reopen it before saving.');
        const revision = expected + 1;
        if (current && current.ownerId !== uid) throw fail(404, 'Project not found.');
        tx.set(ref, { ownerId: uid, name, description, visibility, revision, fileKey: newKey, saveId, updatedAt: new Date().toISOString() }, { merge: true });
        return { revision, oldKey: current?.fileKey };
      });
    } catch (err) {
      // A failed transaction response may hide a successful commit. Delete only
      // after a confirmed revision conflict; otherwise preserve the new file.
      if (err.status === 409) await removeFile(s3, newKey);
      throw err;
    }
    if (result.duplicate) await removeFile(s3, newKey);
    // Keep the prior revision so a concurrent reader or uncertain commit cannot
    // lose data. Older B2 objects remain and count toward storage usage.
    return send(res, 200, { revision: result.revision });
  } catch (err) {
    if (!err.status || err.status >= 500) console.warn('[Studio] Project request failed:', err.message);
    if (!res.headersSent) return send(res, err.status || 500, { error: err.status ? err.message : 'Cloud project request failed.' });
    res.destroy();
  }
}

module.exports = { handleStudioProjects };
