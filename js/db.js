/* global window */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const U = App.utils;

  const PREFIX = 'lift.v1.';
  const COLLECTIONS = ['settings', 'exercises', 'routines', 'workouts', 'measurements', 'active'];

  const DEFAULT_SETTINGS = {
    units: 'kg',
    defaultRestSec: 120,
    incKg: 2.5,
    incLb: 5,
    theme: 'dark',
    wakeLock: true,
    firstRunDone: false,
    builtinVersion: 0
  };

  // In-memory mirror of persisted data. Views read from here synchronously.
  const state = {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    exercises: [],
    routines: [],
    workouts: [],
    measurements: [],
    active: null
  };

  function keyFor(c) { return PREFIX + c; }

  function readRaw(c) {
    try {
      const s = localStorage.getItem(keyFor(c));
      return s ? JSON.parse(s) : undefined;
    } catch (e) {
      console.warn('read failed', c, e);
      return undefined;
    }
  }

  function writeRaw(c, value) {
    try {
      localStorage.setItem(keyFor(c), JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('write failed', c, e);
      if (App.ui) App.ui.toast('Storage full — export a backup');
      return false;
    }
  }

  const flushers = {};
  COLLECTIONS.forEach(function (c) {
    flushers[c] = U.debounce(function () {
      writeRaw(c, c === 'settings' || c === 'active' ? state[c] : state[c]);
    }, 250);
  });

  const DB = {
    state: state,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,

    load: function () {
      const s = readRaw('settings');
      if (s && typeof s === 'object') state.settings = Object.assign({}, DEFAULT_SETTINGS, s);

      ['exercises', 'routines', 'workouts', 'measurements'].forEach(function (c) {
        const v = readRaw(c);
        state[c] = Array.isArray(v) ? v : [];
      });

      const a = readRaw('active');
      state.active = a && typeof a === 'object' ? a : null;

      return state;
    },

    // Persist one collection (debounced).
    save: function (c) {
      if (flushers[c]) flushers[c]();
    },

    // Persist immediately (used before unload / on finish).
    saveNow: function (c) {
      if (c) return writeRaw(c, state[c]);
      COLLECTIONS.forEach(function (k) { writeRaw(k, state[k]); });
      return true;
    },

    setSettings: function (patch) {
      Object.assign(state.settings, patch);
      DB.save('settings');
    },

    setActive: function (w) {
      state.active = w;
      DB.saveNow('active');
    },

    exportAll: function () {
      return {
        app: 'lift',
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          settings: state.settings,
          exercises: state.exercises,
          routines: state.routines,
          workouts: state.workouts,
          measurements: state.measurements
        }
      };
    },

    importAll: function (obj, mode) {
      // mode: 'replace' | 'merge'
      if (!obj || !obj.data) throw new Error('Unrecognised backup file');
      const d = obj.data;
      if (mode === 'replace') {
        state.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
        state.exercises = Array.isArray(d.exercises) ? d.exercises : [];
        state.routines = Array.isArray(d.routines) ? d.routines : [];
        state.workouts = Array.isArray(d.workouts) ? d.workouts : [];
        state.measurements = Array.isArray(d.measurements) ? d.measurements : [];
      } else {
        const byId = function (arr) {
          const m = {};
          arr.forEach(function (x) { m[x.id] = x; });
          return m;
        };
        ['exercises', 'routines', 'workouts', 'measurements'].forEach(function (c) {
          const incoming = Array.isArray(d[c]) ? d[c] : [];
          const map = byId(state[c]);
          incoming.forEach(function (x) { if (x && x.id) map[x.id] = x; });
          state[c] = Object.keys(map).map(function (k) { return map[k]; });
        });
      }
      DB.saveNow();
    },

    wipe: function () {
      COLLECTIONS.forEach(function (c) {
        try { localStorage.removeItem(keyFor(c)); } catch (e) {}
      });
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
      state.exercises = [];
      state.routines = [];
      state.workouts = [];
      state.measurements = [];
      state.active = null;
    }
  };

  App.db = DB;
})();
