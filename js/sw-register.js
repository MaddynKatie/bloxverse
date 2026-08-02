/* Register the BloxVerse service worker (offline cache + instant loads).
   Only runs on the deployed site — skipped on local dev servers. */
(function () {
  if (!('serviceWorker' in navigator)) return;
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;
  if (!location.pathname.startsWith('/bloxverse/')) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/bloxverse/sw.js', { scope: '/bloxverse/' })
      .then(function (reg) { reg.update(); })
      .catch(function () {});
  });
})();
