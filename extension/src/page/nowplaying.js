/*
 * Now playing: track what's on (Mix Station or a shared tab), and optionally
 *   - put it in the Space title (via the learned title request, see titles.js)
 *   - send a reaction when the song changes
 *   - send a reaction every N seconds while music is playing
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});

  /** Turn a browser tab title into "Artist - Track" where we can. */
  function cleanTabTitle(title, url) {
    let t = String(title || '').trim();
    t = t.replace(/^\(\d+\)\s*/, '').replace(/^[▶►❚⏸•·\s]+/, '');
    let m = /^Stream (.+) by (.+?) \| Listen.*SoundCloud$/i.exec(t);
    if (m) return `${m[2]} - ${m[1]}`;
    if (/spotify\.com/.test(url || '')) {
      m = /^(.+?) • (.+)$/.exec(t);
      if (m) return `${m[2]} - ${m[1]}`;
      if (/^Spotify/i.test(t)) return '';
    }
    t = t.replace(/\s+[-|–]\s+(YouTube Music|YouTube|SoundCloud|Bandcamp|Twitch|Spotify|Apple Music|Deezer|TIDAL|Mixcloud|Audiomack)$/i, '');
    if (/^(YouTube|YouTube Music|SoundCloud|Twitch|Spotify)$/i.test(t)) return '';
    return t.trim();
  }

  function infoFromTitle(title) {
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
    if (m) return { artist: m[1].trim(), track: m[2].trim(), title };
    return { artist: '', track: title, title };
  }

  const sources = { station: null, tab: null };
  let current = null;
  let pendingTitle = null;
  let pendingTimer = null;
  let lastAuto = 0;

  function pick() {
    if (sources.station && ISS.station && ISS.station.isPlaying()) return sources.station;
    if (sources.tab && ISS.engine.tab.stream && ISS.settings.nowPlaying.fromSharedTab) return sources.tab;
    return sources.station || null;
  }

  function update() {
    const next = pick();
    const prevTitle = current ? current.title : '';
    const nextTitle = next ? next.title : '';
    current = next;
    if (prevTitle === nextTitle) return;
    ISS.emit('now-playing', current);
    if (!current || !current.title) return;
    const np = ISS.settings.nowPlaying;
    if (np.toTitle) pushTitle(ISS.titles.fillTitle(np.template, current));
    if (np.reactOnChange && np.reactEmoji) ISS.chat.sendReaction(np.reactEmoji);
  }

  function pushTitle(text) {
    pendingTitle = text;
    clearTimeout(pendingTimer);
    ISS.titles.applyTitle(text).then((r) => {
      if (r.ok) {
        pendingTitle = null;
        return;
      }
      if (r.retry) {
        pendingTimer = setTimeout(() => pendingTitle && pushTitle(pendingTitle), 15500);
        return;
      }
      ISS.emit('toast', { msg: `Title not updated: ${r.reason}`, kind: 'warn' });
    });
  }

  function set(source, info) {
    sources[source] = info && info.title ? info : null;
    update();
  }

  function clear(source) {
    sources[source] = null;
    update();
  }

  // Auto reactions while music plays.
  function tick() {
    const r = ISS.settings.reactions;
    if (!r.autoWhilePlaying || !r.autoEmoji) return;
    const playing = (ISS.station && ISS.station.isPlaying()) || !!ISS.engine.tab.stream;
    if (!playing || !ISS.chat.status().linked) return;
    const lv = ISS.engine.levels();
    if (!lv || lv.music < -50) return;
    const now = Date.now();
    if (now - lastAuto < Math.max(5, Number(r.autoInterval) || 20) * 1000) return;
    lastAuto = now;
    ISS.chat.sendReaction(r.autoEmoji);
  }

  // Shared-tab titles come from the extension's background worker, through
  // the bridge script. We only ask for them while you're sharing a tab with
  // this option on, and only the one title we need is passed to the page.
  function wantTabTitles(on) {
    root.postMessage({ __iss: 'page', type: 'watch-audible-tab', on: !!on }, root.location.origin);
  }

  function onMessage(ev) {
    if (ev.source !== root || !ev.data || ev.data.__iss !== 'ext') return;
    if (ev.data.type === 'audible-tab') {
      const t = ev.data.tab;
      const clean = t ? cleanTabTitle(t.title, t.url) : '';
      set('tab', clean ? infoFromTitle(clean) : null);
    }
  }

  function syncWatch() {
    wantTabTitles(!!ISS.engine.tab.stream && ISS.settings.nowPlaying.fromSharedTab);
    if (!ISS.engine.tab.stream) clear('tab');
  }

  function install() {
    root.addEventListener('message', onMessage);
    ISS.on('tab', syncWatch);
    ISS.on('settings', (e) => {
      if (e && (e.path === 'nowPlaying.fromSharedTab' || e.path === '*')) syncWatch();
    });
    ISS.on('station', () => update());
    setInterval(tick, 1000);
  }

  ISS.nowPlaying = {
    cleanTabTitle,
    infoFromTitle,
    set,
    clear,
    install,
    current: () => current,
    pushTitle,
  };

  if (typeof module === 'object' && module.exports) module.exports = ISS.nowPlaying;
})(typeof globalThis !== 'undefined' ? globalThis : this);
