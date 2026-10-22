'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { core } = load('core.js');

test('deepMerge keeps new defaults and stored values', () => {
  const m = core.deepMerge(core.DEFAULTS, { mic: { gain: 1.5 }, panel: { x: 100 }, unknown: 1, opus: { bitrate: 'bad' } });
  assert.equal(m.mic.gain, 1.5);
  assert.equal(m.mic.gate.enabled, false, 'nested default kept');
  assert.equal(m.panel.x, 100, 'null default accepts numbers');
  assert.equal(m.unknown, undefined);
  assert.equal(m.opus.bitrate, 128000, 'wrong type falls back to default');
});

test('defaults favour clean audio', () => {
  const d = core.DEFAULTS;
  assert.equal(d.processing.echoCancellation, false);
  assert.equal(d.processing.noiseSuppression, false);
  assert.equal(d.processing.autoGainControl, false);
  assert.equal(d.opus.dtx, false);
});
