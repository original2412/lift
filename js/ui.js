/* global window, document */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const U = App.utils;

  const UI = {};

  // ---- tiny DOM builder ----
  // el('div.card#id', {onclick:fn, dataset:{}, html:'', ...attrs}, [children])
  UI.el = function (spec, props, children) {
    spec = String(spec).trim();
    const tagMatch = spec.match(/^[a-z0-9]+/i);
    const tag = tagMatch ? tagMatch[0] : 'div';
    const node = document.createElement(tag);
    // classes: ".foo" tokens OR bare space-separated words after the tag
    const afterTag = spec.slice(tag && tagMatch ? tag.length : 0);
    const tokens = afterTag.match(/[.#][^.#\s]+|[^.#\s]+/g) || [];
    tokens.forEach(function (tok) {
      if (tok[0] === '#') node.id = tok.slice(1);
      else if (tok[0] === '.') { if (tok.length > 1) node.classList.add(tok.slice(1)); }
      else node.classList.add(tok);
    });
    props = props || {};
    Object.keys(props).forEach(function (k) {
      const v = props[k];
      if (v == null || v === false) return;
      if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className += ' ' + v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k in node && k !== 'list') { try { node[k] = v; } catch (e) { node.setAttribute(k, v); } }
      else node.setAttribute(k, v);
    });
    UI.append(node, children);
    return node;
  };

  UI.append = function (node, children) {
    if (children == null) return node;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c)) : c);
    });
    return node;
  };

  UI.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  UI.svg = function (paths, attrs) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round"' + (attrs || '') + '>' + paths + '</svg>';
  };

  UI.ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevronR: '<path d="m9 18 6-6-6-6"/>',
    chevronL: '<path d="m15 18-6-6 6-6"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    play: '<path d="m6 4 14 8-14 8Z"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    dumbbell: '<path d="m6.5 6.5 11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M7 17 3 21M17 7l4-4"/>',
    trophy: '<path d="M6 9a6 6 0 0 0 12 0V4H6ZM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M9 20h6M12 15v5"/>',
    swap: '<path d="M7 10 3 6l4-4M3 6h13M17 14l4 4-4 4M21 18H8"/>',
    note: '<path d="M4 4h16v12l-4 4H4Z"/><path d="M16 20v-4h4"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/>',
    upload: '<path d="M12 21V9m0 0 4 4m-4-4-4 4M4 3h16"/>'
  };

  // ---- toast ----
  let toastTimer;
  UI.toast = function (msg, ms) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('in'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('in');
      setTimeout(function () { t.hidden = true; }, 250);
    }, ms || 1900);
  };

  // ---- exercise thumbnail (photo if we have one, else initials avatar) ----
  UI.exerciseThumb = function (ex, size) {
    size = size || 40;
    var radius = Math.max(8, Math.round(size * 0.27));
    if (ex && ex.image) {
      return UI.el('img.ex-thumb', {
        src: ex.image, alt: '', loading: 'lazy',
        style: { width: size + 'px', height: size + 'px', borderRadius: radius + 'px' }
      });
    }
    return UI.el('span.avatar', {
      text: U.initials(ex ? ex.name : '?'),
      style: { width: size + 'px', height: size + 'px', borderRadius: radius + 'px', fontSize: Math.round(size * 0.38) + 'px' }
    });
  };

  // ---- sound ----
  // Browsers only allow audio after a user gesture, so unlockAudio() is called
  // from tap handlers (e.g. completing a set) before chime() is ever needed.
  let actx = null;
  UI.unlockAudio = function () {
    try {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
  };
  UI.chime = function () {
    UI.unlockAudio();
    if (!actx) return;
    const t0 = actx.currentTime + 0.02;
    [[0, 880], [0.18, 880], [0.36, 1320]].forEach(function (n) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = n[1];
      g.gain.setValueAtTime(0.0001, t0 + n[0]);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + n[0] + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[0] + 0.16);
      o.connect(g);
      g.connect(actx.destination);
      o.start(t0 + n[0]);
      o.stop(t0 + n[0] + 0.18);
    });
  };

  // ---- duration wheel picker (0 = off, 5s steps up to 10 min) ----
  UI.durationPicker = function (opts) {
    const STEP = 5, MAX = 600, ITEM = 44;
    const values = [];
    for (let s = 0; s <= MAX; s += STEP) values.push(s);
    let idx = Math.round((opts.value || 0) / STEP);
    idx = Math.max(0, Math.min(values.length - 1, idx));

    const wheel = UI.el('div.wheel');
    const items = values.map(function (v, i) {
      return UI.el('div.wheel-item', {
        text: v ? U.fmtClock(v) : 'Off',
        onclick: function () { wheel.scrollTo({ top: i * ITEM, behavior: 'smooth' }); }
      });
    });
    UI.append(wheel, items);

    let raf = 0;
    function mark() {
      raf = 0;
      const i = Math.max(0, Math.min(values.length - 1, Math.round(wheel.scrollTop / ITEM)));
      if (i === idx && items[i].classList.contains('on')) return;
      if (items[idx]) items[idx].classList.remove('on');
      idx = i;
      items[idx].classList.add('on');
    }
    wheel.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(mark); });

    const ref = UI.sheet({
      title: opts.title || 'Rest timer',
      body: UI.el('div.wheel-wrap', null, [UI.el('div.wheel-band'), wheel]),
      footer: UI.el('button.btn.primary', {
        text: 'Save',
        onclick: function () { mark(); ref.close(); opts.onDone(values[idx]); }
      })
    });
    items[idx].classList.add('on');
    // wait for the sheet to lay out before positioning the wheel
    requestAnimationFrame(function () { wheel.scrollTop = idx * ITEM; });
  };

  // ---- haptics ----
  UI.buzz = function (pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 15); } catch (e) {}
  };

  // ---- bottom sheet ----
  // UI.sheet({ title, body:Node, footer:Node, onClose }) -> { close }
  UI.sheet = function (opts) {
    opts = opts || {};
    const root = document.getElementById('sheet-root');
    const backdrop = UI.el('div.sheet-backdrop');
    const sheet = UI.el('div.sheet');
    const head = UI.el('div.sheet-head', null, [
      UI.el('h3', { text: opts.title || '' }),
      UI.el('button.icon-btn', { html: UI.svg(UI.ICON.x), onclick: close, 'aria-label': 'Close' })
    ]);
    sheet.appendChild(UI.el('div.grab'));
    if (opts.title || !opts.hideHead) sheet.appendChild(head);
    const body = UI.el('div.sheet-body');
    UI.append(body, opts.body || null);
    sheet.appendChild(body);
    if (opts.footer) {
      const foot = UI.el('div.sheet-foot');
      UI.append(foot, opts.footer);
      sheet.appendChild(foot);
    }
    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    root.appendChild(backdrop);
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(function () { backdrop.classList.add('in'); });

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      backdrop.classList.remove('in');
      document.documentElement.style.overflow = '';
      setTimeout(function () {
        backdrop.remove();
        if (opts.onClose) opts.onClose();
      }, 220);
    }
    return { close: close, body: body, sheet: sheet };
  };

  // ---- action menu ----
  // UI.menu('Title', [{label, icon, danger, onClick}])
  UI.menu = function (title, items) {
    const rows = items.filter(Boolean).map(function (it) {
      return UI.el('button.menu-item' + (it.danger ? '.danger' : ''), {
        onclick: function () { ref.close(); setTimeout(it.onClick, 60); }
      }, [
        it.icon ? UI.el('span', { html: UI.svg(it.icon) }) : null,
        UI.el('span', { text: it.label })
      ]);
    });
    const ref = UI.sheet({ title: title || '', body: UI.el('div', null, rows) });
    return ref;
  };

  // ---- confirm ----
  UI.confirm = function (opts) {
    return new Promise(function (resolve) {
      let done = false;
      const ref = UI.sheet({
        title: opts.title || 'Are you sure?',
        body: UI.el('p.muted', { text: opts.message || '', style: { margin: '4px 2px 8px' } }),
        footer: UI.el('div.btn-row', null, [
          UI.el('button.btn.ghost', { text: opts.cancelText || 'Cancel', onclick: function () { ref.close(); } }),
          UI.el('button.btn.' + (opts.danger ? 'danger' : 'primary'), {
            text: opts.confirmText || 'Confirm',
            onclick: function () { done = true; resolve(true); ref.close(); }
          })
        ]),
        onClose: function () { if (!done) resolve(false); }
      });
    });
  };

  // ---- prompt (single line / number) ----
  UI.prompt = function (opts) {
    return new Promise(function (resolve) {
      let done = false;
      const input = UI.el('input.input', {
        type: opts.type || 'text',
        value: opts.value != null ? opts.value : '',
        placeholder: opts.placeholder || '',
        inputmode: opts.type === 'number' ? 'decimal' : undefined
      });
      const ref = UI.sheet({
        title: opts.title || '',
        body: UI.el('div', null, [
          opts.label ? UI.el('div.label', { text: opts.label, style: { marginBottom: '6px' } }) : null,
          input
        ]),
        footer: UI.el('div.btn-row', null, [
          UI.el('button.btn.ghost', { text: 'Cancel', onclick: function () { ref.close(); } }),
          UI.el('button.btn.primary', {
            text: opts.confirmText || 'Save',
            onclick: function () { done = true; resolve(input.value); ref.close(); }
          })
        ]),
        onClose: function () { if (!done) resolve(null); }
      });
      setTimeout(function () { input.focus(); }, 250);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { done = true; resolve(input.value); ref.close(); }
      });
    });
  };

  App.ui = UI;
})();
