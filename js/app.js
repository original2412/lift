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
    if (resumeBar && DB.state.active) {
      const s = resumeBar.querySelector('.s');
      if (s) s.textContent = U.pluralize(DB.state.active.items.length, 'exercise') + ' · ' +
        U.fmtClock((Date.now() - DB.state.active.startedAt) / 1000);
    }
  }, 1000);

  // ---- boot ----
  function boot() {
    DB.load();

    if (!S.settings.firstRunDone || DB.state.exercises.length === 0) {
      if (DB.state.exercises.length === 0) DB.state.exercises = App.seed.exercises();
      DB.setSettings({ firstRunDone: true });
      DB.saveNow('exercises');
    }

    App.applyTheme();

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
