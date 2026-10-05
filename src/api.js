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
 * returns the first real response.
 *
 * Every endpoint these callers use answers JSON, so a response whose
 * content-type is not JSON counts as a failed node and moves on. A Render
 * service that is suspended, still spinning up, or running a revision without
 * the route answers 200 with the plain-text banner
 * ("BloxVerse WebSocket Server Running") from the catch-all in server/index.js
 * rather than a 404 -- treating that as success handed callers a body they
 * could not parse, so they silently fell back to local data instead of trying
 * the next node.
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
      if (!ct.includes('json')) {
        lastErr = new Error(`${base} answered ${res.status} ${ct || 'no content-type'}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All API servers unreachable');
}
