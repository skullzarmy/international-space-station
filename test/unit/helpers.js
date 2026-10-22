'use strict';
// Load page modules into a fresh fake global per test file.
const path = require('node:path');
const PAGE = path.join(__dirname, '..', '..', 'extension', 'src', 'page');

function load(...names) {
  for (const n of names) {
    const p = path.join(PAGE, n);
    delete require.cache[require.resolve(p)];
  }
  const out = {};
  for (const n of names) out[n.replace('.js', '')] = require(path.join(PAGE, n));
  return out;
}

module.exports = { load };
