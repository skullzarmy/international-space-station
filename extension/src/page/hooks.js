/*
 * Browser API hooks. These run before any of X's code.
 *
 * getUserMedia     X asks for the mic -> ISS opens the mic with voice
 *                  processing off, feeds it into the mixer, and hands X the
 *                  mixer's output instead.
 * RTCPeerConnection
 *   set*Description  rewrite Opus settings (stereo, bitrate, no DTX).
 *   addTrack / addTransceiver / RTCRtpSender.replaceTrack
 *                  if X tries to send some other audio track (for example its
 *                  own processed copy of the mic), send the ISS mix instead.
 * MediaStreamTrack.stop
 *                  notice when X is done with the mic so ISS can turn the real
 *                  mic off too.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});
  const peers = new Set();

  function defineNative(obj, name, fn, original) {
    Object.defineProperty(fn, 'name', { value: name });
    Object.defineProperty(fn, 'toString', { value: () => Function.prototype.toString.call(original) });
    Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true, enumerable: false });
  }

  function opusOptions() {
    const o = ISS.settings.opus;
    return { stereo: !!o.stereo, bitrate: Number(o.bitrate), fec: !!o.fec, dtx: !!o.dtx };
  }

  function mungeDesc(desc) {
    const s = ISS.settings;
    if (!s.enabled || !s.opus.enabled || !desc || typeof desc.sdp !== 'string') return desc;
    try {
      const sdp = ISS.sdp.mungeOpus(desc.sdp, opusOptions());
      if (sdp === desc.sdp) return desc;
      ISS.log.debug('tuned SDP for', desc.type);
      return { type: desc.type, sdp };
    } catch (err) {
      ISS.log.warn('SDP tuning skipped', err);
      return desc;
    }
  }

  function shouldSwap(track) {
    const s = ISS.settings;
    return (
      s.enabled &&
      s.forceDirect &&
      track &&
      track.kind === 'audio' &&
      ISS.engine.running &&
      !!ISS.engine.mic.source &&
      !ISS.engine.isOutput(track)
    );
  }

  function swapped(track) {
    ISS.log.info('X tried to send a different audio track; sending the ISS mix instead');
    return ISS.engine.createOutputTrack(track);
  }

  async function tuneSenders(pc) {
    const s = ISS.settings;
    if (!s.enabled || !s.opus.enabled) return;
    for (const sender of pc.getSenders()) {
      if (!sender.track || sender.track.kind !== 'audio') continue;
      try {
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = Number(s.opus.bitrate);
        p.encodings[0].priority = 'high';
        p.encodings[0].networkPriority = 'high';
        await sender.setParameters(p);
      } catch (err) {
        ISS.log.debug('setParameters skipped', err);
      }
    }
  }

  function trackPeer(pc) {
    if (peers.has(pc)) return;
    peers.add(pc);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') tuneSenders(pc);
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') peers.delete(pc);
      ISS.emit('peers', { count: livePeers().length });
    });
    ISS.emit('peers', { count: livePeers().length });
  }

  function livePeers() {
    return [...peers].filter((pc) => pc.connectionState !== 'closed' && pc.connectionState !== 'failed');
  }

  /** Put the ISS mix on every audio sender we know about (used by "Re-attach"). */
  async function reattach() {
    let n = 0;
    for (const pc of livePeers()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === 'audio' && !ISS.engine.isOutput(sender.track)) {
          await ISS.native.replaceTrack.call(sender, ISS.engine.createOutputTrack(sender.track));
          n++;
        }
      }
      tuneSenders(pc);
    }
    return n;
  }

  function installMedia() {
    const MD = root.MediaDevices;
    if (!MD || MD.prototype.getUserMedia.__iss) return;
    const proto = MD.prototype;
    const nativeGUM = proto.getUserMedia;
    const nativeGDM = proto.getDisplayMedia;
    ISS.native.getUserMedia = (c) => nativeGUM.call(root.navigator.mediaDevices, c);
    if (nativeGDM) ISS.native.getDisplayMedia = (c) => nativeGDM.call(root.navigator.mediaDevices, c);
    ISS.native.enumerateDevices = () => proto.enumerateDevices.call(root.navigator.mediaDevices);

    const getUserMedia = async function (constraints) {
      const s = ISS.settings;
      // Only take over audio-only requests. Camera recordings (audio+video)
      // elsewhere on X are left alone.
      if (!s.enabled || !constraints || !constraints.audio || constraints.video) {
        return nativeGUM.call(this, constraints);
      }
      const audio = ISS.constraints.rewriteAudioConstraints(constraints.audio, s);
      let mic;
      try {
        mic = await nativeGUM.call(this, { audio });
      } catch (err) {
        if (s.mic.deviceId && err && /Overconstrained|NotFound/.test(err.name)) {
          ISS.log.warn('chosen mic not available, using default');
          const fallback = ISS.constraints.rewriteAudioConstraints(constraints.audio, Object.assign({}, s, { mic: Object.assign({}, s.mic, { deviceId: '' }) }));
          mic = await nativeGUM.call(this, { audio: fallback });
        } else {
          throw err;
        }
      }
      try {
        ISS.engine.attachMic(mic);
        const out = ISS.engine.createOutputTrack(mic.getAudioTracks()[0]);
        ISS.log.info('mic routed through ISS (voice processing off)');
        return new MediaStream([out]);
      } catch (err) {
        // Never leave the user without a mic: fall back to the raw stream.
        ISS.log.error('mixer failed, passing mic straight through', err);
        return mic;
      }
    };
    getUserMedia.__iss = true;
    defineNative(proto, 'getUserMedia', getUserMedia, nativeGUM);

    const TrackProto = root.MediaStreamTrack && root.MediaStreamTrack.prototype;
    if (TrackProto) {
      const nativeStop = TrackProto.stop;
      defineNative(
        TrackProto,
        'stop',
        function stop() {
          const r = nativeStop.call(this);
          try {
            ISS.engine.onOutputStopped(this);
          } catch (_) {
            /* ignore */
          }
          return r;
        },
        nativeStop
      );
    }
  }

  function installPeerConnection() {
    const PC = root.RTCPeerConnection;
    if (!PC || PC.prototype.setRemoteDescription.__iss) return;
    const proto = PC.prototype;

    const nativeSRD = proto.setRemoteDescription;
    const srd = function setRemoteDescription(desc) {
      trackPeer(this);
      const args = [...arguments];
      args[0] = mungeDesc(desc);
      return nativeSRD.apply(this, args);
    };
    srd.__iss = true;
    defineNative(proto, 'setRemoteDescription', srd, nativeSRD);

    const nativeSLD = proto.setLocalDescription;
    defineNative(
      proto,
      'setLocalDescription',
      function setLocalDescription(desc) {
        trackPeer(this);
        if (!desc) return nativeSLD.apply(this, arguments);
        const args = [...arguments];
        args[0] = mungeDesc(desc);
        return nativeSLD.apply(this, args);
      },
      nativeSLD
    );

    const nativeAddTrack = proto.addTrack;
    defineNative(
      proto,
      'addTrack',
      function addTrack(track) {
        trackPeer(this);
        const args = [...arguments];
        if (shouldSwap(track)) args[0] = swapped(track);
        return nativeAddTrack.apply(this, args);
      },
      nativeAddTrack
    );

    const nativeAddTransceiver = proto.addTransceiver;
    if (nativeAddTransceiver) {
      defineNative(
        proto,
        'addTransceiver',
        function addTransceiver(trackOrKind) {
          trackPeer(this);
          const args = [...arguments];
          if (typeof trackOrKind === 'object' && shouldSwap(trackOrKind)) args[0] = swapped(trackOrKind);
          return nativeAddTransceiver.apply(this, args);
        },
        nativeAddTransceiver
      );
    }

    const Sender = root.RTCRtpSender && root.RTCRtpSender.prototype;
    if (Sender && Sender.replaceTrack) {
      const nativeReplace = Sender.replaceTrack;
      ISS.native.replaceTrack = nativeReplace;
      defineNative(
        Sender,
        'replaceTrack',
        function replaceTrack(track) {
          const args = [...arguments];
          if (shouldSwap(track)) args[0] = swapped(track);
          return nativeReplace.apply(this, args);
        },
        nativeReplace
      );
    }
  }

  function install() {
    try {
      installMedia();
    } catch (err) {
      ISS.log.error('media hooks failed', err);
    }
    try {
      installPeerConnection();
    } catch (err) {
      ISS.log.error('WebRTC hooks failed', err);
    }
  }

  ISS.hooks = { install, reattach, livePeers, mungeDesc };
})(typeof globalThis !== 'undefined' ? globalThis : this);
