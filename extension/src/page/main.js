/*
 * ISS entry point. Runs at document_start in the page's own world, so the
 * hooks are in place before X's app code asks for the mic or opens sockets.
 */
(function (root) {
  'use strict';

  const ISS = root.__ISS__;
  if (!ISS || ISS.started) return;
  ISS.started = true;

  ISS.chat.install();
  ISS.titles.installHooks();
  ISS.hooks.install();
  ISS.nowPlaying.install();
  ISS.board.installHotkeys();

  // Messages from the extension (popup button, etc.) arrive via bridge.js.
  root.addEventListener('message', (ev) => {
    if (ev.source !== root || !ev.data || ev.data.__iss !== 'ext') return;
    if (ev.data.type === 'toggle-panel') ISS.ui.toggle();
    if (ev.data.type === 'open-panel') ISS.ui.open();
  });

  const mount = () => {
    try {
      ISS.ui.mount();
    } catch (err) {
      ISS.log.error('panel failed to load', err);
    }
  };
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  ISS.log.info(`International Space Station v${ISS.version} ready. Free and open source, public domain.`);
})(typeof globalThis !== 'undefined' ? globalThis : this);
