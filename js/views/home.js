/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  function routineSubtitle(r) {
    const names = r.items.map(function (it) { return S.exerciseName(it.exerciseId); });
    if (!names.length) return 'No exercises yet';
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? shown + ' +' + (names.length - 3) + ' more' : shown;
  }

  function lastDoneFor(routineId) {
    const w = S.workouts().find(function (x) { return x.routineId === routineId; });
    return w ? U.relDay(w.startedAt) : null;
  }

  function routineCard(r) {
    const last = lastDoneFor(r.id);
    return el('div.card', null, [
      el('div.rowsplit', null, [
        el('div', { style: { minWidth: 0 } }, [
          el('h3', { text: r.name, style: { fontSize: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }),
          el('div.muted.tiny', { text: routineSubtitle(r), style: { marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }),
          last ? el('div.faint.tiny', { text: 'Last done ' + last, style: { marginTop: '2px' } }) : null
        ]),
        el('button.icon-btn', { html: svg(ICON.dots), 'aria-label': 'Routine options', onclick: function () { routineMenu(r); } })
      ]),
      el('div.btn-row', { style: { marginTop: '12px' } }, [
        el('button.btn.primary', {
          html: svg(ICON.play) + '<span>Start Routine</span>',
          disabled: r.items.length === 0,
          onclick: function () { App.workout.startFromRoutine(r.id); }
        })
      ])
    ]);
  }

  function weekCard() {
    const T = App.VOLUME_TARGET;
    const cur = S.weeklyMuscleSets(U.weekStart(Date.now()));
    const low = App.GROWTH_MUSCLES
      .map(function (m) { return [m, cur[m] || 0]; })
      .filter(function (p) { return p[1] < T.min; })
      .sort(function (a, b) { return a[1] - b[1]; });
    const onTarget = App.GROWTH_MUSCLES.length - low.length;
    return el('a.card.tight', { href: '#/stats', style: { display: 'block' } }, [
      el('div.rowsplit', null, [
        el('strong', { text: 'This week', style: { fontSize: '14px' } }),
        el('span.faint.tiny', { text: onTarget + '/' + App.GROWTH_MUSCLES.length + ' muscles at ' + T.min + '+ sets' })
      ]),
      low.length
        ? el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' } },
            [el('span.tiny.muted', { text: 'Behind:', style: { marginRight: '2px' } })].concat(low.map(function (p) {
              return el('span.pill', { text: p[0] + ' ' + p[1] });
            })))
        : el('div.tiny', { text: 'Every muscle is in the growth range.', style: { marginTop: '6px', color: 'var(--good)' } })
    ]);
  }

  function routineMenu(r) {
    UI.menu(r.name, [
      { label: 'Edit routine', icon: ICON.edit, onClick: function () { R.go('/routine/' + r.id + '/edit'); } },
      { label: 'Duplicate', icon: ICON.copy, onClick: function () {
        S.duplicateRoutine(r.id); UI.toast('Routine duplicated');
      } },
      { label: 'Delete routine', icon: ICON.trash, danger: true, onClick: function () {
        UI.confirm({ title: 'Delete “' + r.name + '”?', message: 'This cannot be undone. Your workout history stays.', confirmText: 'Delete', danger: true })
          .then(function (ok) { if (ok) { S.deleteRoutine(r.id); UI.toast('Routine deleted'); } });
      } }
    ]);
  }

  App.router.add('/', function (ctx) {
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      v.appendChild(el('div.page-head', null, [
        el('h1', { text: 'Workout' })
      ]));

      const active = App.db.state.active;
      if (active) {
        v.appendChild(el('div.card', { style: { borderColor: 'var(--accent)' } }, [
          el('div.rowsplit', null, [
            el('div', null, [
              el('h3', { text: active.name || 'Workout in progress', style: { fontSize: '15px' } }),
              el('div.muted.tiny', { text: U.pluralize(active.items.length, 'exercise'), style: { marginTop: '2px' } })
            ]),
            el('span.pill', { text: 'In progress' })
          ]),
          el('button.btn.primary', { text: 'Resume workout', style: { marginTop: '12px' }, onclick: function () { R.go('/workout'); } })
        ]));
      } else {
        v.appendChild(el('button.btn.primary', {
          html: svg(ICON.plus) + '<span>Start Empty Workout</span>',
          style: { marginBottom: '18px' },
          onclick: function () { App.workout.startEmpty(); }
        }));
      }

      if (S.workouts().length) v.appendChild(weekCard());

      v.appendChild(el('div.rowsplit', { style: { margin: '6px 2px 10px' } }, [
        el('div.section-label', { text: 'Routines', style: { margin: 0 } }),
        el('button.btn.sm.ghost', {
          html: svg(ICON.plus) + '<span>New</span>',
          onclick: function () { R.go('/routine/new'); }
        })
      ]));

      const routines = S.routines();
      if (!routines.length) {
        v.appendChild(el('div.empty', {
          html: svg(ICON.dumbbell) + '<div>No routines yet.</div><div class="tiny">Create one, or just start an empty workout and add exercises as you go.</div>'
        }));
      } else {
        routines.forEach(function (r) { v.appendChild(routineCard(r)); });
      }
    });
  }, { tab: 'home' });
})();
