// Build release files into dist/:
//   iss-extension-<version>.zip   Chrome / Edge / Brave / Opera (load or upload)
//   iss.user.js                    userscript for Tampermonkey / Violentmonkey
// No dependencies. Run: npm run build
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const version = manifest.version;
const pageScripts = manifest.content_scripts.find((c) => c.world === 'MAIN').js;

// --- Userscript --------------------------------------------------------------
const header = `// ==UserScript==
// @name         ISS – International Space Station
// @namespace    https://github.com/skullzarmy/international-space-station
// @version      ${version}
// @description  ${manifest.description}
// @author       ISS contributors
// @license      Unlicense
// @homepageURL  https://github.com/skullzarmy/international-space-station
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
//
// Userscript build of the ISS browser extension. Everything works except
// reading the song title from another tab (that needs the extension).
`;
const body = pageScripts.map((f) => `\n// ---- ${f} ----\n` + fs.readFileSync(path.join(ext, f), 'utf8')).join('\n');
fs.writeFileSync(path.join(dist, 'iss.user.js'), header + body);

// --- Zip (stored + deflated entries, written by hand to avoid deps) ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}
const files = walk(ext).sort();
const locals = [];
const centrals = [];
let offset = 0;
for (const name of files) {
  const data = fs.readFileSync(path.join(ext, name));
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 10); // time/date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, deflated);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);
  offset += 30 + nameBuf.length + deflated.length;
}
const cdir = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdir.length, 12);
end.writeUInt32LE(offset, 16);
const zipPath = path.join(dist, `iss-extension-${version}.zip`);
fs.writeFileSync(zipPath, Buffer.concat([...locals, cdir, end]));

console.log(`dist/iss.user.js`);
console.log(`dist/${path.basename(zipPath)} (${files.length} files)`);
