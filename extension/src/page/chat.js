/*
 * Space reactions over X's own chat connection.
 *
 * Spaces still runs on Periscope infrastructure. When you join a Space, X's
 * web app opens a WebSocket to a Periscope "chatman" server
 * (wss://<host>.pscp.tv/chatapi/v1/chatnow), authenticates, and joins the
 * Space's room. Emoji reactions travel on that socket as small JSON frames.
 *
 * The emoji is just a string. The server does not check it against X's
 * built-in reaction list, so any emoji sent this way shows up for every
 * listener on web, iOS and Android without them installing anything.
 *
 * ISS does not open its own connection or handle any tokens. It notices the
 * socket X already opened and sends frames on it, as if you had tapped a
 * reaction in X's UI.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});

  function safeJson(text) {
    if (typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  // Outer frame kinds
  const KIND_CHAT = 1;
  const KIND_CONTROL = 2;
  const KIND_AUTH = 3;
  // Inner message types
  const TYPE_REACTION = 2;

  function buildReactionFrame(room, emoji) {
    const body = JSON.stringify({ body: String(emoji), type: TYPE_REACTION, v: 2 });
    return JSON.stringify({
      body,
      kind: KIND_CHAT,
      payload: JSON.stringify({ room: String(room), body }),
      type: TYPE_REACTION,
    });
  }

  /** Classify a frame the web app sends. Returns {kind:'join', room} etc. */
  function parseOutgoing(data) {
    const msg = safeJson(data);
    if (!msg || typeof msg !== 'object') return null;
    if (msg.kind === KIND_AUTH) return { kind: 'auth' };
    if (msg.kind === KIND_CONTROL) {
      const payload = safeJson(msg.payload);
      const body = payload && safeJson(payload.body);
      if (payload && payload.kind === 1 && body && body.room) return { kind: 'join', room: String(body.room) };
      if (payload && payload.kind === 2 && body && body.room) return { kind: 'leave', room: String(body.room) };
    }
    if (msg.kind === KIND_CHAT) {
      const payload = safeJson(msg.payload);
      if (payload && payload.room) return { kind: 'chat', room: String(payload.room) };
    }
    return null;
  }

  /** Pull reactions and a few useful events out of incoming frames. */
  function parseIncoming(data) {
    const msg = safeJson(data);
    if (!msg || !msg.payload) return null;
    const payload = safeJson(msg.payload);
    if (!payload || !payload.body) return null;
    const body = safeJson(payload.body);
    if (!body) return null;
    if (body.type === TYPE_REACTION && typeof body.body === 'string') {
      const sender = payload.sender || {};
      return {
        type: 'reaction',
        emoji: body.body,
        name: body.displayName || sender.display_name || sender.username || '',
      };
    }
    if (typeof body.occupancy === 'number') {
      return { type: 'occupancy', occupancy: body.occupancy, total: body.total_participants || 0 };
    }
    return null;
  }

  function isChatUrl(url) {
    return /chatapi\/v1\/chatnow/i.test(String(url || ''));
  }

  // ---------------------------------------------------------------------------
  // Runtime (browser only)
  // ---------------------------------------------------------------------------
  const sockets = new Set(); // { ws, room, nativeSend }
  let lastSent = [];
  const MAX_PER_WINDOW = 5; // client-side rate limit: 5 reactions / 2s
  const WINDOW_MS = 2000;

  function track(ws, url) {
    const entry = { ws, room: null, url: String(url) };
    const nativeSend = ws.send;
    entry.nativeSend = nativeSend;
    sockets.add(entry);
    ISS.log.debug('chat socket opened', String(url));

    ws.send = function (data) {
      const info = typeof data === 'string' ? parseOutgoing(data) : null;
      if (info && info.room && info.kind !== 'leave') {
        if (entry.room !== info.room) {
          entry.room = info.room;
          ISS.emit('chat', { linked: true, room: info.room });
        }
      }
      if (ISS.titles && ISS.titles.observeSocketSend) ISS.titles.observeSocketSend(entry, data);
      return nativeSend.call(this, data);
    };

    ws.addEventListener('message', (ev) => {
      const info = parseIncoming(ev.data);
      if (info) ISS.emit(info.type, info);
    });
    ws.addEventListener('close', () => {
      sockets.delete(entry);
      ISS.emit('chat', { linked: chatStatus().linked });
    });
  }

  function activeSocket() {
    let best = null;
    for (const e of sockets) {
      if (e.ws.readyState === 1 && e.room) best = e; // latest wins
    }
    return best;
  }

  function chatStatus() {
    const s = activeSocket();
    return { linked: !!s, room: s ? s.room : null };
  }

  function sendFrame(frame) {
    const s = activeSocket();
    if (!s) return false;
    s.nativeSend.call(s.ws, frame);
    return true;
  }

  function sendReaction(emoji) {
    const s = activeSocket();
    if (!s) return { ok: false, reason: 'Not connected to a Space yet. Join or start one first.' };
    const now = Date.now();
    lastSent = lastSent.filter((t) => now - t < WINDOW_MS);
    if (lastSent.length >= MAX_PER_WINDOW) return { ok: false, reason: 'Slow down a little.' };
    lastSent.push(now);
    s.nativeSend.call(s.ws, buildReactionFrame(s.room, emoji));
    ISS.emit('reaction-sent', { emoji });
    return { ok: true };
  }

  function install() {
    const Native = root.WebSocket;
    if (!Native || Native.__issWrapped) return;
    ISS.native.WebSocket = Native;

    function WebSocket(url, protocols) {
      const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
      try {
        if (isChatUrl(url)) track(ws, url);
      } catch (err) {
        ISS.log.error('chat hook failed', err);
      }
      return ws;
    }
    WebSocket.prototype = Native.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      Object.defineProperty(WebSocket, k, { value: Native[k], enumerable: true });
    }
    Object.defineProperty(WebSocket, '__issWrapped', { value: true });
    Object.defineProperty(WebSocket, 'toString', { value: () => Native.toString() });
    root.WebSocket = WebSocket;
  }

  ISS.chat = {
    buildReactionFrame,
    parseOutgoing,
    parseIncoming,
    isChatUrl,
    install,
    sendReaction,
    sendFrame,
    status: chatStatus,
    activeSocket,
  };

  if (typeof module === 'object' && module.exports) module.exports = ISS.chat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
