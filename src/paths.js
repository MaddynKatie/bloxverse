/**
 * Site root for GitHub Pages project sites (/bloxverse).
 * Empty on local dev when served from repository root.
 */
export function getSiteBase() {
  const p = window.location.pathname;
  if (p === '/bloxverse' || p.startsWith('/bloxverse/')) return '/bloxverse';
  return '';
}

/** Build a same-origin URL for a site asset or page. Clean URLs (no .html). */
export function sitePath(relativePath) {
  // Strip .html extension for professional clean URLs
  const clean = relativePath.replace(/^\//, '').replace(/\.html$/, '');
  const base = getSiteBase();
  // Homepage is just base root
  if (clean === 'index' || clean === '') {
    return base ? `${base}/` : '/';
  }
  return base ? `${base}/${clean}` : `/${clean}`;
}
