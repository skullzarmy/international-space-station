/*
 * SDP tuning for the Opus audio codec.
 *
 * X Spaces sends speaker audio over WebRTC to a Janus "videoroom" server,
 * which forwards Opus packets to other speakers without re-encoding them.
 * Browsers default to mono, voice-tuned Opus at a low bitrate, with DTX
 * (silence suppression) that chops quiet passages in music. We rewrite the
 * Opus "fmtp" line on both the offer we send and the answer we get back:
 *
 *   stereo=1 / sprop-stereo=1   allow and announce stereo
 *   maxaveragebitrate=N         raise the encoder's target bitrate
 *   useinbandfec=1              keep packet-loss resilience
 *   usedtx=0                    never drop "silent" frames (fades, reverb)
 *   maxplaybackrate=48000       full band audio
 *
 * We also drop b=AS / b=TIAS bandwidth caps inside audio sections, because
 * a low cap there overrides maxaveragebitrate.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});

  function parseFmtp(params) {
    const map = new Map();
    for (const part of params.split(';')) {
      const s = part.trim();
      if (!s) continue;
      const eq = s.indexOf('=');
      if (eq === -1) map.set(s, null);
      else map.set(s.slice(0, eq).trim(), s.slice(eq + 1).trim());
    }
    return map;
  }

  function formatFmtp(map) {
    return [...map].map(([k, v]) => (v === null ? k : `${k}=${v}`)).join(';');
  }

  /**
   * @param {string} sdp
   * @param {{stereo?:boolean, bitrate?:number, fec?:boolean, dtx?:boolean, stripBandwidth?:boolean}} opts
   * @returns {string}
   */
  function mungeOpus(sdp, opts) {
    if (typeof sdp !== 'string' || !sdp) return sdp;
    const o = Object.assign({ stereo: true, bitrate: 128000, fec: true, dtx: false, stripBandwidth: true }, opts || {});
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);
    const trailing = lines.length && lines[lines.length - 1] === '' ? lines.pop() : null;

    // Find Opus payload types.
    const opusPts = new Set();
    for (const l of lines) {
      const m = /^a=rtpmap:(\d+) opus\/48000/i.exec(l);
      if (m) opusPts.add(m[1]);
    }
    if (!opusPts.size) return sdp;

    const bitrate = Math.max(6000, Math.min(510000, Math.round(Number(o.bitrate) || 128000)));
    const wanted = [
      ['stereo', o.stereo ? '1' : '0'],
      ['sprop-stereo', o.stereo ? '1' : '0'],
      ['maxaveragebitrate', String(bitrate)],
      ['maxplaybackrate', '48000'],
      ['useinbandfec', o.fec ? '1' : '0'],
      ['usedtx', o.dtx ? '1' : '0'],
    ];

    const out = [];
    let inAudio = false;
    for (const line of lines) {
      if (line.startsWith('m=')) inAudio = line.startsWith('m=audio');

      if (inAudio && o.stripBandwidth && /^b=(AS|TIAS):/.test(line)) continue;

      const fm = /^a=fmtp:(\d+) (.*)$/.exec(line);
      if (fm && opusPts.has(fm[1])) {
        const params = parseFmtp(fm[2]);
        for (const [k, v] of wanted) params.set(k, v);
        out.push(`a=fmtp:${fm[1]} ${formatFmtp(params)}`);
        continue;
      }
      out.push(line);

      // Opus with no fmtp line at all: add one right after its rtpmap.
      const rm = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
      if (rm && !lines.some((l) => l.startsWith(`a=fmtp:${rm[1]} `))) {
        out.push(`a=fmtp:${rm[1]} ${formatFmtp(new Map(wanted))}`);
      }
    }
    if (trailing !== null) out.push(trailing);
    return out.join(eol);
  }

  ISS.sdp = { mungeOpus, parseFmtp, formatFmtp };

  if (typeof module === 'object' && module.exports) module.exports = ISS.sdp;
})(typeof globalThis !== 'undefined' ? globalThis : this);
