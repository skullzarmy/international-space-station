/*
 * ISS core: shared namespace, settings, events, logging.
 *
 * Every file in src/page/ runs in the page's own JavaScript world (Chrome's
 * "MAIN" world) on x.com, before X's own code. They share one global
 * namespace, `__ISS__`. Each file also exports its module when loaded under
 * Node, so the pure logic can be unit tested without a browser.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});
  ISS.version = '0.1.0';

  // Keep references to native APIs before X (or anything else) can wrap them.
  ISS.native = ISS.native || {};

  // ---------------------------------------------------------------------------
  // Tiny event emitter
  // ---------------------------------------------------------------------------
  const listeners = new Map();
  ISS.on = function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  };
  ISS.emit = function emit(type, detail) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(detail);
      } catch (err) {
        ISS.log.error('listener for', type, 'failed:', err);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------
  const tag = '%c[ISS]';
  const style = 'color:#5ad;font-weight:bold';
  ISS.log = {
    debugEnabled: false,
    info: (...a) => console.info(tag, style, ...a),
    warn: (...a) => console.warn(tag, style, ...a),
    error: (...a) => console.error(tag, style, ...a),
    debug: (...a) => {
      if (ISS.log.debugEnabled) console.debug(tag, style, ...a);
    },
  };

  // ---------------------------------------------------------------------------
  // Settings (stored in localStorage on x.com; nothing ever leaves the browser)
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    enabled: true,

    // Browser voice processing applied to the mic. X turns these on; ISS
    // turns them off so music and instruments come through untouched.
    // Turning echo cancellation off means you should wear headphones.
    processing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },

    // Opus encoder settings negotiated with X's media server.
    opus: {
      enabled: true,
      stereo: true,
      bitrate: 128000,
      fec: true,
      dtx: false,
    },

    // Replace any audio track X tries to send with the ISS mix, even if X
    // ran the mic through its own processing first.
    forceDirect: true,

    mic: {
      deviceId: '', // '' = whatever X asks for
      gain: 1,
      muted: false, // ISS-side mic mute (music keeps playing)
      highpass: { enabled: false, frequency: 80 },
      compressor: { enabled: false, threshold: -24, ratio: 4 },
      gate: { enabled: false, threshold: -55 },
      monitor: false, // hear your own mic (usually leave off)
    },

    aux: { deviceId: '', gain: 1, monitor: true },
    musicGain: 0.8,
    fxGain: 0.9,
    masterGain: 1,

    // Local monitoring: lets you hear music and sounds you send.
    monitor: { enabled: true, gain: 0.6, sinkId: '' },

    // Lower the music while you talk.
    ducking: { enabled: false, threshold: -42, amount: 0.25, release: 0.6 },

    reactions: {
      favorites: ['🎵', '🎶', '🔥', '🚀', '🛰️', '👽', '🎸', '🥁', '🎹', '🎤', '💯', '🙏'],
      autoWhilePlaying: false,
      autoEmoji: '🎵',
      autoInterval: 20,
    },

    nowPlaying: {
      toTitle: false,
      template: '🎵 {title}',
      reactOnChange: false,
      reactEmoji: '🎶',
      fromSharedTab: false,
    },

    hotkeys: true,
    panel: { open: false, tab: 'mix', x: null, y: null },
    debug: false,
  };
  ISS.DEFAULTS = DEFAULTS;

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // Merge stored values onto defaults so new settings appear after upgrades.
  function deepMerge(base, over) {
    if (!isPlainObject(over)) return structuredCloneSafe(base);
    const out = {};
    for (const k of Object.keys(base)) {
      const b = base[k];
      const o = over[k];
      if (isPlainObject(b)) out[k] = deepMerge(b, o);
      else if (o === undefined || (b !== null && typeof o !== typeof b)) out[k] = structuredCloneSafe(b);
      else out[k] = structuredCloneSafe(o);
    }
    return out;
  }
  ISS.deepMerge = deepMerge;

  function structuredCloneSafe(v) {
    if (v === null || typeof v !== 'object') return v;
    return JSON.parse(JSON.stringify(v));
  }

  const STORAGE_KEY = 'iss.settings.v1';

  function loadSettings() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      return deepMerge(DEFAULTS, raw ? JSON.parse(raw) : {});
    } catch (_) {
      return deepMerge(DEFAULTS, {});
    }
  }

  ISS.settings = loadSettings();
  ISS.log.debugEnabled = !!ISS.settings.debug;

  let saveTimer = null;
  ISS.saveSettings = function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        root.localStorage.setItem(STORAGE_KEY, JSON.stringify(ISS.settings));
      } catch (_) {
        /* storage full or blocked; settings stay in memory */
      }
    }, 150);
  };

  // Set a dotted path, e.g. ISS.set('mic.gain', 1.2)
  ISS.set = function set(path, value) {
    const parts = path.split('.');
    let obj = ISS.settings;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    if (path === 'debug') ISS.log.debugEnabled = !!value;
    ISS.saveSettings();
    ISS.emit('settings', { path, value });
  };

  ISS.get = function get(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), ISS.settings);
  };

  ISS.resetSettings = function resetSettings() {
    ISS.settings = deepMerge(DEFAULTS, {});
    ISS.saveSettings();
    ISS.emit('settings', { path: '*', value: null });
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = { ISS, DEFAULTS, deepMerge };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
