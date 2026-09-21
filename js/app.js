/* global window, document */
(function () {
  'use strict';
  const App = window.App;
  const DB = App.db, S = App.store, U = App.utils, UI = App.ui;

  // ---- unit helpers used across views ----
  App.unit = function () { return S.settings.units === 'lb' ? 'lb' : 'kg'; };
  App.fmtW = function (kg) {
    if (kg == null || kg === '') return 0;
    const val = U.toDisplayWeight(Number(kg), App.unit());
    return U.round(val, 0.01);
  };

  App.applyTheme = function () {
    const t = S.settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f4f5f7' : '#0f1115');
  };

  // ---- resume bar (shown above tab bar when a workout is active) ----
  let resumeBar;
  App.updateResumeBar = function () {
    const active = DB.state.active;
    const onWorkoutScreen = (location.hash || '').indexOf('/workout') === 1;
    if (resumeBar) { resumeBar.remove(); resumeBar = null; }
    if (!active || onWorkoutScreen) return;
    resumeBar = UI.el('div.resume-bar', null, [
      UI.el('span', { html: UI.svg(UI.ICON.dumbbell, ' style="width:20px;height:20px"') }),
      UI.el('div.grow', null, [
        UI.el('div.t', { text: active.name || 'Workout' }),
        UI.el('div.s', { text: U.pluralize(active.items.length, 'exercise') + ' · tap to resume' })
      ]),
      UI.el('button', { text: 'Resume', onclick: function () { App.router.go('/workout'); } })
    ]);
    resumeBar.addEventListener('click', function (e) {
      if (e.target.tagName !== 'BUTTON') App.router.go('/workout');
    });
    document.getElementById('app').appendChild(resumeBar);
  };

  // keep resume-bar elapsed text alive
  setInterval(function () {
    // Rest ending while you're on another screen of the app: the workout view
    // isn't mounted to chime, and the worker stays quiet because we're visible.
    const a = DB.state.active;
    const onWorkout = (location.hash || '').indexOf('/workout') === 1;
    if (a && a.rest && !onWorkout) App.quietIfWatching(a, (a.rest.endsAt - Date.now()) / 1000);
    if (a && a.rest && !onWorkout && !document.hidden && Date.now() >= a.rest.endsAt) {
      if (Date.now() - a.rest.endsAt < 3000) { UI.chime(); UI.buzz([200, 100, 200]); }
      a.rest = null;
      DB.saveNow('active');
    }
    if (resumeBar && DB.state.active) {
      const s = resumeBar.querySelector('.s');
      if (s) s.textContent = U.pluralize(DB.state.active.items.length, 'exercise') + ' · ' +
        U.fmtClock((Date.now() - DB.state.active.startedAt) / 1000);
    }
  }, 1000);

  // ---- boot ----
  function boot() {
    DB.load();

    if (DB.state.exercises.length === 0) {
      DB.state.exercises = App.seed.exercises();
      DB.setSettings({ firstRunDone: true, builtinVersion: App.seed.VERSION });
      DB.saveNow('exercises');
    } else if (S.settings.builtinVersion !== App.seed.VERSION) {
      // Built-in exercise data changed (new fields, images, fixes) since this
      // device last seeded — refresh built-ins in place, leave customs alone.
      const fresh = App.seed.exercises();
      const freshById = {};
      fresh.forEach(function (e) { freshById[e.id] = e; });
      DB.state.exercises.forEach(function (e) {
        if (e.isCustom) return;
        const f = freshById[e.id];
        if (!f) return;
        e.name = f.name; e.primary = f.primary; e.equipment = f.equipment;
        e.tracking = f.tracking; e.image = f.image;
        e.secondary = f.secondary; e.repMin = f.repMin; e.repMax = f.repMax;
        delete freshById[e.id];
      });
      const existingIds = {};
      DB.state.exercises.forEach(function (e) { existingIds[e.id] = true; });
      Object.keys(freshById).forEach(function (id) {
        if (!existingIds[id]) DB.state.exercises.push(freshById[id]);
      });
      DB.setSettings({ firstRunDone: true, builtinVersion: App.seed.VERSION });
      DB.saveNow('exercises');
    }

    App.applyTheme();
    App.push.refresh();

    // define default routes' 404 -> home
    App.router.add('/:anything', function (ctx) {
      App.router.go('/', true);
    }, { tab: 'home' });

    App.router.render();

    // persist active workout on background/exit
    window.addEventListener('pagehide', function () { DB.saveNow('active'); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) DB.saveNow();
    });

    // service worker (only over http/https)
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW failed', e); });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
