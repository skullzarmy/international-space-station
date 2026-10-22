/*
 * Background service worker.
 *
 * Its only job: when you share a tab's audio into a Space and turn on
 * "Read song from the shared tab's title", tell the X tab what that other
 * tab's title is (e.g. "Artist - Song - YouTube"). Only X tabs that asked
 * get told, and only the single best-guess title is sent.
 */
'use strict';

const X_URL = /^https:\/\/(x|twitter)\.com\//;
const watchers = new Set(); // X tab ids that want titles
const lastSent = new Map(); // X tab id -> JSON of last tab info

async function bestAudibleTab() {
  const tabs = await chrome.tabs.query({ audible: true });
  const candidates = tabs.filter((t) => !X_URL.test(t.url || ''));
  if (!candidates.length) return null;
  // Prefer the most recently used audible tab.
  candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const t = candidates[0];
  return { title: t.title || '', url: t.url || '' };
}

async function push() {
  if (!watchers.size) return;
  const tab = await bestAudibleTab();
  const json = JSON.stringify(tab);
  for (const id of [...watchers]) {
    if (lastSent.get(id) === json) continue;
    lastSent.set(id, json);
    chrome.tabs.sendMessage(id, { type: 'audible-tab', tab }).catch(() => watchers.delete(id));
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'watch-audible-tab' || !sender.tab) return;
  if (msg.on) {
    watchers.add(sender.tab.id);
    lastSent.delete(sender.tab.id);
    push();
  } else {
    watchers.delete(sender.tab.id);
  }
});

chrome.tabs.onUpdated.addListener((_id, info) => {
  if (watchers.size && ('title' in info || 'audible' in info)) push();
});
chrome.tabs.onRemoved.addListener((id) => {
  watchers.delete(id);
  lastSent.delete(id);
  if (watchers.size) push();
});
