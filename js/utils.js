/* global window */
(function () {
  'use strict';
  const App = (window.App = window.App || {});

  const U = {};

  // ---- ids / misc ----
  U.uid = function () {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };

  U.debounce = function (fn, ms) {
    let t;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  };

  U.deepClone = function (o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  };

  // ---- numbers / units ----
  U.round = function (n, step) {
    step = step || 0.01;
    return Math.round(n / step) * step;
  };

  U.fmtNum = function (n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    n = Number(n);
    return Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, '');
  };

  U.KG_PER_LB = 0.45359237;
  U.toDisplayWeight = function (kg, units) {
    if (kg == null || kg === '') return null;
    return units === 'lb' ? kg / U.KG_PER_LB : kg;
  };
  U.fromDisplayWeight = function (val, units) {
    if (val == null || val === '' || isNaN(val)) return null;
    val = Number(val);
    return units === 'lb' ? val * U.KG_PER_LB : val;
  };

  // Epley 1RM estimate (kg in -> kg out). reps<=1 -> weight itself.
  U.epley1RM = function (weightKg, reps) {
    if (!weightKg || !reps) return 0;
    if (reps <= 1) return weightKg;
    return weightKg * (1 + reps / 30);
  };

  // ---- time / dates ----
  U.now = function () { return Date.now(); };

  U.fmtDuration = function (sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + (s ? s + 's' : '').trim();
    return s + 's';
  };

  U.fmtClock = function (sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  };

  U.fmtDate = function (ts, opts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
  };

  U.fmtTime = function (ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  U.relDay = function (ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return diff + ' days ago';
    return U.fmtDate(ts, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };

  U.monthKey = function (ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };
  U.monthLabel = function (key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };

  // Monday-based week key
  U.weekStart = function (ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - day);
    return d.getTime();
  };

  U.escape = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.initials = function (name) {
    const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p[0] || ''; }).join('').toUpperCase() || '?';
  };

  U.pluralize = function (n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  };

  App.utils = U;
})();
