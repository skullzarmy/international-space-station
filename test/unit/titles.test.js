'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { titles } = load('core.js', 'titles.js');

const marker = 'ISS "4821" test';

test('learns a JSON GraphQL-style request and replays with a new title', () => {
  const body = JSON.stringify({ variables: { id: '1YqKDqWqdPLsV', title: marker }, queryId: 'abc' });
  const tpl = titles.learnFromRequest(
    { url: 'https://x.com/i/api/graphql/abc/EditSpace', method: 'post', body, headers: { 'Content-Type': 'application/json', Cookie: 'x', 'x-csrf-token': 'old' } },
    marker,
    { room: '1YqKDqWqdPLsV', space: '' }
  );
  assert.equal(tpl.bodyEnc, 'json');
  assert.equal(tpl.method, 'POST');
  assert.equal(tpl.headers.cookie, undefined);
  assert.ok(!tpl.body.includes('1YqKDqWqdPLsV'), 'Space id is a placeholder');

  const title = 'AC/DC - "Thunder" & more';
  const filled = titles.renderIds(titles.render(tpl.body, title, tpl.bodyEnc), { room: 'NEWROOM12345' });
  const parsed = JSON.parse(filled);
  assert.equal(parsed.variables.title, title);
  assert.equal(parsed.variables.id, 'NEWROOM12345');
});

test('learns URL-encoded GET requests', () => {
  const vars = encodeURIComponent(JSON.stringify({ title: marker }));
  const tpl = titles.learnFromRequest({ url: `https://x.com/i/api/graphql/q/Op?variables=${vars}`, method: 'GET' }, marker, {});
  assert.equal(tpl.urlEnc, 'uri-json');
  const url = titles.render(tpl.url, 'Björk - Jóga', tpl.urlEnc);
  const v = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('variables')));
  assert.equal(v.title, 'Björk - Jóga');
});

test('learns form-encoded bodies', () => {
  const body = new URLSearchParams({ broadcast_id: 'B', title: marker }).toString();
  const tpl = titles.learnFromRequest({ url: 'https://example.pscp.tv/api/v2/x', method: 'POST', body }, marker, {});
  assert.equal(tpl.bodyEnc, 'form');
  const out = new URLSearchParams(titles.render(tpl.body, 'A + B = C', tpl.bodyEnc));
  assert.equal(out.get('title'), 'A + B = C');
});

test('ignores unrelated requests', () => {
  assert.equal(titles.learnFromRequest({ url: 'https://x.com/i/api/other', method: 'POST', body: '{"a":1}' }, marker, {}), null);
});

test('socket templates', () => {
  const frame = JSON.stringify({ payload: JSON.stringify({ room: 'ROOM1234', body: JSON.stringify({ title: marker }) }) });
  const tpl = titles.learnFromSocket(frame, marker, { room: 'ROOM1234' });
  assert.ok(tpl);
  const out = titles.renderIds(titles.render(tpl.frame, 'New "song"', tpl.enc), { room: 'ROOM9999' });
  const p = JSON.parse(JSON.parse(out).payload);
  assert.equal(p.room, 'ROOM9999');
  assert.equal(JSON.parse(p.body).title, 'New "song"');
});

test('renderIds refuses when the Space is unknown', () => {
  assert.equal(titles.renderIds(`x${titles.ID_PLACEHOLDERS.room}`, {}), null);
  assert.equal(titles.renderIds(`x${titles.ID_PLACEHOLDERS.room}`, { space: 'SPACE123' }), 'xSPACE123');
});

test('markers are distinguishable in every encoding', () => {
  const m = titles.makeMarker();
  assert.match(m, /^ISS "\d{4}" test$/);
  for (const enc of ['json', 'uri-json', 'uri', 'form', 'raw']) {
    // build text with that encoding and check we identify it
    const enc2 = {
      json: JSON.stringify(m).slice(1, -1),
      'uri-json': encodeURIComponent(JSON.stringify(m).slice(1, -1)),
      uri: encodeURIComponent(m),
      form: new URLSearchParams({ x: m }).toString().slice(2),
      raw: m,
    }[enc];
    assert.equal(titles.findEncoding(`a=${enc2}&b`, m), enc);
  }
});

test('fillTitle template and length cap', () => {
  assert.equal(titles.fillTitle('🎵 {title}', { title: 'A - B' }), '🎵 A - B');
  assert.equal(titles.fillTitle('{artist} | {track}', { artist: 'A', track: 'B', title: 'A - B' }), 'A | B');
  const long = titles.fillTitle('{title}', { title: 'x'.repeat(200) });
  assert.equal([...long].length, 70);
});
