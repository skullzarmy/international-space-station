/*
 * ISS audio engine: a small mixing desk built on the Web Audio API.
 *
 *   mic ──► high-pass ► compressor ► gate ► mic fader ─────────────┐
 *   aux (instrument / interface) ─────────► aux fader ─────────────┤
 *   Mix Station player ──► music fader ─┐                          ├─► master ► limiter ► OUTPUT (to X)
 *   shared tab audio ────► tab fader ───┴─► ducker ────────────────┤
 *   soundboard pads ─────► fx fader ───────────────────────────────┘
 *
 * OUTPUT is a MediaStream track that ISS hands to X in place of your raw
 * microphone. A separate "monitor" path lets you hear the player, pads and
 * (optionally) the aux input and your mic locally. Shared tab audio is not
 * monitored because the tab already plays through your speakers.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});

  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }
  function gainToDb(g) {
    return g <= 0.000001 ? -120 : 20 * Math.log10(g);
  }

  class Engine {
    constructor() {
      this.ctx = null;
      this.n = null;
      this.outputs = new Set(); // live clones handed to X
      this.mic = { stream: null, source: null };
      this.aux = { stream: null, source: null, deviceId: '' };
      this.tab = { stream: null, source: null };
      this.playerSources = new WeakMap();
      this.pads = new Set();
      this._gateOpen = true;
      this._gateHoldUntil = 0;
      this._duckHoldUntil = 0;
      this._releaseTimer = null;
      this._buf = null;
    }

    get running() {
      return !!this.ctx;
    }

    ensure() {
      if (this.ctx) return this.ctx;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not available in this browser');
      let ctx;
      try {
        ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
      } catch (_) {
        ctx = new AC();
      }
      this.ctx = ctx;
      const n = (this.n = {});
      const gain = (v = 1) => {
        const g = ctx.createGain();
        g.gain.value = v;
        return g;
      };
      const meter = () => {
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        a.smoothingTimeConstant = 0;
        return a;
      };

      // Master
      n.master = gain();
      n.limiter = ctx.createDynamicsCompressor();
      n.limiter.threshold.value = -1;
      n.limiter.knee.value = 0;
      n.limiter.ratio.value = 20;
      n.limiter.attack.value = 0.002;
      n.limiter.release.value = 0.08;
      n.dest = ctx.createMediaStreamDestination();
      try {
        n.dest.channelCount = 2;
      } catch (_) {
        /* some browsers fix this at 2 already */
      }
      n.masterMeter = meter();
      n.master.connect(n.limiter);
      n.limiter.connect(n.dest);
      n.limiter.connect(n.masterMeter);

      // Monitor (local listening)
      n.monitorBus = gain();
      n.monitorOut = gain(0);
      n.monitorBus.connect(n.monitorOut);
      n.monitorOut.connect(ctx.destination);

      // Mic chain
      n.micIn = gain();
      n.micDetect = meter();
      n.micHp = ctx.createBiquadFilter();
      n.micHp.type = 'highpass';
      n.micComp = ctx.createDynamicsCompressor();
      n.micGate = gain();
      n.micGain = gain();
      n.micMeter = meter();
      n.micMonitor = gain(0);
      n.micIn.connect(n.micDetect);
      n.micIn.connect(n.micHp);
      n.micHp.connect(n.micComp);
      n.micComp.connect(n.micGate);
      n.micGate.connect(n.micGain);
      n.micGain.connect(n.master);
      n.micGain.connect(n.micMeter);
      n.micGain.connect(n.micMonitor);
      n.micMonitor.connect(n.monitorBus);

      // Aux input
      n.auxIn = gain();
      n.auxGain = gain();
      n.auxMeter = meter();
      n.auxMonitor = gain(0);
      n.auxIn.connect(n.auxGain);
      n.auxGain.connect(n.master);
      n.auxGain.connect(n.auxMeter);
      n.auxGain.connect(n.auxMonitor);
      n.auxMonitor.connect(n.monitorBus);

      // Music: player + shared tab, both ducked
      n.music = gain();
      n.tabBus = gain();
      n.duck = gain();
      n.musicMeter = meter();
      n.music.connect(n.duck);
      n.tabBus.connect(n.duck);
      n.duck.connect(n.master);
      n.duck.connect(n.musicMeter);
      n.music.connect(n.monitorBus); // tab audio is already audible locally

      // Soundboard
      n.fx = gain();
      n.fxMeter = meter();
      n.fx.connect(n.master);
      n.fx.connect(n.fxMeter);
      n.fx.connect(n.monitorBus);

      this.applySettings();
      this._unsub = ISS.on('settings', () => this.applySettings());
      this._timer = setInterval(() => this._tick(), 25);

      // Browsers start audio suspended until the user interacts with the page.
      const resume = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      };
      for (const ev of ['pointerdown', 'keydown']) root.addEventListener(ev, resume, { capture: true, passive: true });
      resume();
      ISS.emit('engine', { running: true });
      return ctx;
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume();
      return Promise.resolve();
    }

    _set(param, value, tc) {
      const t = this.ctx.currentTime;
      param.cancelScheduledValues(t);
      param.setTargetAtTime(value, t, tc || 0.015);
    }

    applySettings() {
      if (!this.ctx) return;
      const s = ISS.settings;
      const n = this.n;
      const m = s.mic;

      n.micHp.frequency.value = m.highpass.enabled ? Number(m.highpass.frequency) || 80 : 10;
      if (m.compressor.enabled) {
        n.micComp.threshold.value = Number(m.compressor.threshold);
        n.micComp.ratio.value = Number(m.compressor.ratio);
        n.micComp.knee.value = 6;
        n.micComp.attack.value = 0.005;
        n.micComp.release.value = 0.15;
      } else {
        n.micComp.threshold.value = 0;
        n.micComp.ratio.value = 1;
        n.micComp.knee.value = 0;
      }
      if (!m.gate.enabled) this._set(n.micGate.gain, 1);

      this._set(n.micGain.gain, m.muted ? 0 : Number(m.gain));
      this._set(n.micMonitor.gain, m.monitor ? 1 : 0);
      this._set(n.auxGain.gain, Number(s.aux.gain));
      this._set(n.auxMonitor.gain, s.aux.monitor ? 1 : 0);
      this._set(n.music.gain, Number(s.musicGain));
      this._set(n.tabBus.gain, Number(s.musicGain));
      this._set(n.fx.gain, Number(s.fxGain));
      this._set(n.master.gain, Number(s.masterGain));
      this._set(n.monitorOut.gain, s.monitor.enabled ? Number(s.monitor.gain) : 0);
      if (!s.ducking.enabled) this._set(n.duck.gain, 1, 0.1);
      this.setMonitorDevice(s.monitor.sinkId);
    }

    setMonitorDevice(sinkId) {
      if (!this.ctx || typeof this.ctx.setSinkId !== 'function') return;
      const want = sinkId || '';
      if (this._sinkId === want) return;
      this._sinkId = want;
      this.ctx.setSinkId(want).catch((err) => ISS.log.warn('could not switch monitor output', err));
    }

    // -------------------------------------------------------------------------
    // Level detection: gate, ducking, meters
    // -------------------------------------------------------------------------
    _rmsDb(analyser) {
      if (!this._buf || this._buf.length !== analyser.fftSize) this._buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(this._buf);
      let sum = 0;
      for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
      return gainToDb(Math.sqrt(sum / this._buf.length));
    }

    _peakDb(analyser) {
      if (!this._buf || this._buf.length !== analyser.fftSize) this._buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(this._buf);
      let peak = 0;
      for (let i = 0; i < this._buf.length; i++) {
        const v = Math.abs(this._buf[i]);
        if (v > peak) peak = v;
      }
      return gainToDb(peak);
    }

    _tick() {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const s = ISS.settings;
      const n = this.n;
      const now = performance.now();
      const hasMic = !!this.mic.source;
      const micDb = hasMic ? this._rmsDb(n.micDetect) : -120;

      // Noise gate (with hysteresis and a short hold to avoid chattering)
      if (s.mic.gate.enabled) {
        const thr = Number(s.mic.gate.threshold);
        if (micDb > thr) {
          this._gateHoldUntil = now + 200;
          if (!this._gateOpen) {
            this._gateOpen = true;
            this._set(n.micGate.gain, 1, 0.004);
          }
        } else if (this._gateOpen && micDb < thr - 4 && now > this._gateHoldUntil) {
          this._gateOpen = false;
          this._set(n.micGate.gain, 0, 0.06);
        }
      }

      // Ducking: lower music while you speak
      if (s.ducking.enabled) {
        const speaking = hasMic && !s.mic.muted && this._gateOpen && micDb > Number(s.ducking.threshold);
        if (speaking) this._duckHoldUntil = now + Number(s.ducking.release) * 1000;
        const ducked = now < this._duckHoldUntil;
        if (ducked !== this._ducked) {
          this._ducked = ducked;
          this._set(n.duck.gain, ducked ? Number(s.ducking.amount) : 1, ducked ? 0.03 : 0.25);
          ISS.emit('duck', { ducked });
        }
      }
    }

    levels() {
      if (!this.ctx) return null;
      const n = this.n;
      return {
        mic: this.mic.source ? this._peakDb(n.micMeter) : -120,
        aux: this.aux.source ? this._peakDb(n.auxMeter) : -120,
        music: this._peakDb(n.musicMeter),
        fx: this._peakDb(n.fxMeter),
        master: this._peakDb(n.masterMeter),
        ducked: !!this._ducked,
      };
    }

    // -------------------------------------------------------------------------
    // Output handed to X
    // -------------------------------------------------------------------------
    createOutputTrack(likeTrack) {
      this.ensure();
      clearTimeout(this._releaseTimer);
      const base = this.n.dest.stream.getAudioTracks()[0];
      const track = base.clone();
      this.outputs.add(track);
      // Look like the real mic to X's device UI.
      if (likeTrack) {
        try {
          Object.defineProperty(track, 'label', { configurable: true, get: () => likeTrack.label });
          const ownSettings = track.getSettings.bind(track);
          Object.defineProperty(track, 'getSettings', {
            configurable: true,
            value: () => Object.assign({}, ownSettings(), likeTrack.getSettings ? likeTrack.getSettings() : {}, {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }),
          });
        } catch (_) {
          /* cosmetic only */
        }
      }
      ISS.emit('output', { count: this.outputs.size });
      return track;
    }

    isOutput(track) {
      if (!track) return false;
      if (this.outputs.has(track)) return true;
      return !!(this.n && this.n.dest.stream.getAudioTracks()[0] === track);
    }

    onOutputStopped(track) {
      if (!this.outputs.delete(track)) return;
      ISS.emit('output', { count: this.outputs.size });
      if (this.outputs.size === 0) {
        // X stopped using the mic (left the Space). Turn the real mic off too,
        // after a short grace period in case X is just switching devices.
        clearTimeout(this._releaseTimer);
        this._releaseTimer = setTimeout(() => {
          if (this.outputs.size === 0) this.releaseMic();
        }, 1500);
      }
    }

    get live() {
      for (const t of this.outputs) if (t.readyState === 'live') return true;
      return false;
    }

    // -------------------------------------------------------------------------
    // Inputs
    // -------------------------------------------------------------------------
    attachMic(stream) {
      this.ensure();
      if (this.mic.stream && this.mic.stream !== stream) this._stopStream(this.mic.stream);
      if (this.mic.source) this.mic.source.disconnect();
      this.mic.stream = stream;
      this.mic.source = this.ctx.createMediaStreamSource(stream);
      this.mic.source.connect(this.n.micIn);
      this.resume();
      ISS.emit('mic', { active: true, label: (stream.getAudioTracks()[0] || {}).label || '' });
    }

    releaseMic() {
      if (this.mic.source) this.mic.source.disconnect();
      if (this.mic.stream) this._stopStream(this.mic.stream);
      this.mic = { stream: null, source: null };
      ISS.emit('mic', { active: false });
    }

    async attachAux(deviceId) {
      this.ensure();
      this.detachAux();
      const gum = ISS.native.getUserMedia;
      const stream = await gum({ audio: ISS.constraints.rawInputConstraints(deviceId, ISS.settings.opus.stereo) });
      this.aux = { stream, source: this.ctx.createMediaStreamSource(stream), deviceId };
      this.aux.source.connect(this.n.auxIn);
      this.resume();
      ISS.emit('aux', { active: true, label: (stream.getAudioTracks()[0] || {}).label || '' });
    }

    detachAux() {
      if (this.aux.source) this.aux.source.disconnect();
      if (this.aux.stream) this._stopStream(this.aux.stream);
      const was = !!this.aux.stream;
      this.aux = { stream: null, source: null, deviceId: '' };
      if (was) ISS.emit('aux', { active: false });
    }

    /** Share audio from another tab, window or the whole screen. */
    async captureTab() {
      this.ensure();
      this.stopTab();
      const gdm = ISS.native.getDisplayMedia;
      if (!gdm) throw new Error('Screen/tab sharing is not available in this browser');
      const stream = await gdm({
        video: { width: { ideal: 2 }, height: { ideal: 2 }, frameRate: { ideal: 1 } },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
        },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        preferCurrentTab: false,
      });
      const audio = stream.getAudioTracks()[0];
      for (const v of stream.getVideoTracks()) v.stop();
      if (!audio) {
        this._stopStream(stream);
        throw new Error('No audio was shared. Pick a tab and turn on "Also share tab audio".');
      }
      const audioOnly = new MediaStream([audio]);
      this.tab = { stream: audioOnly, source: this.ctx.createMediaStreamSource(audioOnly) };
      this.tab.source.connect(this.n.tabBus);
      audio.addEventListener('ended', () => this.stopTab());
      this.resume();
      ISS.emit('tab', { active: true, label: audio.label || 'Shared audio' });
    }

    stopTab() {
      if (this.tab.source) this.tab.source.disconnect();
      if (this.tab.stream) this._stopStream(this.tab.stream);
      const was = !!this.tab.stream;
      this.tab = { stream: null, source: null };
      if (was) ISS.emit('tab', { active: false });
    }

    /** Route an <audio>/<video> element into the music bus. */
    connectMediaElement(el) {
      this.ensure();
      let src = this.playerSources.get(el);
      if (!src) {
        src = this.ctx.createMediaElementSource(el);
        this.playerSources.set(el, src);
        src.connect(this.n.music);
      }
      this.resume();
      return src;
    }

    /** Play a decoded sound on the soundboard bus. */
    playBuffer(buffer, opts) {
      this.ensure();
      this.resume();
      const o = opts || {};
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = !!o.loop;
      const g = this.ctx.createGain();
      g.gain.value = o.gain == null ? 1 : Number(o.gain);
      src.connect(g);
      g.connect(this.n.fx);
      const handle = {
        id: o.id,
        src,
        gain: g,
        stop: (fade) => {
          try {
            const t = this.ctx.currentTime;
            const f = fade == null ? 0.03 : fade;
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(g.gain.value, t);
            g.gain.linearRampToValueAtTime(0, t + f);
            src.stop(t + f + 0.01);
          } catch (_) {
            /* already stopped */
          }
        },
      };
      this.pads.add(handle);
      src.onended = () => {
        this.pads.delete(handle);
        g.disconnect();
        ISS.emit('pad-ended', { id: o.id });
      };
      src.start();
      return handle;
    }

    stopPads(id) {
      for (const h of [...this.pads]) if (id == null || h.id === id) h.stop();
    }

    isPadPlaying(id) {
      for (const h of this.pads) if (h.id === id) return true;
      return false;
    }

    async decode(arrayBuffer) {
      this.ensure();
      return this.ctx.decodeAudioData(arrayBuffer.slice(0));
    }

    _stopStream(stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch (_) {
          /* ignore */
        }
      }
    }
  }

  ISS.Engine = Engine;
  ISS.engine = ISS.engine || new Engine();
  ISS.audioUtil = { dbToGain, gainToDb };

  if (typeof module === 'object' && module.exports) module.exports = { Engine, dbToGain, gainToDb };
})(typeof globalThis !== 'undefined' ? globalThis : this);
