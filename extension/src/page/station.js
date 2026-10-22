/*
 * Mix Station: a local music/video file player that plays straight into the
 * Space. Files never leave your computer except as the audio you stream.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});
  const MEDIA_RE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm|mp4|m4v|mov|mkv)$/i;

  const st = {
    items: [], // { id, name, file?, handle?, url? }
    index: -1,
    shuffle: false,
    repeat: 'all', // off | all | one
    el: null,
    folderName: '',
  };

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function parseName(name) {
    const base = String(name).replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}[\s.\-_]+/, '').trim();
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
    if (m) return { artist: m[1].trim(), track: m[2].trim(), title: `${m[1].trim()} - ${m[2].trim()}` };
    return { artist: '', track: base, title: base };
  }

  function el() {
    if (st.el) return st.el;
    const a = root.document.createElement('audio');
    a.preload = 'auto';
    a.addEventListener('ended', () => {
      if (st.repeat === 'one') {
        a.currentTime = 0;
        a.play().catch(() => {});
      } else next(true);
    });
    for (const ev of ['play', 'pause', 'loadedmetadata', 'emptied']) a.addEventListener(ev, emit);
    a.addEventListener('error', () => {
      const item = st.items[st.index];
      ISS.log.warn('could not play', item && item.name);
      ISS.emit('toast', { msg: `Can't play ${item ? item.name : 'that file'}`, kind: 'warn' });
      setTimeout(() => next(true), 300);
    });
    st.el = a;
    return a;
  }

  function emit() {
    const a = st.el;
    ISS.emit('station', {
      items: st.items,
      index: st.index,
      playing: !!(a && !a.paused && !a.ended),
      shuffle: st.shuffle,
      repeat: st.repeat,
      folderName: st.folderName,
    });
  }

  function addFiles(files) {
    let n = 0;
    for (const f of files) {
      if (!MEDIA_RE.test(f.name) && !/^audio\/|^video\//.test(f.type)) continue;
      st.items.push({ id: uid(), name: f.name, file: f });
      n++;
    }
    emit();
    return n;
  }

  async function walk(dir, out, depth) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && MEDIA_RE.test(entry.name)) out.push({ id: uid(), name: entry.name, handle: entry });
      else if (entry.kind === 'directory' && depth < 4) await walk(entry, out, depth + 1);
    }
  }

  async function loadFolder(dir) {
    const items = [];
    await walk(dir, items, 0);
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    st.items = st.items.filter((i) => !i.handle).concat(items);
    st.folderName = dir.name;
    emit();
    return items.length;
  }

  async function openFolder() {
    if (typeof root.showDirectoryPicker !== 'function') throw new Error('Folder access needs Chrome, Edge or another Chromium browser. Use "Add files" instead.');
    const dir = await root.showDirectoryPicker({ id: 'iss-music', mode: 'read' });
    try {
      await ISS.store.put('kv', dir, 'musicFolder');
    } catch (_) {
      /* handle can't be stored in this browser; fine for this session */
    }
    return loadFolder(dir);
  }

  /** Re-open the last folder (must be called from a click). */
  async function restoreFolder() {
    const dir = await ISS.store.get('kv', 'musicFolder').catch(() => null);
    if (!dir) return 0;
    const perm = await dir.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return 0;
    return loadFolder(dir);
  }

  async function savedFolderName() {
    const dir = await ISS.store.get('kv', 'musicFolder').catch(() => null);
    return dir ? dir.name : '';
  }

  async function urlFor(item) {
    if (item.url) return item.url;
    const file = item.file || (await item.handle.getFile());
    item.url = URL.createObjectURL(file);
    return item.url;
  }

  async function play(i) {
    if (i == null) i = st.index >= 0 ? st.index : 0;
    const item = st.items[i];
    if (!item) return;
    const a = el();
    ISS.engine.connectMediaElement(a);
    if (st.index !== i || !a.src) {
      const prev = st.items[st.index];
      st.index = i;
      a.src = await urlFor(item);
      // Free memory from the previous track's object URL.
      if (prev && prev !== item && prev.url) {
        URL.revokeObjectURL(prev.url);
        prev.url = null;
      }
      const info = parseName(item.name);
      ISS.nowPlaying && ISS.nowPlaying.set('station', info);
    }
    await a.play();
    emit();
  }

  function pause() {
    if (st.el) st.el.pause();
    emit();
  }

  function toggle() {
    if (st.el && !st.el.paused) pause();
    else play().catch((err) => ISS.emit('toast', { msg: String(err.message || err), kind: 'warn' }));
  }

  function next(auto) {
    if (!st.items.length) return;
    let i;
    if (st.shuffle && st.items.length > 1) {
      do i = Math.floor(Math.random() * st.items.length);
      while (i === st.index);
    } else {
      i = st.index + 1;
      if (i >= st.items.length) {
        if (auto && st.repeat === 'off') {
          pause();
          ISS.nowPlaying && ISS.nowPlaying.clear('station');
          return;
        }
        i = 0;
      }
    }
    play(i).catch(() => {});
  }

  function prev() {
    if (!st.items.length) return;
    if (st.el && st.el.currentTime > 3) {
      st.el.currentTime = 0;
      return;
    }
    play((st.index - 1 + st.items.length) % st.items.length).catch(() => {});
  }

  function stop() {
    if (st.el) {
      st.el.pause();
      st.el.currentTime = 0;
    }
    ISS.nowPlaying && ISS.nowPlaying.clear('station');
    emit();
  }

  function remove(i) {
    const item = st.items[i];
    if (!item) return;
    if (i === st.index) stop();
    if (item.url) URL.revokeObjectURL(item.url);
    st.items.splice(i, 1);
    if (st.index > i) st.index--;
    else if (st.index === i) st.index = -1;
    emit();
  }

  function clear() {
    stop();
    for (const i of st.items) if (i.url) URL.revokeObjectURL(i.url);
    st.items = [];
    st.index = -1;
    st.folderName = '';
    if (st.el) st.el.removeAttribute('src');
    emit();
  }

  function seek(fraction) {
    const a = st.el;
    if (a && isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(1, fraction)) * a.duration;
  }

  function position() {
    const a = st.el;
    if (!a || !isFinite(a.duration)) return { t: 0, d: 0 };
    return { t: a.currentTime, d: a.duration };
  }

  function isPlaying() {
    return !!(st.el && !st.el.paused && !st.el.ended);
  }

  ISS.station = {
    state: st,
    parseName,
    addFiles,
    openFolder,
    restoreFolder,
    savedFolderName,
    play,
    pause,
    toggle,
    next,
    prev,
    stop,
    remove,
    clear,
    seek,
    position,
    isPlaying,
    setShuffle: (v) => {
      st.shuffle = !!v;
      emit();
    },
    setRepeat: (v) => {
      st.repeat = v;
      emit();
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = ISS.station;
})(typeof globalThis !== 'undefined' ? globalThis : this);
