/*
 * ISS control panel, drawn inside a Shadow DOM on x.com.
 */
(function (root) {
  'use strict';

  const ISS = (root.__ISS__ = root.__ISS__ || {});
  const doc = root.document;

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function h(tag, props, ...kids) {
    const el = doc.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : doc.createTextNode(String(kid)));
    }
    return el;
  }

  function clearEl(el) {
    while (el.firstChild) el.firstChild.remove();
  }

  function fmtTime(s) {
    if (!isFinite(s)) return '0:00';
    s = Math.max(0, Math.floor(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function pct(v) {
    return `${Math.round(v * 100)}%`;
  }

  // Inline icons (no external requests).
  const ICONS = {
    iss: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9.5" y="9" width="5" height="6" rx="1"/><path d="M12 9V5M12 19v-4"/><rect x="2" y="7" width="5" height="10" rx=".6"/><rect x="17" y="7" width="5" height="10" rx=".6"/><path d="M7 12h2.5M14.5 12H17M2 12h5M17 12h5M4.5 7v10M19.5 7v10"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18 6l-8.5 6 8.5 6zM6 6h2v12H6z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    min: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 12h12"/></svg>',
  };
  function icon(name) {
    const s = h('span', { class: 'ico' });
    s.innerHTML = ICONS[name];
    return s;
  }

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { --bg:#0b0f17; --panel:#111827; --raised:#1a2233; --line:#263042; --text:#e6edf6; --muted:#8b97a8;
  --accent:#4cc3ff; --accent2:#7c5cff; --ok:#3ddc97; --warn:#ffb347; --bad:#ff5c7a;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); }
button, input, select { font: inherit; color: inherit; }
.launcher { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; width: 48px; height: 48px; border-radius: 50%;
  border: 1px solid var(--line); background: radial-gradient(circle at 30% 30%, #1d2b44, #0b0f17); color: var(--accent);
  display: grid; place-items: center; cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
.launcher:hover { border-color: var(--accent); }
.launcher .dot { position: absolute; right: 4px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: #556; border: 2px solid #0b0f17; }
.launcher .dot.live { background: var(--bad); box-shadow: 0 0 8px var(--bad); }
.launcher .dot.ready { background: var(--ok); }
.panel { position: fixed; z-index: 2147483647; width: 372px; max-width: calc(100vw - 16px); max-height: min(640px, calc(100vh - 32px));
  display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0,0,0,.6); overflow: hidden; }
.panel[hidden] { display: none; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 12px; cursor: grab; user-select: none;
  background: linear-gradient(180deg, #152036, var(--panel)); }
header:active { cursor: grabbing; }
header .title { font-weight: 700; letter-spacing: .3px; color: var(--accent); display: flex; gap: 6px; align-items: center; }
header .title small { color: var(--muted); font-weight: 500; }
header .sp { flex: 1; }
.iconbtn { background: transparent; border: 0; color: var(--muted); padding: 4px; border-radius: 6px; cursor: pointer; display: grid; place-items: center; }
.iconbtn:hover { color: var(--text); background: var(--raised); }
.chips { display: flex; gap: 6px; padding: 0 12px 8px; flex-wrap: wrap; }
.chip { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: var(--raised); color: var(--muted); border: 1px solid var(--line); }
.chip.on { color: var(--ok); border-color: rgba(61,220,151,.4); }
.chip.live { color: #fff; background: var(--bad); border-color: var(--bad); }
.chip.warn { color: var(--warn); border-color: rgba(255,179,71,.4); }
nav { display: flex; border-bottom: 1px solid var(--line); padding: 0 6px; }
nav button { flex: 1; background: none; border: 0; padding: 8px 4px; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; font-weight: 600; }
nav button.active { color: var(--text); border-bottom-color: var(--accent); }
main { overflow: auto; padding: 10px 12px 14px; flex: 1; }
section { margin-bottom: 14px; }
h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); margin: 4px 0 8px; font-weight: 700; }
.row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.row > label.name { width: 74px; flex: none; color: var(--muted); }
.row .grow { flex: 1; min-width: 0; }
.strip { background: var(--raised); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; }
.strip .top { display: flex; align-items: center; gap: 8px; }
.strip .top .lbl { font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.strip .top .lbl small { color: var(--muted); font-weight: 400; margin-left: 4px; }
.meter { height: 6px; border-radius: 3px; background: #0a0e15; overflow: hidden; margin: 6px 0 4px; }
.meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--ok) 0 70%, var(--warn) 70% 88%, var(--bad) 88%); background-size: 280px 100%; transition: width .05s linear; }
input[type=range] { width: 100%; accent-color: var(--accent); }
.btn { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 5px 10px; cursor: pointer; white-space: nowrap; }
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); color: #04121c; border-color: var(--accent); font-weight: 700; }
.btn.danger { color: var(--bad); }
.btn.on { background: rgba(76,195,255,.15); border-color: var(--accent); color: var(--accent); }
.btn.sm { padding: 2px 8px; font-size: 12px; }
.toggle { display: flex; align-items: flex-start; gap: 8px; margin: 7px 0; cursor: pointer; }
.toggle input { margin-top: 2px; accent-color: var(--accent); }
.toggle .hint { color: var(--muted); font-size: 12px; display: block; }
select, input[type=text], input[type=number] { background: #0a0e15; border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; width: 100%; }
.pads { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.pad { position: relative; aspect-ratio: 1.35; border-radius: 10px; border: 1px solid var(--line); background: linear-gradient(160deg, #1c2740, #131a29);
  cursor: pointer; padding: 6px; display: flex; flex-direction: column; justify-content: flex-end; text-align: left; overflow: hidden; }
.pad:hover { border-color: var(--accent2); }
.pad.playing { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent), 0 0 14px rgba(76,195,255,.3); }
.pad .em { font-size: 20px; position: absolute; top: 4px; left: 6px; }
.pad .key { position: absolute; top: 4px; right: 6px; font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
.pad .nm { font-size: 12px; font-weight: 600; line-height: 1.2; max-height: 2.4em; overflow: hidden; }
.pad .ed { position: absolute; bottom: 4px; right: 4px; opacity: 0; font-size: 11px; background: #0a0e15; border: 1px solid var(--line); border-radius: 5px; padding: 0 5px; color: var(--muted); }
.pad:hover .ed { opacity: 1; }
.drop { border: 1.5px dashed var(--line); border-radius: 10px; padding: 12px; text-align: center; color: var(--muted); margin: 8px 0; }
.drop.over { border-color: var(--accent); color: var(--accent); }
.editor { background: var(--raised); border: 1px solid var(--accent2); border-radius: 10px; padding: 10px; margin: 8px 0; }
.list { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; max-height: 220px; overflow-y: auto; }
.item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--line); cursor: pointer; }
.item:last-child { border-bottom: 0; }
.item:hover { background: var(--raised); }
.item.cur { color: var(--accent); font-weight: 600; }
.item .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .x { opacity: .5; }
.item .x:hover { opacity: 1; color: var(--bad); }
.transport { display: flex; justify-content: center; gap: 8px; margin: 8px 0; }
.transport .big { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: #04121c; border: 0; display: grid; place-items: center; cursor: pointer; }
.transport .iconbtn { width: 36px; height: 36px; }
.now { text-align: center; font-weight: 600; min-height: 1.4em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.emojis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.emoji { font-size: 22px; aspect-ratio: 1; border-radius: 10px; border: 1px solid var(--line); background: var(--raised); cursor: pointer; display: grid; place-items: center; position: relative; }
.emoji:hover { border-color: var(--accent); transform: translateY(-1px); }
.emoji .rm { position: absolute; top: -6px; right: -6px; font-size: 10px; width: 16px; height: 16px; border-radius: 50%; background: var(--bad); color: #fff; display: none; place-items: center; }
.editing .emoji .rm { display: grid; }
.feed { font-size: 12px; color: var(--muted); max-height: 120px; overflow-y: auto; }
.feed div { padding: 2px 0; }
.note { font-size: 12px; color: var(--muted); background: #0e1522; border: 1px solid var(--line); border-radius: 8px; padding: 8px; margin: 6px 0; }
.note.warn { color: var(--warn); border-color: rgba(255,179,71,.35); }
.toasts { position: fixed; left: 16px; bottom: 76px; z-index: 2147483647; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.toast { background: #111827; border: 1px solid var(--line); color: var(--text); padding: 8px 12px; border-radius: 10px; max-width: 320px; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
.toast.warn { border-color: var(--warn); }
.toast.ok { border-color: var(--ok); }
a { color: var(--accent); }
.ico { display: inline-grid; place-items: center; }
`;

  // ---------------------------------------------------------------------------
  // Bound controls
  // ---------------------------------------------------------------------------
  function toggle(path, label, hint, onChange) {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!ISS.get(path);
    input.addEventListener('change', () => {
      ISS.set(path, input.checked);
      if (onChange) onChange(input.checked);
    });
    ISS.on('settings', (e) => {
      if (e.path === path || e.path === '*') input.checked = !!ISS.get(path);
    });
    return h('label', { class: 'toggle' }, input, h('span', null, label, hint ? h('span', { class: 'hint' }, hint) : null));
  }

  function range(path, min, max, step, fmt) {
    const out = h('span', { style: { width: '56px', flex: 'none', textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' } });
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const show = () => (out.textContent = (fmt || String)(Number(input.value)));
    input.value = String(ISS.get(path));
    show();
    input.addEventListener('input', () => {
      ISS.set(path, Number(input.value));
      show();
    });
    input.addEventListener('dblclick', () => {
      const def = path.split('.').reduce((o, k) => o && o[k], ISS.DEFAULTS);
      if (typeof def === 'number') {
        input.value = String(def);
        ISS.set(path, def);
        show();
      }
    });
    ISS.on('settings', (e) => {
      if (e.path === '*') {
        input.value = String(ISS.get(path));
        show();
      }
    });
    return h('span', { class: 'grow', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, input, out);
  }

  function select(path, options, onChange) {
    const sel = h('select', null, options.map(([v, l]) => h('option', { value: String(v) }, l)));
    sel.value = String(ISS.get(path));
    sel.addEventListener('change', () => {
      const cur = ISS.get(path);
      const v = typeof cur === 'number' ? Number(sel.value) : sel.value;
      ISS.set(path, v);
      if (onChange) onChange(v);
    });
    return sel;
  }

  function text(path, placeholder) {
    const input = h('input', { type: 'text', placeholder: placeholder || '' });
    input.value = ISS.get(path) || '';
    input.addEventListener('change', () => ISS.set(path, input.value));
    return input;
  }

  async function deviceOptions(kind) {
    try {
      const list = await ISS.native.enumerateDevices();
      return list.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications');
    } catch (_) {
      return [];
    }
  }

  function deviceSelect(path, kind, firstLabel, onChange) {
    const sel = h('select');
    const fill = async () => {
      const devs = await deviceOptions(kind);
      clearEl(sel);
      sel.append(h('option', { value: '' }, firstLabel));
      devs.forEach((d, i) => sel.append(h('option', { value: d.deviceId }, d.label || `${kind === 'audioinput' ? 'Input' : 'Output'} ${i + 1}`)));
      sel.value = ISS.get(path) || '';
      if (sel.value !== (ISS.get(path) || '')) sel.value = '';
    };
    fill();
    if (root.navigator.mediaDevices && root.navigator.mediaDevices.addEventListener) root.navigator.mediaDevices.addEventListener('devicechange', fill);
    ISS.on('mic', fill);
    sel.addEventListener('change', () => {
      ISS.set(path, sel.value);
      if (onChange) onChange(sel.value);
    });
    return sel;
  }

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------
  const ui = { meters: {}, rendered: {} };

  function toast(msg, kind) {
    if (!ui.toasts) return;
    const t = h('div', { class: `toast ${kind || ''}` }, msg);
    ui.toasts.append(t);
    setTimeout(() => t.remove(), 4200);
  }

  function strip(key, label, sub, controls, extra) {
    const bar = h('i');
    ui.meters[key] = bar;
    return h('div', { class: 'strip' }, h('div', { class: 'top' }, h('span', { class: 'lbl' }, label, sub ? h('small', null, sub) : null), controls), h('div', { class: 'meter' }, bar), extra);
  }

  // --- Mixer tab --------------------------------------------------------------
  function mixerTab() {
    const micMute = h('button', { class: 'btn sm' });
    const syncMute = () => {
      const m = ISS.settings.mic.muted;
      micMute.textContent = m ? 'Muted' : 'Live';
      micMute.className = `btn sm ${m ? 'danger' : 'on'}`;
    };
    syncMute();
    micMute.addEventListener('click', () => {
      ISS.set('mic.muted', !ISS.settings.mic.muted);
      syncMute();
    });
    ISS.on('settings', syncMute);

    const micLabel = h('small', null, 'waiting for X');
    ISS.on('mic', (e) => (micLabel.textContent = e.active ? e.label || 'connected' : 'waiting for X'));

    // Aux
    const auxBtn = h('button', { class: 'btn sm' }, 'Connect');
    const auxLabel = h('small', null, 'off');
    const auxSel = deviceSelect('aux.deviceId', 'audioinput', 'Default input');
    auxBtn.addEventListener('click', async () => {
      if (ISS.engine.aux.stream) {
        ISS.engine.detachAux();
        return;
      }
      try {
        await ISS.engine.attachAux(ISS.settings.aux.deviceId);
      } catch (err) {
        toast(`Could not open input: ${err.message || err}`, 'warn');
      }
    });
    ISS.on('aux', (e) => {
      auxBtn.textContent = e.active ? 'Disconnect' : 'Connect';
      auxBtn.classList.toggle('on', e.active);
      auxLabel.textContent = e.active ? e.label : 'off';
    });

    // Tab audio
    const tabBtn = h('button', { class: 'btn sm' }, 'Share audio');
    const tabLabel = h('small', null, 'off');
    tabBtn.addEventListener('click', async () => {
      if (ISS.engine.tab.stream) {
        ISS.engine.stopTab();
        return;
      }
      try {
        await ISS.engine.captureTab();
      } catch (err) {
        if (err && err.name !== 'NotAllowedError') toast(err.message || String(err), 'warn');
      }
    });
    ISS.on('tab', (e) => {
      tabBtn.textContent = e.active ? 'Stop sharing' : 'Share audio';
      tabBtn.classList.toggle('on', e.active);
      tabLabel.textContent = e.active ? e.label : 'off';
    });

    const stopFx = h('button', { class: 'btn sm', onclick: () => ISS.board.stopAll() }, 'Stop all');

    return h(
      'div',
      null,
      h('section', null,
        strip('mic', h('span', null, 'Mic ', micLabel), null, micMute, h('div', { class: 'row' }, range('mic.gain', 0, 2, 0.01, pct))),
        strip('aux', h('span', null, 'Instrument / aux ', auxLabel), null, auxBtn,
          h('div', null, h('div', { class: 'row' }, auxSel), h('div', { class: 'row' }, range('aux.gain', 0, 2, 0.01, pct)), toggle('aux.monitor', 'Hear it locally'))),
        strip('music', 'Music', 'Mix Station + shared audio', h('span', { class: 'ico', style: { color: 'var(--muted)' } }, ''),
          h('div', null,
            h('div', { class: 'row' }, range('musicGain', 0, 1.5, 0.01, pct)),
            h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Shared tab/app ', tabLabel), tabBtn))),
        strip('fx', 'Soundboard', null, stopFx, h('div', { class: 'row' }, range('fxGain', 0, 1.5, 0.01, pct))),
        strip('master', 'Master', 'what the Space hears', null, h('div', { class: 'row' }, range('masterGain', 0, 1.5, 0.01, pct)))
      ),
      h('section', null,
        h('h3', null, 'Talk-over (ducking)'),
        toggle('ducking.enabled', 'Lower the music while I talk'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Duck to'), range('ducking.amount', 0, 1, 0.01, pct)),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Sensitivity'), range('ducking.threshold', -70, -10, 1, (v) => `${v} dB`)),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Release'), range('ducking.release', 0.1, 3, 0.05, (v) => `${v.toFixed(1)}s`))
      ),
      h('section', null,
        h('h3', null, 'Monitor (what you hear)'),
        toggle('monitor.enabled', 'Hear music and pads I play', 'The Space hears them either way.'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Volume'), range('monitor.gain', 0, 1.5, 0.01, pct)),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Output'), deviceSelect('monitor.sinkId', 'audiooutput', 'System default'))
      )
    );
  }

  // --- Soundboard tab ---------------------------------------------------------
  function boardTab() {
    const grid = h('div', { class: 'pads' });
    const editorHost = h('div');
    const fileInput = h('input', { type: 'file', accept: 'audio/*,video/*', multiple: true, style: { display: 'none' } });
    const add = async (files) => {
      const r = await ISS.board.addFiles(files);
      if (r.skipped.length) toast(`Skipped: ${r.skipped.join(', ')}`, 'warn');
      else if (r.added.length) toast(`Added ${r.added.length} sound${r.added.length > 1 ? 's' : ''}`, 'ok');
    };
    fileInput.addEventListener('change', () => {
      add([...fileInput.files]);
      fileInput.value = '';
    });
    const drop = h('div', { class: 'drop' }, 'Drop audio files here or ', h('a', { href: '#', onclick: (e) => (e.preventDefault(), fileInput.click()) }, 'browse'));
    drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      add([...e.dataTransfer.files]);
    });

    let editing = null;
    function openEditor(pad) {
      editing = pad.id;
      clearEl(editorHost);
      const name = h('input', { type: 'text', value: pad.name });
      const emoji = h('input', { type: 'text', value: pad.emoji || '', placeholder: '🎺', style: { width: '64px' } });
      const vol = h('input', { type: 'range', min: '0', max: '2', step: '0.01', value: String(pad.gain) });
      const loop = h('input', { type: 'checkbox' });
      loop.checked = !!pad.loop;
      const mode = h('select', null, h('option', { value: 'restart' }, 'Restart on press'), h('option', { value: 'toggle' }, 'Press again to stop'), h('option', { value: 'overlap' }, 'Overlap'));
      mode.value = pad.mode || 'restart';
      const save = () =>
        ISS.board.update(pad.id, { name: name.value.slice(0, 40), emoji: emoji.value.trim().slice(0, 8), gain: Number(vol.value), loop: loop.checked, mode: mode.value });
      for (const el of [name, emoji, vol, loop, mode]) el.addEventListener('change', save);
      editorHost.append(
        h('div', { class: 'editor' },
          h('div', { class: 'row' }, emoji, name),
          h('div', { class: 'row' }, h('label', { class: 'name' }, 'Volume'), vol),
          h('div', { class: 'row' }, h('label', { class: 'name' }, 'Mode'), mode),
          h('label', { class: 'toggle' }, loop, h('span', null, 'Loop')),
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', onclick: () => ISS.board.move(pad.id, -1) }, '◀ Move'),
            h('button', { class: 'btn sm', onclick: () => ISS.board.move(pad.id, 1) }, 'Move ▶'),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn sm danger', onclick: () => (ISS.board.remove(pad.id), closeEditor()) }, 'Delete'),
            h('button', { class: 'btn sm primary', onclick: () => (save(), closeEditor()) }, 'Done')
          )
        )
      );
    }
    function closeEditor() {
      editing = null;
      clearEl(editorHost);
    }

    function render(pads) {
      clearEl(grid);
      pads.forEach((pad, i) => {
        const key = ISS.board.keyFor(i);
        const el = h('button', { class: `pad ${ISS.engine.running && ISS.engine.isPadPlaying(pad.id) ? 'playing' : ''}`, title: key ? `Alt+${key}` : '' },
          pad.emoji ? h('span', { class: 'em' }, pad.emoji) : null,
          key ? h('span', { class: 'key' }, key) : null,
          h('span', { class: 'nm' }, pad.name),
          h('span', { class: 'ed', onclick: (e) => (e.stopPropagation(), openEditor(pad)) }, 'edit')
        );
        el.dataset.id = pad.id;
        el.addEventListener('click', () => ISS.board.trigger(pad.id));
        el.addEventListener('contextmenu', (e) => (e.preventDefault(), openEditor(pad)));
        grid.append(el);
      });
      if (editing && !pads.find((p) => p.id === editing)) closeEditor();
    }
    ISS.on('board', render);
    const markPlaying = () => {
      for (const el of grid.children) el.classList.toggle('playing', ISS.engine.isPadPlaying(el.dataset.id));
    };
    ISS.on('pad', markPlaying);
    ISS.on('pad-ended', markPlaying);
    ISS.board.load();

    return h('div', null,
      h('div', { class: 'row' }, h('span', { class: 'grow', style: { color: 'var(--muted)' } }, 'Alt+1…0, Alt+Q…P to play. Alt+` stops all.'),
        h('button', { class: 'btn sm', onclick: () => ISS.board.stopAll() }, 'Stop all')),
      grid, editorHost, drop, fileInput);
  }

  // --- Mix Station tab --------------------------------------------------------
  function stationTab() {
    const S = ISS.station;
    const now = h('div', { class: 'now' }, 'Nothing playing');
    const playBtn = h('button', { class: 'big', title: 'Play/Pause', onclick: () => S.toggle() }, icon('play'));
    const seek = h('input', { type: 'range', min: '0', max: '1000', value: '0', class: 'grow' });
    const tCur = h('span', null, '0:00');
    const tDur = h('span', null, '0:00');
    let seeking = false;
    seek.addEventListener('input', () => (seeking = true));
    seek.addEventListener('change', () => {
      S.seek(Number(seek.value) / 1000);
      seeking = false;
    });
    const shuffle = h('button', { class: 'btn sm', onclick: () => S.setShuffle(!S.state.shuffle) }, 'Shuffle');
    const repeat = h('button', { class: 'btn sm', onclick: () => S.setRepeat({ off: 'all', all: 'one', one: 'off' }[S.state.repeat]) }, 'Repeat');
    const list = h('div', { class: 'list' });
    const fileInput = h('input', { type: 'file', accept: 'audio/*,video/*', multiple: true, style: { display: 'none' } });
    fileInput.addEventListener('change', () => {
      const n = S.addFiles([...fileInput.files]);
      fileInput.value = '';
      if (n) toast(`Added ${n} file${n > 1 ? 's' : ''}`, 'ok');
    });
    const restoreBtn = h('button', { class: 'btn sm', hidden: true }, 'Reopen folder');
    S.savedFolderName().then((name) => {
      if (name) {
        restoreBtn.hidden = false;
        restoreBtn.textContent = `Reopen “${name}”`;
      }
    });
    restoreBtn.addEventListener('click', async () => {
      try {
        const n = await S.restoreFolder();
        toast(`${n} tracks loaded`, 'ok');
        restoreBtn.hidden = true;
      } catch (err) {
        toast(err.message || String(err), 'warn');
      }
    });

    const render = (st) => {
      playBtn.innerHTML = '';
      playBtn.append(icon(st.playing ? 'pause' : 'play'));
      shuffle.classList.toggle('on', st.shuffle);
      repeat.classList.toggle('on', st.repeat !== 'off');
      repeat.textContent = st.repeat === 'one' ? 'Repeat 1' : 'Repeat';
      const item = st.items[st.index];
      now.textContent = item ? S.parseName(item.name).title : st.items.length ? `${st.items.length} tracks ready` : 'Nothing playing';
      clearEl(list);
      if (!st.items.length) list.append(h('div', { class: 'item', style: { cursor: 'default', color: 'var(--muted)' } }, 'Add files or open a music folder.'));
      st.items.forEach((it, i) => {
        list.append(
          h('div', { class: `item ${i === st.index ? 'cur' : ''}`, onclick: () => S.play(i).catch((e) => toast(e.message, 'warn')) },
            h('span', { class: 'nm', title: it.name }, `${i + 1}. ${it.name.replace(/\.[^.]+$/, '')}`),
            h('span', { class: 'x', title: 'Remove', onclick: (e) => (e.stopPropagation(), S.remove(i)) }, '✕'))
        );
      });
    };
    ISS.on('station', render);
    render({ items: [], index: -1, playing: false, shuffle: false, repeat: 'all' });

    ui.stationTick = () => {
      const p = S.position();
      if (!seeking) seek.value = String(p.d ? Math.round((p.t / p.d) * 1000) : 0);
      tCur.textContent = fmtTime(p.t);
      tDur.textContent = fmtTime(p.d);
    };

    // Now playing / title
    const learnStatus = h('span', { class: 'grow', style: { color: 'var(--muted)', fontSize: '12px' } });
    const learnBtn = h('button', { class: 'btn sm' }, 'Learn');
    const learnBox = h('div');
    const syncLearn = () => {
      learnStatus.textContent = ISS.titles.hasTemplate() ? 'Title editing is set up ✓' : 'Not set up yet';
    };
    syncLearn();
    learnBtn.addEventListener('click', () => {
      if (ISS.titles.isLearning()) {
        ISS.titles.cancelLearning();
        return;
      }
      const { marker, promise } = ISS.titles.startLearning();
      learnBtn.textContent = 'Cancel';
      const code = h('input', { type: 'text', readOnly: true, value: marker, onclick: (e) => e.target.select() });
      clearEl(learnBox);
      learnBox.append(
        h('div', { class: 'note' },
          h('div', null, '1. Open your Space’s ', h('b', null, 'Edit'), ' option in X.'),
          h('div', null, '2. Set the title to exactly this text and save:'),
          h('div', { class: 'row' }, code, h('button', { class: 'btn sm', onclick: () => root.navigator.clipboard && root.navigator.clipboard.writeText(marker) }, 'Copy')),
          h('div', null, 'ISS records that one request and reuses it for song titles.'))
      );
      promise.then((tpl) => {
        learnBtn.textContent = 'Learn';
        clearEl(learnBox);
        syncLearn();
        if (tpl) toast('Got it. ISS can now update your Space title.', 'ok');
        else toast('Learning stopped. No title change was seen.', 'warn');
      });
    });
    const npNow = h('span', null, '—');
    ISS.on('now-playing', (c) => (npNow.textContent = c ? c.title : '—'));

    return h('div', null,
      h('section', null,
        now,
        h('div', { class: 'time' }, tCur, seek, tDur),
        h('div', { class: 'transport' },
          h('button', { class: 'iconbtn', title: 'Previous', onclick: () => S.prev() }, icon('prev')),
          playBtn,
          h('button', { class: 'iconbtn', title: 'Next', onclick: () => S.next() }, icon('next')),
          h('button', { class: 'iconbtn', title: 'Stop', onclick: () => S.stop() }, icon('stop'))),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: () => fileInput.click() }, 'Add files'),
          h('button', { class: 'btn sm', onclick: () => S.openFolder().then((n) => toast(`${n} tracks loaded`, 'ok')).catch((e) => e.name !== 'AbortError' && toast(e.message, 'warn')) }, 'Open folder'),
          restoreBtn, h('span', { class: 'grow' }), shuffle, repeat),
        list, fileInput),
      h('section', null,
        h('h3', null, 'Now playing'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Current'), h('span', { class: 'grow' }, npNow)),
        toggle('nowPlaying.fromSharedTab', 'Read song from the shared tab’s title', 'Works with YouTube, SoundCloud, Spotify web and most players. Extension only.'),
        toggle('nowPlaying.toTitle', 'Show the song in my Space title', 'You must be the host. Needs a one-time setup below.'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Format'), text('nowPlaying.template', '🎵 {title}')),
        h('div', { class: 'row' }, learnStatus, learnBtn),
        learnBox,
        toggle('nowPlaying.reactOnChange', 'Send a reaction when the song changes'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Reaction'), text('nowPlaying.reactEmoji', '🎶'))
      ));
  }

  // --- Reactions tab ----------------------------------------------------------
  function reactTab() {
    const grid = h('div', { class: 'emojis' });
    const status = h('div', { class: 'note' });
    const syncStatus = () => {
      const s = ISS.chat.status();
      status.textContent = s.linked ? 'Connected to this Space’s reactions. Everyone sees these, no install needed.' : 'Join or start a Space to send reactions.';
      status.className = `note ${s.linked ? '' : 'warn'}`;
    };
    syncStatus();
    ISS.on('chat', syncStatus);
    const wrap = h('div');

    const send = (emoji) => {
      const r = ISS.chat.sendReaction(emoji);
      if (!r.ok) toast(r.reason, 'warn');
    };
    const render = () => {
      clearEl(grid);
      ISS.settings.reactions.favorites.forEach((e, i) => {
        grid.append(
          h('button', { class: 'emoji', title: e, onclick: () => (wrap.classList.contains('editing') ? null : send(e)) },
            e,
            h('span', { class: 'rm', onclick: (ev) => {
              ev.stopPropagation();
              const favs = ISS.settings.reactions.favorites.slice();
              favs.splice(i, 1);
              ISS.set('reactions.favorites', favs);
              render();
            } }, '✕'))
        );
      });
    };
    render();
    const custom = h('input', { type: 'text', placeholder: 'Any emoji, e.g. 🦖 or 🏴‍☠️', maxLength: 16 });
    custom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && custom.value.trim()) send(custom.value.trim());
    });
    const feed = h('div', { class: 'feed' });
    ISS.on('reaction', (r) => {
      feed.prepend(h('div', null, `${r.emoji}  ${r.name || 'someone'}`));
      while (feed.children.length > 30) feed.lastChild.remove();
    });
    const editBtn = h('button', { class: 'btn sm', onclick: () => editBtn.classList.toggle('on', wrap.classList.toggle('editing')) }, 'Edit');

    wrap.append(
      status,
      h('section', null, h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Favorites'), editBtn), grid),
      h('section', null,
        h('h3', null, 'Send any emoji'),
        h('div', { class: 'row' }, custom,
          h('button', { class: 'btn sm primary', onclick: () => custom.value.trim() && send(custom.value.trim()) }, 'Send'),
          h('button', { class: 'btn sm', onclick: () => {
            const v = custom.value.trim();
            if (!v) return;
            ISS.set('reactions.favorites', ISS.settings.reactions.favorites.concat([v]));
            render();
          } }, '+ Fav'))),
      h('section', null,
        h('h3', null, 'Automatic'),
        toggle('reactions.autoWhilePlaying', 'Send a reaction while music plays'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Emoji'), text('reactions.autoEmoji', '🎵')),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Every'), range('reactions.autoInterval', 5, 120, 1, (v) => `${v}s`))),
      h('section', null, h('h3', null, 'Incoming'), feed)
    );
    return wrap;
  }

  // --- Setup tab --------------------------------------------------------------
  function setupTab() {
    const bitrates = [32000, 64000, 96000, 128000, 160000, 192000, 256000, 320000, 510000].map((b) => [b, `${b / 1000} kbps`]);
    const reattach = h('button', { class: 'btn sm' }, 'Re-attach now');
    reattach.addEventListener('click', async () => {
      const n = await ISS.hooks.reattach();
      toast(n ? `ISS mix attached to ${n} connection${n > 1 ? 's' : ''}` : 'No active Space connection found (or already attached).', n ? 'ok' : 'warn');
    });
    return h('div', null,
      h('section', null,
        toggle('enabled', 'ISS enabled', 'Takes effect the next time you join or start speaking in a Space.'),
        h('div', { class: 'row' }, h('span', { class: 'grow', style: { color: 'var(--muted)', fontSize: '12px' } }, 'Already speaking in a Space? Push the ISS mix into it:'), reattach)),
      h('section', null,
        h('h3', null, 'Microphone'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Device'), deviceSelect('mic.deviceId', 'audioinput', 'Same as X')),
        h('div', { class: 'note warn' }, 'Wear headphones. With echo cancellation off, speakers will feed the Space back into your mic.'),
        toggle('processing.echoCancellation', 'Echo cancellation'),
        toggle('processing.noiseSuppression', 'Noise suppression', 'Destroys music. Leave off.'),
        toggle('processing.autoGainControl', 'Auto gain', 'Pumps the volume. Leave off.'),
        toggle('mic.highpass.enabled', 'Low-cut filter (rumble)'),
        toggle('mic.compressor.enabled', 'Voice compressor'),
        toggle('mic.gate.enabled', 'Noise gate'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Gate at'), range('mic.gate.threshold', -90, -20, 1, (v) => `${v} dB`)),
        toggle('mic.monitor', 'Hear my own mic')),
      h('section', null,
        h('h3', null, 'Stream quality'),
        toggle('opus.enabled', 'High-quality Opus', 'Raises bitrate and turns off silence-dropping.'),
        toggle('opus.stereo', 'Stereo'),
        h('div', { class: 'row' }, h('label', { class: 'name' }, 'Bitrate'), select('opus.bitrate', bitrates)),
        toggle('opus.fec', 'Packet-loss protection (FEC)'),
        toggle('forceDirect', 'Always send the ISS mix', 'Stops X from swapping in its own processed audio.')),
      h('section', null,
        h('h3', null, 'Other'),
        toggle('hotkeys', 'Soundboard hotkeys (Alt+key)'),
        toggle('debug', 'Debug logging (console)'),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm danger', onclick: () => confirm('Reset all ISS settings?') && ISS.resetSettings() }, 'Reset settings'),
          h('span', { class: 'grow' }),
          h('a', { href: 'https://github.com/skullzarmy/international-space-station', target: '_blank', rel: 'noopener' }, 'Source'),
          h('span', { style: { color: 'var(--muted)' } }, `v${ISS.version} · Unlicense`)))
    );
  }

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------
  const TABS = [
    ['mix', 'Mixer', mixerTab],
    ['board', 'Board', boardTab],
    ['station', 'Station', stationTab],
    ['react', 'React', reactTab],
    ['setup', 'Setup', setupTab],
  ];

  function mount() {
    if (ui.host || !doc.documentElement) return;
    const host = h('div', { id: 'iss-international-space-station' });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    const wrap = h('div', { class: 'wrap' });
    shadow.append(style, wrap);

    const dot = h('span', { class: 'dot' });
    const launcher = h('button', { class: 'launcher', title: 'ISS · International Space Station (Alt+Shift+S)' }, icon('iss'), dot);
    const chips = {
      mic: h('span', { class: 'chip' }, 'Mic'),
      air: h('span', { class: 'chip' }, 'Off air'),
      chat: h('span', { class: 'chip' }, 'Reactions'),
      duck: h('span', { class: 'chip', hidden: true }, 'Ducking'),
    };
    const nav = h('nav');
    const main = h('main');
    const panel = h('div', { class: 'panel', hidden: true },
      h('header', null,
        h('span', { class: 'title' }, icon('iss'), 'ISS', h('small', null, 'International Space Station')),
        h('span', { class: 'sp' }),
        h('button', { class: 'iconbtn', title: 'Close', onclick: () => setOpen(false) }, icon('close'))),
      h('div', { class: 'chips' }, chips.mic, chips.air, chips.chat, chips.duck),
      nav, main);
    ui.toasts = h('div', { class: 'toasts' });
    wrap.append(launcher, panel, ui.toasts);

    const views = {};
    const buttons = {};
    function showTab(id) {
      if (!views[id]) {
        const def = TABS.find((t) => t[0] === id) || TABS[0];
        views[id] = def[2]();
        main.append(views[id]);
      }
      for (const [k, v] of Object.entries(views)) v.hidden = k !== id;
      for (const [k, b] of Object.entries(buttons)) b.classList.toggle('active', k === id);
      ui.tab = id;
      if (ISS.settings.panel.tab !== id) ISS.set('panel.tab', id);
    }
    for (const [id, label] of TABS) {
      buttons[id] = h('button', { onclick: () => showTab(id) }, label);
      nav.append(buttons[id]);
    }

    function place() {
      const p = ISS.settings.panel;
      const w = panel.offsetWidth || 372;
      const hgt = panel.offsetHeight || 500;
      let x = p.x == null ? 16 : p.x;
      let y = p.y == null ? root.innerHeight - hgt - 80 : p.y;
      x = Math.max(8, Math.min(root.innerWidth - w - 8, x));
      y = Math.max(8, Math.min(root.innerHeight - 60, y));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    }

    function setOpen(open) {
      panel.hidden = !open;
      if (open) {
        showTab(ui.tab || ISS.settings.panel.tab || 'mix');
        place();
        ISS.engine.resume && ISS.engine.resume();
      }
      if (ISS.settings.panel.open !== open) ISS.set('panel.open', open);
    }
    ui.setOpen = setOpen;
    ui.toggle = () => setOpen(panel.hidden);
    launcher.addEventListener('click', ui.toggle);

    // Dragging
    const header = panel.querySelector('header');
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      header.setPointerCapture(e.pointerId);
      const move = (ev) => {
        ISS.settings.panel.x = ev.clientX - dx;
        ISS.settings.panel.y = ev.clientY - dy;
        place();
      };
      const up = () => {
        header.removeEventListener('pointermove', move);
        header.removeEventListener('pointerup', up);
        ISS.saveSettings();
      };
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', up);
    });
    root.addEventListener('resize', () => !panel.hidden && place());

    // Keep X's keyboard shortcuts from firing while typing in the panel.
    for (const ev of ['keydown', 'keyup', 'keypress']) {
      host.addEventListener(ev, (e) => {
        const t = e.composedPath()[0];
        if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) e.stopPropagation();
      });
    }
    root.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        ui.toggle();
      }
    }, true);

    // Status
    function syncStatus() {
      const live = ISS.engine.live;
      const peers = ISS.hooks.livePeers().length;
      const micOn = !!ISS.engine.mic.source;
      chips.mic.className = `chip ${micOn ? 'on' : ''}`;
      chips.mic.textContent = micOn ? 'Mic ✓' : 'Mic';
      chips.air.className = `chip ${live && peers ? 'live' : ''}`;
      chips.air.textContent = live && peers ? 'On air' : 'Off air';
      const chat = ISS.chat.status().linked;
      chips.chat.className = `chip ${chat ? 'on' : ''}`;
      chips.chat.textContent = chat ? 'Reactions ✓' : 'Reactions';
      dot.className = `dot ${live && peers ? 'live' : micOn || chat ? 'ready' : ''}`;
      if (!ISS.settings.enabled) {
        chips.air.className = 'chip warn';
        chips.air.textContent = 'ISS disabled';
      }
    }
    for (const ev of ['mic', 'output', 'peers', 'chat', 'settings']) ISS.on(ev, syncStatus);
    ISS.on('duck', (e) => (chips.duck.hidden = !e.ducked));
    ISS.on('toast', (t) => toast(t.msg, t.kind));
    syncStatus();

    // Meters (only while visible)
    function frame() {
      if (!panel.hidden) {
        if (ui.tab === 'mix') {
          const lv = ISS.engine.levels();
          for (const [k, bar] of Object.entries(ui.meters)) {
            const db = lv ? lv[k] : -120;
            const w = Math.max(0, Math.min(1, (db + 60) / 60));
            bar.style.width = `${(w * 100).toFixed(1)}%`;
          }
        } else if (ui.tab === 'station' && ui.stationTick) ui.stationTick();
      }
      root.requestAnimationFrame(frame);
    }
    root.requestAnimationFrame(frame);

    doc.documentElement.append(host);
    ui.host = host;
    if (ISS.settings.panel.open) setOpen(true);
  }

  ISS.ui = { mount, toast: (m, k) => toast(m, k), open: () => ui.setOpen && ui.setOpen(true), toggle: () => ui.toggle && ui.toggle() };
})(typeof globalThis !== 'undefined' ? globalThis : this);
