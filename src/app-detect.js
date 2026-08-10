// Web -> desktop deep links. The BloxVerse desktop app registers the
// bloxverse:// protocol with the OS; these helpers build the join link that
// carries the user's auth tokens into the app. The app's preload exposes
// window.bloxverseApp for in-app pages.
export const isDesktopApp = typeof window !== 'undefined' && !!(window.bloxverseApp && window.bloxverseApp.isApp);

/** bloxverse://join?... link for opening a specific game (and server). */
export function buildJoinUrl(gameId, serverId) {
  const p = new URLSearchParams({ game: gameId });
  if (serverId) p.set('server', serverId);
  return 'bloxverse://join?' + p.toString();
}
