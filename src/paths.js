/**
 * Site root for GitHub Pages project sites (/bloxverse).
 * Empty on local dev when served from repository root.
 */
export function getSiteBase() {
  const p = window.location.pathname;
  if (p === '/bloxverse' || p.startsWith('/bloxverse/')) return '/bloxverse';
  return '';
}

/** Build a same-origin URL for a site asset or page. */
export function sitePath(relativePath) {
  const clean = relativePath.replace(/^\//, '');
  const base = getSiteBase();
  return base ? `${base}/${clean}` : `/${clean}`;
}
