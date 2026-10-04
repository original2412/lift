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
    if (meta) meta.setAttribute('content', t === 'light' ? '#f4f5f7' : '#0a0c10');
  };

  // ---- resume bar (shown above tab bar when a workout is active) ----
  let resumeBar;
  App.updateResumeBar = function () {
    const active = DB.state.active;
    const h = location.hash || '';
    // the workout screen and Home (its hero card) already show it
    const onWorkoutScreen = h.indexOf('/workout') === 1 || h === '' || h === '#/' || h === '#';
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
        U.fmtClock(App.workoutElapsed(DB.state.active));
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
        e.secondary = f.secondary; e.repMin = f.repMin; e.repMax = f.repMax; e.lengthened = f.lengthened;
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

    // Routines shipped with the app (App.BUNDLED_ROUTINES): add each once.
    const imported = (S.settings.importedRoutines || []).slice();
    App.BUNDLED_ROUTINES.forEach(function (b) {
      if (imported.indexOf(b.key) >= 0) return;
      S.saveRoutine({
        name: b.name,
        items: b.items.filter(function (it) { return S.exercise(it[0]); }).map(function (it) {
          const rr = S.defaultRepRange(it[0]);
          return {
            exerciseId: it[0], restSec: it[1], repMin: rr.min, repMax: rr.max, notes: '',
            sets: it[2].map(function (s) { return { type: s[0], weight: s[1], reps: s[2] }; })
          };
        })
      });
      imported.push(b.key);
    });
    if (imported.length !== (S.settings.importedRoutines || []).length) {
      DB.saveNow('routines');
      DB.setSettings({ importedRoutines: imported });
    }

    // One-time: before the finish-time "Update routine?" prompt existed,
    // routines never learned sets you added during a workout (the editor
    // starts each exercise at 1 set). Match each routine exercise's sets to
    // the last time you did that routine.
    if (!S.settings.routinesSyncedFromHistory) {
      const hist = S.workouts();
      let changed = false;
      DB.state.routines.forEach(function (r) {
        const last = hist.filter(function (w) { return w.routineId === r.id; })[0];
        if (!last) return;
        r.items.forEach(function (ri) {
          const wi = (last.items || []).filter(function (x) { return x.exerciseId === ri.exerciseId; })[0];
          if (!wi || !wi.sets.length || wi.sets.length === ri.sets.length) return;
          ri.sets = wi.sets.map(function (s) { return { type: s.type || 'normal', weight: s.weight, reps: s.reps }; });
          changed = true;
        });
      });
      if (changed) DB.saveNow('routines');
      DB.setSettings({ routinesSyncedFromHistory: true });
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
