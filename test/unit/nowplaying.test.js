'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { nowplaying, station } = load('core.js', 'nowplaying.js', 'station.js');

test('cleans common player tab titles', () => {
  const c = nowplaying.cleanTabTitle;
  assert.equal(c('(3) Daft Punk - Around the World - YouTube', 'https://www.youtube.com/watch?v=x'), 'Daft Punk - Around the World');
  assert.equal(c('▶ Nils Frahm - Says - YouTube Music'), 'Nils Frahm - Says');
  assert.equal(c('Stream Windowlicker by Aphex Twin | Listen online for free on SoundCloud'), 'Aphex Twin - Windowlicker');
  assert.equal(c('Teardrop • Massive Attack', 'https://open.spotify.com/'), 'Massive Attack - Teardrop');
  assert.equal(c('Spotify – Web Player', 'https://open.spotify.com/'), '');
  assert.equal(c('YouTube'), '');
});

test('splits artist and track', () => {
  assert.deepEqual(nowplaying.infoFromTitle('A - B'), { artist: 'A', track: 'B', title: 'A - B' });
  assert.deepEqual(nowplaying.infoFromTitle('Solo'), { artist: '', track: 'Solo', title: 'Solo' });
});

test('station parses file names', () => {
  assert.deepEqual(station.parseName('03 - Boards of Canada - Roygbiv.flac'), { artist: 'Boards of Canada', track: 'Roygbiv', title: 'Boards of Canada - Roygbiv' });
  assert.deepEqual(station.parseName('my_mix.mp3'), { artist: '', track: 'my mix', title: 'my mix' });
});
