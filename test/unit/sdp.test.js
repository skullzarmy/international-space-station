'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { sdp } = load('core.js', 'sdp.js');

const ANSWER = [
  'v=0',
  'o=- 123 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'c=IN IP4 0.0.0.0',
  'b=AS:32',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1',
  'a=rtpmap:0 PCMU/8000',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'b=AS:500',
  'a=rtpmap:96 H264/90000',
  '',
].join('\r\n');

test('rewrites the Opus fmtp line', () => {
  const out = sdp.mungeOpus(ANSWER, { stereo: true, bitrate: 192000, fec: true, dtx: false });
  const line = out.split('\r\n').find((l) => l.startsWith('a=fmtp:111'));
  const p = sdp.parseFmtp(line.slice('a=fmtp:111 '.length));
  assert.equal(p.get('minptime'), '10', 'keeps existing params');
  assert.equal(p.get('stereo'), '1');
  assert.equal(p.get('sprop-stereo'), '1');
  assert.equal(p.get('maxaveragebitrate'), '192000');
  assert.equal(p.get('usedtx'), '0');
  assert.equal(p.get('useinbandfec'), '1');
  assert.equal(p.get('maxplaybackrate'), '48000');
});

test('drops bandwidth caps only in audio sections', () => {
  const out = sdp.mungeOpus(ANSWER, {});
  assert.ok(!out.includes('b=AS:32'));
  assert.ok(out.includes('b=AS:500'));
});

test('keeps CRLF line endings and trailing newline', () => {
  const out = sdp.mungeOpus(ANSWER, {});
  assert.ok(out.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(out));
});

test('adds an fmtp line when Opus has none', () => {
  const s = 'v=0\r\nm=audio 9 RTP/SAVPF 109\r\na=rtpmap:109 opus/48000/2\r\n';
  const out = sdp.mungeOpus(s, { bitrate: 64000 });
  assert.match(out, /a=rtpmap:109 opus\/48000\/2\r\na=fmtp:109 [^\r]*maxaveragebitrate=64000/);
});

test('is idempotent', () => {
  const once = sdp.mungeOpus(ANSWER, {});
  assert.equal(sdp.mungeOpus(once, {}), once);
});

test('leaves SDP without Opus alone', () => {
  const s = 'v=0\r\nm=video 9 RTP/SAVPF 96\r\nb=AS:300\r\na=rtpmap:96 VP8/90000\r\n';
  assert.equal(sdp.mungeOpus(s, {}), s);
});

test('clamps bitrate to the Opus range', () => {
  assert.match(sdp.mungeOpus(ANSWER, { bitrate: 9e9 }), /maxaveragebitrate=510000/);
  assert.match(sdp.mungeOpus(ANSWER, { bitrate: 10 }), /maxaveragebitrate=6000/);
});

test('mono option', () => {
  assert.match(sdp.mungeOpus(ANSWER, { stereo: false }), /stereo=0;sprop-stereo=0/);
});
