const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { requireUid, send } = require('./http-util.js');

const MAX_PROJECT_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const endpoint = process.env.B2_ENDPOINT;
  const region = (endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/) || [])[1] || 'us-west-004';
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: false,
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
    const match = pathname.match(/^\/api\/studio\/projects(?:\/([0-9a-f-]+))?$/i);
    if (!match || (match[1] && !UUID.test(match[1]))) throw fail(404, 'Project not found.');
    const projects = admin.firestore().collection('studioProjectOwners').doc(uid).collection('projects');
    if (!match[1] && req.method === 'GET') {
      const snapshot = await projects.orderBy('updatedAt', 'desc').get();
      return send(res, 200, { projects: snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name, revision: doc.data().revision, updatedAt: doc.data().updatedAt })) });
    }
    if (!match[1]) throw fail(405, 'Method not allowed.');
    if (!storageConfigured()) throw fail(503, 'Cloud storage is not configured on the server.');
    const s3 = storageClient();
    const ref = projects.doc(match[1]);
    if (req.method === 'GET') {
      const doc = await ref.get();
      if (!doc.exists) throw fail(404, 'Project not found.');
      const data = doc.data();
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
    const bytes = await readProject(req);
    const existing = await ref.get();
    if (existing.exists && existing.data().saveId === saveId) return send(res, 200, { revision: existing.data().revision });
    if ((existing.exists ? existing.data().revision : 0) !== expected) throw fail(409, 'This project was changed elsewhere. Reopen it before saving.');
    // Each save gets a unique object key; the bucket must stay private.
    const newKey = `projects/${uid}/${match[1]}/${saveId}.bvp`;
    try { await writeObject(s3, newKey, bytes); } catch { throw fail(502, 'Cloud upload failed.'); }
    let result;
    try {
      result = await admin.firestore().runTransaction(async tx => {
        const latest = await tx.get(ref);
        const current = latest.exists ? latest.data() : null;
        if (current?.saveId === saveId) return { revision: current.revision, duplicate: true };
        if ((current?.revision || 0) !== expected) throw fail(409, 'This project was changed elsewhere. Reopen it before saving.');
        const revision = expected + 1;
        tx.set(ref, { name, revision, fileKey: newKey, saveId, updatedAt: new Date().toISOString() });
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
