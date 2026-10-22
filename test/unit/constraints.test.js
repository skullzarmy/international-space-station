'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { core, constraints } = load('core.js', 'constraints.js');
const S = () => core.deepMerge(core.DEFAULTS, {});

test('turns off voice processing on `audio: true`', () => {
  const c = constraints.rewriteAudioConstraints(true, S());
  assert.equal(c.echoCancellation, false);
  assert.equal(c.noiseSuppression, false);
  assert.equal(c.autoGainControl, false);
  assert.equal(c.voiceIsolation, false);
  assert.deepEqual(c.channelCount, { ideal: 2 });
  assert.deepEqual(c.sampleRate, { ideal: 48000 });
});

test('overrides what X asked for, including exact and advanced', () => {
  const c = constraints.rewriteAudioConstraints(
    {
      echoCancellation: { exact: true },
      noiseSuppression: true,
      autoGainControl: { ideal: true },
      deviceId: 'abc',
      advanced: [{ echoCancellation: true }, { channelCount: 1 }],
    },
    S()
  );
  assert.equal(c.echoCancellation, false);
  assert.equal(c.noiseSuppression, false);
  assert.equal(c.autoGainControl, false);
  assert.equal(c.deviceId, 'abc', 'keeps X device choice when ISS has none');
  assert.deepEqual(c.advanced, [{ channelCount: 1 }]);
});

test('drops advanced entirely when only processing keys were in it', () => {
  const c = constraints.rewriteAudioConstraints({ advanced: [{ googNoiseSuppression: true }] }, S());
  assert.equal(c.advanced, undefined);
});

test('handles legacy goog constraints', () => {
  const c = constraints.rewriteAudioConstraints({ mandatory: { googEchoCancellation: true, googNoiseSuppression2: true, sourceId: 'x' }, optional: [{ googHighpassFilter: true }, { foo: 1 }] }, S());
  assert.equal(c.mandatory.googEchoCancellation, false);
  assert.equal(c.mandatory.googNoiseSuppression, false);
  assert.equal(c.mandatory.googNoiseSuppression2, undefined);
  assert.equal(c.mandatory.sourceId, 'x');
  assert.deepEqual(c.optional, [{ foo: 1 }]);
});

test('respects user processing choices and mic pick', () => {
  const s = S();
  s.processing.echoCancellation = true;
  s.mic.deviceId = 'mic-2';
  s.opus.stereo = false;
  const c = constraints.rewriteAudioConstraints({ deviceId: 'mic-1' }, s);
  assert.equal(c.echoCancellation, true);
  assert.equal(c.noiseSuppression, false);
  assert.deepEqual(c.deviceId, { exact: 'mic-2' });
  assert.deepEqual(c.channelCount, { ideal: 1 });
});

test('does not mutate the caller object', () => {
  const orig = { echoCancellation: true };
  constraints.rewriteAudioConstraints(orig, S());
  assert.deepEqual(orig, { echoCancellation: true });
});

test('raw input constraints', () => {
  const c = constraints.rawInputConstraints('dev', true);
  assert.deepEqual(c.deviceId, { exact: 'dev' });
  assert.equal(c.autoGainControl, false);
  assert.equal(constraints.rawInputConstraints('', true).deviceId, undefined);
});
