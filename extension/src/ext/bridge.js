/*
 * Bridge between the page (where ISS runs) and the extension's background
 * worker. Runs in Chrome's isolated content-script world, which can use
 * chrome.runtime but can't touch the page's JavaScript directly.
 */
(() => {
  'use strict';
  const ORIGIN = location.origin;

  // Page -> background
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__iss !== 'page') return;
    if (ev.data.type === 'watch-audible-tab') {
      chrome.runtime.sendMessage({ type: 'watch-audible-tab', on: !!ev.data.on }).catch(() => {});
    }
  });

  // Background / popup -> page
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'audible-tab') window.postMessage({ __iss: 'ext', type: 'audible-tab', tab: msg.tab || null }, ORIGIN);
    if (msg.type === 'toggle-panel' || msg.type === 'open-panel') window.postMessage({ __iss: 'ext', type: msg.type }, ORIGIN);
  });
})();
