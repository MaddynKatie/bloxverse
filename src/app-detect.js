// Web -> desktop deep links. The BloxVerse desktop app registers the
// bloxverse:// protocol with the OS; these helpers detect whether the app is
// installed and build the join link that carries the user's auth tokens into
// the app. The app's preload exposes window.bloxverseApp for in-app pages.
export const isDesktopApp = typeof window !== 'undefined' && !!(window.bloxverseApp && window.bloxverseApp.isApp);

const DETECT_CACHE = 'bv:app-installed';
const DETECT_TIMEOUT = 1500;

/**
 * Detect whether the BloxVerse desktop app is installed.
 *
 * Fires a hidden iframe at the bloxverse:// protocol: if something is
 * registered to handle it, the app launches and our window loses focus. If
 * nothing handles it the iframe fails silently and we keep focus. The result
 * is cached for the tab session so we don't relaunch the app on every click.
 */
export function detectDesktopApp() {
  if (isDesktopApp) return Promise.resolve(true);
  try {
    const cached = sessionStorage.getItem(DETECT_CACHE);
    if (cached === '1') return Promise.resolve(true);
    if (cached === '0') return Promise.resolve(false);
  } catch {}

  return new Promise((resolve) => {
    let settled = false;
    const iframe = document.createElement('iframe');

    const finish = (installed) => {
      if (settled) return;
      settled = true;
      try { sessionStorage.setItem(DETECT_CACHE, installed ? '1' : '0'); } catch {}
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(timer);
      try { iframe.remove(); } catch {}
      resolve(installed);
    };
    const onBlur = () => finish(true);
    const onVis = () => { if (document.hidden) finish(true); };

    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    const timer = setTimeout(() => finish(false), DETECT_TIMEOUT);

    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = 'bloxverse://ping?cb=' + Date.now();
    document.body.appendChild(iframe);
  });
}

/** bloxverse://join?... link for opening a specific game (and server). */
export function buildJoinUrl(gameId, serverId) {
  const p = new URLSearchParams({ game: gameId });
  if (serverId) p.set('server', serverId);
  return 'bloxverse://join?' + p.toString();
}
