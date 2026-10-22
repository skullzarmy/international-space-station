'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { chat } = load('core.js', 'chat.js');

test('reaction frame matches the Periscope chat format', () => {
  const frame = JSON.parse(chat.buildReactionFrame('1YqKDqWqdPLsV', '🦖'));
  assert.equal(frame.kind, 1);
  assert.equal(frame.type, 2);
  const body = JSON.parse(frame.body);
  assert.deepEqual(body, { body: '🦖', type: 2, v: 2 });
  const payload = JSON.parse(frame.payload);
  assert.equal(payload.room, '1YqKDqWqdPLsV');
  assert.deepEqual(JSON.parse(payload.body), body);
});

test('detects the room from the join frame', () => {
  const join = JSON.stringify({ payload: JSON.stringify({ body: JSON.stringify({ room: 'ROOM123' }), kind: 1 }), kind: 2 });
  assert.deepEqual(chat.parseOutgoing(join), { kind: 'join', room: 'ROOM123' });
  const auth = JSON.stringify({ payload: JSON.stringify({ access_token: 'secret' }), kind: 3 });
  assert.deepEqual(chat.parseOutgoing(auth), { kind: 'auth' });
  assert.equal(chat.parseOutgoing('not json'), null);
});

test('our own reaction frame is recognised as chat in that room', () => {
  assert.deepEqual(chat.parseOutgoing(chat.buildReactionFrame('R1', '🔥')), { kind: 'chat', room: 'R1' });
});

test('parses incoming reactions and occupancy', () => {
  const r = JSON.stringify({ kind: 1, payload: JSON.stringify({ sender: { display_name: 'Ada' }, body: JSON.stringify({ body: '🚀', type: 2, v: 2 }) }) });
  assert.deepEqual(chat.parseIncoming(r), { type: 'reaction', emoji: '🚀', name: 'Ada' });
  const o = JSON.stringify({ kind: 2, payload: JSON.stringify({ body: JSON.stringify({ occupancy: 42, total_participants: 99 }) }) });
  assert.deepEqual(chat.parseIncoming(o), { type: 'occupancy', occupancy: 42, total: 99 });
  assert.equal(chat.parseIncoming('{}'), null);
});

test('recognises chat socket URLs', () => {
  assert.ok(chat.isChatUrl('wss://prod-chatman-ancillary-us-east-1.pscp.tv/chatapi/v1/chatnow'));
  assert.ok(!chat.isChatUrl('wss://example.com/socket'));
});
