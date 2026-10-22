'use strict';

const X_URL = /^https:\/\/(x|twitter)\.com\//;

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onX = tab && X_URL.test(tab.url || '');
  document.getElementById(onX ? 'on-x' : 'off-x').hidden = false;

  document.getElementById('toggle').addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' });
      window.close();
    } catch (_) {
      // Page was open before ISS was installed.
      await chrome.tabs.reload(tab.id);
      window.close();
    }
  });
  document.getElementById('open-x').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://x.com/i/spaces/start' });
    window.close();
  });
})();
