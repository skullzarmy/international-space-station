/*
 * "Now playing" in the Space title, without hard-coding X's private API.
 *
 * X changes its internal endpoints often. Instead of guessing which request
 * edits a Space's title, ISS learns it:
 *
 *   1. You click "Learn" in ISS. ISS shows a test title like  ISS "4821" test
 *   2. You set your Space title to that text using X's own edit dialog.
 *   3. ISS spots the one outgoing request (HTTP or chat socket) carrying that
 *      exact text, and saves it as a template with a placeholder.
 *   4. Later, ISS replays that template with the new title.
 *
 * The test text contains a space and quotes so we can tell how the request
 * encoded it (raw, JSON-escaped, URL-encoded, form-encoded), and encode new
 * titles the same way. Only the request you trigger while learning is
 * looked at; nothing is recorded otherwise.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});
  const PLACEHOLDER = '\u0000ISS_TITLE\u0000';
  const ID_PLACEHOLDERS = { room: '\u0000ISS_ROOM\u0000', space: '\u0000ISS_SPACE\u0000' };

  const esc = (v) => JSON.stringify(String(v)).slice(1, -1);
  const ENCODERS = {
    // JSON inside JSON inside JSON... (Periscope chat frames nest payloads)
    json4: (v) => esc(esc(esc(esc(v)))),
    json3: (v) => esc(esc(esc(v))),
    json2: (v) => esc(esc(v)),
    json: (v) => esc(v),
    'uri-json': (v) => encodeURIComponent(JSON.stringify(String(v)).slice(1, -1)),
    'form-json': (v) => new URLSearchParams({ x: JSON.stringify(String(v)).slice(1, -1) }).toString().slice(2),
    uri: (v) => encodeURIComponent(String(v)),
    form: (v) => new URLSearchParams({ x: String(v) }).toString().slice(2),
    raw: (v) => String(v),
  };
  // Order matters: more specific encodings first.
  const ORDER = ['json4', 'json3', 'json2', 'json', 'uri-json', 'form-json', 'uri', 'form', 'raw'];

  function makeMarker() {
    const n = Math.floor(1000 + Math.random() * 9000);
    return `ISS "${n}" test`;
  }

  /** Which encoding of `marker` appears in `text`? */
  function findEncoding(text, marker) {
    if (typeof text !== 'string' || !text) return null;
    for (const enc of ORDER) {
      if (text.includes(ENCODERS[enc](marker))) return enc;
    }
    return null;
  }

  function templatize(text, marker, enc) {
    return text.split(ENCODERS[enc](marker)).join(PLACEHOLDER);
  }

  function render(template, title, enc) {
    return template.split(PLACEHOLDER).join(ENCODERS[enc](title));
  }

  function fillTitle(tpl, info) {
    let t = String(tpl || '{title}');
    t = t.replace(/\{title\}/g, info.title || '');
    t = t.replace(/\{artist\}/g, info.artist || '');
    t = t.replace(/\{track\}/g, info.track || info.title || '');
    t = t.replace(/\s+/g, ' ').trim();
    // X's Space titles max out around 70 characters.
    if ([...t].length > 70) t = [...t].slice(0, 69).join('') + '…';
    return t;
  }

  /** Build a saved template from a captured request, or null if no match. */
  /**
   * Swap Space/room IDs for placeholders so the template works in the next
   * Space too. `ids` is { room, space } (either may be empty).
   */
  function templatizeIds(text, ids) {
    if (typeof text !== 'string' || !ids) return text;
    let out = text;
    for (const key of ['room', 'space']) {
      const v = ids[key];
      if (v && v.length >= 6) out = out.split(v).join(ID_PLACEHOLDERS[key]);
    }
    return out;
  }

  /** Put current IDs back. Returns null if the template needs an ID we lack. */
  function renderIds(text, ids) {
    if (typeof text !== 'string') return text;
    let out = text;
    for (const key of ['room', 'space']) {
      if (!out.includes(ID_PLACEHOLDERS[key])) continue;
      const v = (ids && (ids[key] || ids[key === 'room' ? 'space' : 'room'])) || '';
      if (!v) return null;
      out = out.split(ID_PLACEHOLDERS[key]).join(v);
    }
    return out;
  }

  function learnFromRequest(req, marker, ids) {
    const urlEnc = findEncoding(req.url, marker);
    const bodyEnc = typeof req.body === 'string' ? findEncoding(req.body, marker) : null;
    if (!urlEnc && !bodyEnc) return null;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      const key = k.toLowerCase();
      // Cookies are sent by the browser; csrf is refreshed at replay time.
      if (key === 'cookie' || key === 'content-length') continue;
      headers[key] = v;
    }
    return {
      transport: 'http',
      method: (req.method || 'GET').toUpperCase(),
      url: templatizeIds(urlEnc ? templatize(req.url, marker, urlEnc) : req.url, ids),
      urlEnc,
      body: templatizeIds(bodyEnc ? templatize(req.body, marker, bodyEnc) : req.body, ids),
      bodyEnc,
      headers,
      learnedAt: Date.now(),
    };
  }

  function learnFromSocket(data, marker, ids) {
    const enc = findEncoding(data, marker);
    if (!enc) return null;
    return { transport: 'ws', frame: templatizeIds(templatize(data, marker, enc), ids), enc, learnedAt: Date.now() };
  }

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------
  const STORE_KEY = 'iss.titleTemplate.v1';
  let learning = null; // { marker, resolve, timer }

  function loadTemplate() {
    try {
      return JSON.parse(root.localStorage.getItem(STORE_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }
  function saveTemplate(t) {
    try {
      if (t) root.localStorage.setItem(STORE_KEY, JSON.stringify(t));
      else root.localStorage.removeItem(STORE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function finishLearning(tpl) {
    if (!learning) return;
    clearTimeout(learning.timer);
    const done = learning;
    learning = null;
    if (tpl) {
      saveTemplate(tpl);
      ISS.emit('title-learned', tpl);
    }
    done.resolve(tpl);
  }

  function startLearning(timeoutMs) {
    if (learning) finishLearning(null);
    const marker = makeMarker();
    const promise = new Promise((resolve) => {
      learning = {
        marker,
        resolve,
        timer: setTimeout(() => finishLearning(null), timeoutMs || 180000),
      };
    });
    return { marker, promise };
  }

  function cancelLearning() {
    finishLearning(null);
  }

  function headersToObject(h) {
    const out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => (out[k] = v));
    else if (Array.isArray(h)) for (const [k, v] of h) out[k] = v;
    else Object.assign(out, h);
    return out;
  }

  /** IDs of the Space we're in right now: chat room + Space ID from the URL. */
  function currentIds() {
    const chat = ISS.chat && ISS.chat.status ? ISS.chat.status() : {};
    const m = /\/i\/spaces\/([A-Za-z0-9]+)/.exec((root.location && root.location.pathname) || '');
    return { room: chat.room || '', space: m ? m[1] : '' };
  }

  function observeRequest(req) {
    if (!learning) return;
    const tpl = learnFromRequest(req, learning.marker, currentIds());
    if (tpl) finishLearning(tpl);
  }

  function observeSocketSend(entry, data) {
    if (!learning || typeof data !== 'string') return;
    const tpl = learnFromSocket(data, learning.marker, Object.assign(currentIds(), { room: entry.room || '' }));
    if (tpl) finishLearning(tpl);
  }

  function installHooks() {
    const nativeFetch = root.fetch;
    if (nativeFetch && !nativeFetch.__issWrapped) {
      ISS.native.fetch = nativeFetch;
      const wrapped = function fetch(input, init) {
        if (learning) {
          try {
            const isReq = typeof Request !== 'undefined' && input instanceof Request;
            const url = isReq ? input.url : String(input);
            const method = (init && init.method) || (isReq ? input.method : 'GET');
            const body = init && typeof init.body === 'string' ? init.body : init && init.body instanceof URLSearchParams ? init.body.toString() : null;
            const headers = Object.assign(headersToObject(isReq ? input.headers : null), headersToObject(init && init.headers));
            observeRequest({ url, method, body, headers });
          } catch (_) {
            /* never break X's own requests */
          }
        }
        return nativeFetch.apply(this, arguments);
      };
      Object.defineProperty(wrapped, '__issWrapped', { value: true });
      root.fetch = wrapped;
    }

    const XHR = root.XMLHttpRequest;
    if (XHR && !XHR.prototype.__issWrapped) {
      const open = XHR.prototype.open;
      const setHeader = XHR.prototype.setRequestHeader;
      const send = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__iss = { method, url: String(url), headers: {} };
        return open.apply(this, arguments);
      };
      XHR.prototype.setRequestHeader = function (k, v) {
        if (this.__iss) this.__iss.headers[k] = v;
        return setHeader.apply(this, arguments);
      };
      XHR.prototype.send = function (body) {
        if (learning && this.__iss) {
          try {
            observeRequest(Object.assign({}, this.__iss, { body: typeof body === 'string' ? body : null }));
          } catch (_) {
            /* ignore */
          }
        }
        return send.apply(this, arguments);
      };
      Object.defineProperty(XHR.prototype, '__issWrapped', { value: true });
    }
  }

  function readCookie(name) {
    const m = new RegExp('(?:^|; )' + name + '=([^;]*)').exec(root.document ? root.document.cookie : '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  let lastApplied = '';
  let lastAppliedAt = 0;

  async function applyTitle(title, opts) {
    const tpl = loadTemplate();
    if (!tpl) return { ok: false, reason: 'Title editing is not set up yet. Use "Learn" first.' };
    title = String(title || '').trim();
    if (!title) return { ok: false, reason: 'Empty title.' };
    const force = opts && opts.force;
    if (!force && title === lastApplied) return { ok: true, skipped: true };
    // Don't hammer X: at most one automatic change every 15 seconds.
    if (!force && Date.now() - lastAppliedAt < 15000) return { ok: false, reason: 'Rate limited', retry: true };
    lastAppliedAt = Date.now();

    const ids = currentIds();
    const missingId = { ok: false, reason: 'Could not tell which Space you are in. Open the Space first.' };

    if (tpl.transport === 'ws') {
      const sock = ISS.chat && ISS.chat.activeSocket();
      if (!sock) return { ok: false, reason: 'Not connected to a Space chat.' };
      const frame = renderIds(render(tpl.frame, title, tpl.enc), ids);
      if (frame === null) return missingId;
      const ok = ISS.chat.sendFrame(frame);
      if (ok) lastApplied = title;
      return { ok };
    }

    const url = renderIds(tpl.urlEnc ? render(tpl.url, title, tpl.urlEnc) : tpl.url, ids);
    const body = renderIds(tpl.bodyEnc ? render(tpl.body, title, tpl.bodyEnc) : tpl.body, ids);
    if (url === null || (tpl.body != null && body === null)) return missingId;
    const headers = Object.assign({}, tpl.headers);
    const csrf = readCookie('ct0');
    if (csrf && headers['x-csrf-token']) headers['x-csrf-token'] = csrf;
    try {
      const res = await (ISS.native.fetch || root.fetch).call(root, url, {
        method: tpl.method,
        headers,
        body: tpl.method === 'GET' || tpl.method === 'HEAD' ? undefined : body,
        credentials: 'include',
      });
      if (!res.ok) return { ok: false, reason: `X answered ${res.status}. Try "Learn" again.` };
      lastApplied = title;
      ISS.emit('title-applied', { title });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    }
  }

  ISS.titles = {
    PLACEHOLDER,
    ID_PLACEHOLDERS,
    templatizeIds,
    renderIds,
    makeMarker,
    findEncoding,
    templatize,
    render,
    fillTitle,
    learnFromRequest,
    learnFromSocket,
    startLearning,
    cancelLearning,
    observeSocketSend,
    installHooks,
    applyTitle,
    hasTemplate: () => !!loadTemplate(),
    forget: () => saveTemplate(null),
    isLearning: () => !!learning,
  };

  if (typeof module === 'object' && module.exports) module.exports = ISS.titles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
