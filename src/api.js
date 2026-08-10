/**
 * Backend node URLs for BloxVerse. The first is the primary; if it is
 * unreachable (e.g. suspended or cold-starting on Render), API calls fall
 * through to the next live node. All nodes run the same codebase against the
 * same Firestore, so failover is safe.
 */
export const API_BASES = [
  'https://bloxverse.onrender.com',
  'https://bloxverse-c19f.onrender.com',
];

/**
 * Fetch a backend API path with node failover. Tries each node in order and
 * returns the first real response. A CORS-blocked request or a non-JSON error
 * response (e.g. Render's suspended-service HTML page) counts as a failed node
 * and moves on to the next one.
 */
export async function fetchApi(path, options) {
  const host = window.location.hostname;
  const bases = host === 'localhost' || host === '127.0.0.1'
    ? ['http://localhost:8080', ...API_BASES]
    : API_BASES;
  let lastErr = null;
  for (const base of bases) {
    try {
      const res = await fetch(base + path, options);
      const ct = res.headers.get('content-type') || '';
      if (!res.ok && !ct.includes('json')) {
        lastErr = new Error('HTTP ' + res.status);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All API servers unreachable');
}
