/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  App.router.add('/history', function (ctx) {
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      v.appendChild(el('div.page-head', null, [el('h1', { text: 'History' })]));

      const list = S.workouts();
      if (!list.length) {
        v.appendChild(el('div.empty', {
          html: svg(ICON.timer) + '<div>No workouts logged yet.</div><div class="tiny">Finished workouts show up here with all their sets.</div>'
        }));
        return;
      }

      // summary strip
      const totalVol = list.reduce(function (n, w) { return n + S.workoutVolume(w); }, 0);
      v.appendChild(el('div.stat-grid', { style: { marginBottom: '8px' } }, [
        box(String(list.length), 'Workouts'),
        box(compact(App.fmtW(totalVol)) + ' ' + App.unit(), 'Total volume'),
        box(String(S.workoutStreakDays()) + 'd', 'Streak')
      ]));

      let lastMonth = null;
      list.forEach(function (w) {
        const mk = U.monthKey(w.startedAt);
        if (mk !== lastMonth) {
          lastMonth = mk;
          v.appendChild(el('div.section-label', { text: U.monthLabel(mk) }));
        }
        v.appendChild(el('a.card.tight', { href: '#/history/' + w.id, style: { display: 'block' } }, [
          el('div.rowsplit', null, [
            el('strong', { text: w.name, style: { fontSize: '15px' } }),
            el('span.faint.tiny', { text: U.relDay(w.startedAt) })
          ]),
          el('div.muted.tiny', { style: { marginTop: '5px' }, text:
            U.fmtDuration(w.durationSec) + '  ·  ' +
            U.pluralize(w.items.length, 'exercise') + '  ·  ' +
            U.fmtNum(App.fmtW(S.workoutVolume(w))) + ' ' + App.unit() + ' volume' +
            (w.prs && w.prs.length ? '  ·  ' + w.prs.length + ' PR' : '')
          }),
          el('div.tiny.faint', { style: { marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            text: w.items.map(function (it) { return S.exerciseName(it.exerciseId); }).join(', ') })
        ]));
      });
    });
  }, { tab: 'history' });

  App.router.add('/history/:id', function (ctx) {
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      const w = S.workout(ctx.params.id);
      if (!w) { v.appendChild(el('div.empty', { text: 'Workout not found' })); return; }

      v.appendChild(el('div.back-row', null, [
        el('button.icon-btn', { html: svg(ICON.back), 'aria-label': 'Back', onclick: function () { R.back('/history'); } }),
        el('span.title', { text: w.name }),
        el('button.icon-btn', { html: svg(ICON.dots), 'aria-label': 'Options', onclick: function () { menu(w); } })
      ]));
      v.appendChild(el('div.muted.tiny', { style: { margin: '0 2px 12px' },
        text: U.fmtDate(w.startedAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + U.fmtTime(w.startedAt) }));

      v.appendChild(el('div.stat-grid', { style: { marginBottom: '12px' } }, [
        box(U.fmtDuration(w.durationSec), 'Duration'),
        box(U.fmtNum(App.fmtW(S.workoutVolume(w))) + ' ' + App.unit(), 'Volume'),
        box(String(S.workoutSetCount(w)), 'Sets')
      ]));

      if (w.notes) v.appendChild(el('div.card.tight.muted.tiny', { text: w.notes }));

      w.items.forEach(function (it) {
        const prForEx = (w.prs || []).find(function (p) { return p.exerciseId === it.exerciseId; });
        const card = el('div.ex-card');
        card.appendChild(el('div.ex-head', null, [
          el('a.ex-name', { text: S.exerciseName(it.exerciseId), href: '#/exercise/' + it.exerciseId }),
          prForEx ? el('span.pr-tag', { html: svg(ICON.trophy, ' style="width:13px;height:13px" fill="currentColor" stroke="none"') + ' PR' }) : null
        ]));
        if (it.notes) card.appendChild(el('div.tiny.muted', { text: it.notes, style: { marginBottom: '6px' } }));
        const table = el('table.set-grid');
        table.appendChild(el('thead', null, el('tr', null, [
          el('th.set-col', { text: 'Set' }), el('th', { text: App.unit() }), el('th', { text: 'Reps' }), el('th', { text: '1RM' })
        ])));
        const tb = el('tbody');
        let wn = 0;
        it.sets.forEach(function (s) {
          if (s.type !== 'warmup') wn++;
          tb.appendChild(el('tr', null, [
            el('td.set-col', null, el('div.set-badge ' + App.setBadgeClass(s.type), { text: App.SET_GLYPH[s.type] || String(wn) })),
            el('td', { text: U.fmtNum(App.fmtW(s.weight)) }),
            el('td', { text: U.fmtNum(s.reps) }),
            el('td.faint', { text: s.type === 'warmup' ? '—' : U.fmtNum(App.fmtW(U.epley1RM(s.weight, s.reps))) })
          ]));
        });
        table.appendChild(tb);
        card.appendChild(table);
        v.appendChild(card);
      });
    });
  }, { tab: 'history', fullscreen: true });

  function menu(w) {
    UI.menu(w.name, [
      { label: 'Rename', icon: ICON.edit, onClick: function () {
        UI.prompt({ title: 'Rename workout', value: w.name }).then(function (name) {
          if (name != null && name.trim()) { w.name = name.trim(); App.db.save('workouts'); App.store.emit(); }
        });
      } },
      { label: 'Edit note', icon: ICON.note, onClick: function () {
        UI.prompt({ title: 'Workout note', value: w.notes || '', placeholder: 'How did it go?' }).then(function (note) {
          if (note != null) { w.notes = note.trim(); App.db.save('workouts'); App.store.emit(); }
        });
      } },
      { label: 'Delete workout', icon: ICON.trash, danger: true, onClick: function () {
        UI.confirm({ title: 'Delete this workout?', message: 'It will be removed from your history and stats.', confirmText: 'Delete', danger: true })
          .then(function (ok) { if (ok) { S.deleteWorkout(w.id); R.back('/history'); } });
      } }
    ]);
  }

  function box(v, k) { return el('div.stat-box', null, [el('div.v', { text: v }), el('div.k', { text: k })]); }
  function compact(n) { n = Math.round(n); return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
})();
