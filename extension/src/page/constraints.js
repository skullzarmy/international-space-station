/*
 * Rewrites the audio constraints X passes to getUserMedia().
 *
 * X asks the browser for a "voice" microphone: echo cancellation, noise
 * suppression and automatic gain control all on. Those filters are built for
 * speech and wreck music: they pump the volume, gate out sustained notes and
 * smear cymbals. We strip every form of those requests (modern, legacy
 * `goog*`, and inside `advanced`) and put our own values in.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});

  const PROCESSING_KEYS = [
    'echoCancellation',
    'noiseSuppression',
    'autoGainControl',
    'voiceIsolation',
    'googEchoCancellation',
    'googEchoCancellation2',
    'googDAEchoCancellation',
    'googAutoGainControl',
    'googAutoGainControl2',
    'googNoiseSuppression',
    'googNoiseSuppression2',
    'googHighpassFilter',
    'googTypingNoiseDetection',
    'googAudioMirroring',
    'googExperimentalEchoCancellation',
    'googExperimentalAutoGainControl',
    'googExperimentalNoiseSuppression',
  ];

  function stripKeys(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
      if (PROCESSING_KEYS.includes(k)) continue;
      out[k] = v;
    }
    return out;
  }

  /**
   * @param {boolean|MediaTrackConstraints} audio  what X asked for
   * @param {object} s  ISS settings
   * @returns {MediaTrackConstraints}
   */
  function rewriteAudioConstraints(audio, s) {
    const p = (s && s.processing) || {};
    const opus = (s && s.opus) || {};
    let c = audio && typeof audio === 'object' ? stripKeys(audio) : {};

    // Legacy Chrome syntax: { mandatory: {...}, optional: [{...}] }
    if (c.mandatory) {
      c.mandatory = stripKeys(c.mandatory);
      c.mandatory.googEchoCancellation = !!p.echoCancellation;
      c.mandatory.googAutoGainControl = !!p.autoGainControl;
      c.mandatory.googNoiseSuppression = !!p.noiseSuppression;
      c.mandatory.googHighpassFilter = false;
    }
    if (Array.isArray(c.optional)) {
      c.optional = c.optional.map(stripKeys).filter((o) => Object.keys(o).length);
    }
    if (Array.isArray(c.advanced)) {
      c.advanced = c.advanced.map(stripKeys).filter((o) => Object.keys(o).length);
      if (!c.advanced.length) delete c.advanced;
    }

    if (!c.mandatory) {
      // `exact` would make getUserMedia fail on devices that can't comply,
      // so these are plain values (treated as "ideal").
      c.echoCancellation = !!p.echoCancellation;
      c.noiseSuppression = !!p.noiseSuppression;
      c.autoGainControl = !!p.autoGainControl;
      // Chrome/Safari voice isolation (unknown constraints are ignored).
      c.voiceIsolation = false;
      c.channelCount = { ideal: opus.stereo === false ? 1 : 2 };
      c.sampleRate = { ideal: 48000 };
      c.sampleSize = { ideal: 16 };
      c.latency = { ideal: 0.01 };
    }

    const dev = s && s.mic && s.mic.deviceId;
    if (dev) {
      if (c.mandatory) c.mandatory.sourceId = dev;
      else c.deviceId = { exact: dev };
    }
    return c;
  }

  /** Constraints for an extra input such as an instrument or audio interface. */
  function rawInputConstraints(deviceId, stereo) {
    const c = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
      channelCount: { ideal: stereo === false ? 1 : 2 },
      sampleRate: { ideal: 48000 },
      latency: { ideal: 0.01 },
    };
    if (deviceId) c.deviceId = { exact: deviceId };
    return c;
  }

  ISS.constraints = { rewriteAudioConstraints, rawInputConstraints, PROCESSING_KEYS };

  if (typeof module === 'object' && module.exports) module.exports = ISS.constraints;
})(typeof globalThis !== 'undefined' ? globalThis : this);
