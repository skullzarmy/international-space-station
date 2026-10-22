// End-to-end test: load the real extension in Chromium against a fake x.com.
// Usage: npm run test:e2e   (set HEADED=1 to watch)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const extPath = path.join(root, 'extension');
const fixture = fs.readFileSync(path.join(here, 'fixtures', 'space.html'), 'utf8');
const shotDir = path.join(root, 'test-results');
fs.mkdirSync(shotDir, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (_) {
    const req = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'));
    return req('playwright');
  }
}

const { chromium } = await loadPlaywright();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iss-e2e-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  viewport: { width: 1200, height: 860 },
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(['FAIL', name]);
    console.log(`  ✗ ${name}\n    ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 4).join('\n    ')}`);
  }
}

const chatFrames = [];
const apiCalls = [];
try {
  // Fake x.com: serve the fixture for page loads, record API calls.
  await ctx.route('https://x.com/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/i/api/')) {
      apiCalls.push({ url: req.url(), body: req.postData(), headers: await req.allHeaders() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
  });
  await ctx.routeWebSocket(/chatapi\/v1\/chatnow/, (ws) => {
    ws.onMessage((m) => chatFrames.push(String(m)));
  });

  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('https://x.com/i/spaces/1YqKDqWqdPLsV');

  console.log('ISS end-to-end');

  await step('ISS loads in the page before X code runs', async () => {
    await page.waitForFunction(() => window.__ISS__ && window.__ISS__.started);
    const v = await page.evaluate(() => window.__ISS__.version);
    assert.match(v, /^\d+\.\d+\.\d+$/);
  });

  await step('control panel mounts and opens', async () => {
    await page.waitForSelector('#iss-international-space-station', { state: 'attached' });
    await page.evaluate(() => window.__ISS__.ui.open());
    const tabs = await page.evaluate(() =>
      [...document.querySelector('#iss-international-space-station').shadowRoot.querySelectorAll('nav button')].map((b) => b.textContent)
    );
    assert.deepEqual(tabs, ['Mixer', 'Board', 'Station', 'React', 'Setup']);
  });

  let speak;
  await step('X’s mic request is taken over with voice processing off', async () => {
    speak = await page.evaluate(() => window.fakeX.speak());
    const info = await page.evaluate(() => {
      const ISS = window.__ISS__;
      const mic = ISS.engine.mic.stream.getAudioTracks()[0].getSettings();
      return {
        mic,
        sentIsOurs: ISS.engine.isOutput(window.fakeX.sentTrack),
        senderIsOurs: ISS.engine.isOutput(window.fakeX.pc1.getSenders()[0].track),
      };
    });
    assert.equal(info.mic.echoCancellation, false, 'echo cancellation off');
    assert.equal(info.mic.noiseSuppression, false, 'noise suppression off');
    assert.equal(info.mic.autoGainControl, false, 'auto gain off');
    assert.ok(info.sentIsOurs, 'X got the ISS mix track');
    assert.ok(info.senderIsOurs, 'WebRTC is sending the ISS mix');
  });

  await step('Opus is negotiated as stereo, high bitrate, no DTX', async () => {
    const fmtp = speak.remoteSdp.split(/\r?\n/).find((l) => /^a=fmtp:111 /.test(l)) || '';
    assert.match(fmtp, /stereo=1/);
    assert.match(fmtp, /maxaveragebitrate=128000/);
    assert.match(fmtp, /usedtx=0/);
    const local = speak.localSdp.split(/\r?\n/).find((l) => /^a=fmtp:111 /.test(l)) || '';
    assert.match(local, /sprop-stereo=1/);
  });

  await step('X swapping in its own audio track gets the ISS mix instead', async () => {
    const ok = await page.evaluate(async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      const xTrack = dest.stream.getAudioTracks()[0];
      const sender = window.fakeX.pc1.getSenders()[0];
      await sender.replaceTrack(xTrack);
      return window.__ISS__.engine.isOutput(sender.track);
    });
    assert.ok(ok);
  });

  await step('soundboard audio reaches the other side of the call', async () => {
    await page.evaluate(() => {
      const ISS = window.__ISS__;
      const ctx = ISS.engine.ensure();
      const buf = ctx.createBuffer(2, ctx.sampleRate * 3, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / ctx.sampleRate);
      }
      ISS.engine.playBuffer(buf, { id: 'test' });
    });
    await page.waitForTimeout(400);
    const lv = await page.evaluate(() => Object.assign({ state: window.__ISS__.engine.ctx.state }, window.__ISS__.engine.levels()));
    assert.ok(lv.fx > -20, `fx meter ${JSON.stringify(lv)}`);
    assert.ok(lv.master > -20, `master meter ${JSON.stringify(lv)}`);
    await page.waitForTimeout(1500);
    const level = await page.evaluate(() => window.fakeX.receivedLevel());
    const dbg = await page.evaluate(async () => {
      const out = [];
      for (const pc of [window.fakeX.pc1, window.fakeX.pc2]) {
        (await pc.getStats()).forEach((s) => {
          if (/rtp/.test(s.type)) out.push({ t: s.type, k: s.kind, bytesSent: s.bytesSent, bytesReceived: s.bytesReceived, audioLevel: s.audioLevel, e: s.totalAudioEnergy });
        });
      }
      const t = window.fakeX.pc1.getSenders()[0].track;
      out.push({ senderTrack: t && t.readyState, enabled: t && t.enabled, muted: t && t.muted });
      return out;
    });
    assert.ok(level > 0.05, `remote audio level ${level} ${JSON.stringify(dbg)}`);
  });

  await step('custom emoji reactions go out on X’s chat socket', async () => {
    await page.evaluate(() => window.fakeX.joinChat('1YqKDqWqdPLsV'));
    await page.waitForFunction(() => window.__ISS__.chat.status().linked);
    const r = await page.evaluate(() => window.__ISS__.chat.sendReaction('🦖'));
    assert.ok(r.ok, JSON.stringify(r));
    await page.waitForTimeout(200);
    const reaction = chatFrames.map((f) => JSON.parse(f)).find((f) => f.kind === 1 && f.type === 2);
    assert.ok(reaction, 'reaction frame sent');
    const payload = JSON.parse(reaction.payload);
    assert.equal(payload.room, '1YqKDqWqdPLsV');
    assert.equal(JSON.parse(payload.body).body, '🦖');
  });

  await step('title editing is learned from X’s own request and replayed', async () => {
    const marker = await page.evaluate(() => {
      const { marker, promise } = window.__ISS__.titles.startLearning(10000);
      window.__learned = promise;
      return marker;
    });
    await page.evaluate((m) => window.fakeX.editTitle('1YqKDqWqdPLsV', m), marker);
    const tpl = await page.evaluate(() => window.__learned);
    assert.ok(tpl, 'template learned');
    await page.evaluate(() => (document.cookie = 'ct0=freshtoken; path=/'));
    const r = await page.evaluate(() => window.__ISS__.titles.applyTitle('🎵 Daft Punk - "One More Time"', { force: true }));
    assert.ok(r.ok, JSON.stringify(r));
    const last = apiCalls[apiCalls.length - 1];
    const body = JSON.parse(last.body);
    assert.equal(body.variables.title, '🎵 Daft Punk - "One More Time"');
    assert.equal(body.variables.audio_space_id, '1YqKDqWqdPLsV');
    assert.equal(last.headers['x-csrf-token'], 'freshtoken', 'fresh CSRF token used');
  });

  await step('leaving the Space releases the real microphone', async () => {
    await page.evaluate(() => window.fakeX.pc1.getSenders().forEach((s) => s.track && s.track.stop()));
    await page.evaluate(() => window.fakeX.sentTrack.stop());
    await page.waitForFunction(() => !window.__ISS__.engine.mic.stream, null, { timeout: 5000 });
  });

  await step('panel screenshots', async () => {
    const host = page.locator('#iss-international-space-station');
    for (const tab of ['Mixer', 'Board', 'Station', 'React', 'Setup']) {
      await page.evaluate((t) => {
        const b = [...document.querySelector('#iss-international-space-station').shadowRoot.querySelectorAll('nav button')].find((x) => x.textContent === t);
        b.click();
      }, tab);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(shotDir, `panel-${tab.toLowerCase()}.png`) });
    }
    assert.ok(await host.count());
  });

  const errors = logs.filter((l) => /\[ISS\].*(fail|error)/i.test(l));
  await step('no ISS errors in the console', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
