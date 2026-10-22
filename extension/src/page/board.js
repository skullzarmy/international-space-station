/*
 * Soundboard: drop in audio clips, trigger them with a click or Alt+key.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});

  // Alt + these keys trigger pads in order.
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
  const MAX_BYTES = 15 * 1024 * 1024;

  const state = {
    pads: [], // { id, name, emoji, gain, loop, mode, order, type, data }
    buffers: new Map(),
    loaded: false,
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function load() {
    if (state.loaded) return state.pads;
    try {
      const rows = await ISS.store.all('sounds');
      state.pads = (rows || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    } catch (err) {
      ISS.log.warn('could not load soundboard', err);
      state.pads = [];
    }
    state.loaded = true;
    ISS.emit('board', state.pads);
    return state.pads;
  }

  async function addFiles(files) {
    const added = [];
    const skipped = [];
    for (const file of files) {
      if (!/^audio\/|^video\//.test(file.type) && !/\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm|mp4)$/i.test(file.name)) {
        skipped.push(`${file.name} (not audio)`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        skipped.push(`${file.name} (over 15 MB)`);
        continue;
      }
      const data = await file.arrayBuffer();
      try {
        const buf = await ISS.engine.decode(data);
        const pad = {
          id: uid(),
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 40),
          emoji: '',
          gain: 1,
          loop: false,
          mode: 'restart', // restart | toggle | overlap
          order: state.pads.length,
          type: file.type,
          data,
        };
        state.buffers.set(pad.id, buf);
        await ISS.store.put('sounds', pad);
        state.pads.push(pad);
        added.push(pad);
      } catch (_) {
        skipped.push(`${file.name} (could not decode)`);
      }
    }
    ISS.emit('board', state.pads);
    return { added, skipped };
  }

  async function update(id, patch) {
    const pad = state.pads.find((p) => p.id === id);
    if (!pad) return;
    Object.assign(pad, patch);
    await ISS.store.put('sounds', pad);
    ISS.emit('board', state.pads);
  }

  async function remove(id) {
    ISS.engine.stopPads(id);
    state.pads = state.pads.filter((p) => p.id !== id);
    state.buffers.delete(id);
    await ISS.store.del('sounds', id);
    state.pads.forEach((p, i) => (p.order = i));
    await Promise.all(state.pads.map((p) => ISS.store.put('sounds', p)));
    ISS.emit('board', state.pads);
  }

  async function move(id, delta) {
    const i = state.pads.findIndex((p) => p.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.pads.length) return;
    const [p] = state.pads.splice(i, 1);
    state.pads.splice(j, 0, p);
    state.pads.forEach((x, k) => (x.order = k));
    await Promise.all(state.pads.map((x) => ISS.store.put('sounds', x)));
    ISS.emit('board', state.pads);
  }

  async function bufferFor(pad) {
    let buf = state.buffers.get(pad.id);
    if (!buf) {
      buf = await ISS.engine.decode(pad.data);
      state.buffers.set(pad.id, buf);
    }
    return buf;
  }

  async function trigger(id) {
    const pad = state.pads.find((p) => p.id === id);
    if (!pad) return;
    const playing = ISS.engine.isPadPlaying(id);
    if (playing && (pad.mode === 'toggle' || pad.loop)) {
      ISS.engine.stopPads(id);
      ISS.emit('pad', { id, playing: false });
      return;
    }
    if (playing && pad.mode === 'restart') ISS.engine.stopPads(id);
    const buf = await bufferFor(pad);
    ISS.engine.playBuffer(buf, { id, gain: pad.gain, loop: pad.loop });
    ISS.emit('pad', { id, playing: true });
  }

  function triggerIndex(i) {
    const pad = state.pads[i];
    if (pad) trigger(pad.id);
  }

  function stopAll() {
    ISS.engine.stopPads();
    ISS.emit('pad', { id: null, playing: false });
  }

  function keyFor(index) {
    return KEYS[index] || '';
  }

  function onKeyDown(e) {
    if (!ISS.settings.hotkeys || !e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'Backquote') {
      stopAll();
      e.preventDefault();
      return;
    }
    let k = '';
    if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    const i = KEYS.indexOf(k);
    if (i === -1 || !state.pads[i]) return;
    e.preventDefault();
    e.stopPropagation();
    triggerIndex(i);
  }

  function installHotkeys() {
    root.addEventListener('keydown', onKeyDown, true);
  }

  ISS.board = {
    state,
    load,
    addFiles,
    update,
    remove,
    move,
    trigger,
    triggerIndex,
    stopAll,
    keyFor,
    installHotkeys,
    KEYS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
