/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  App.router.add('/history', function (ctx) {
    let calMonth = null; // first-of-month timestamp shown in the calendar

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

      if (calMonth == null) {
        const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
        calMonth = d.getTime();
      }
      const calHost = el('div');
      v.appendChild(calHost);
      renderCalendar(calHost, list);

      let lastMonth = null;
      list.forEach(function (w) {
        const mk = U.monthKey(w.startedAt);
        if (mk !== lastMonth) {
          lastMonth = mk;
          const n = list.filter(function (x) { return U.monthKey(x.startedAt) === mk; }).length;
          v.appendChild(el('div.section-label.rowsplit', null, [
            el('span', { text: U.monthLabel(mk) }),
            el('span', { text: U.pluralize(n, 'workout') })
          ]));
        }
        v.appendChild(workoutCard(w));
      });
    });

    function renderCalendar(host, list) {
      UI.clear(host);
      const first = new Date(calMonth);
      const year = first.getFullYear(), month = first.getMonth();
      const daysIn = new Date(year, month + 1, 0).getDate();
      const lead = (first.getDay() + 6) % 7; // Monday-first
      const byDay = {};
      list.forEach(function (w) {
        const d = new Date(w.startedAt);
        if (d.getFullYear() === year && d.getMonth() === month) {
          (byDay[d.getDate()] = byDay[d.getDate()] || []).push(w);
        }
      });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const count = Object.keys(byDay).reduce(function (n, k) { return n + byDay[k].length; }, 0);

      const grid = el('div.cal-grid');
      ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (d) { grid.appendChild(el('div.cal-dow', { text: d })); });
      for (let i = 0; i < lead; i++) grid.appendChild(el('div.cal-day.out'));
      for (let day = 1; day <= daysIn; day++) {
        const t = new Date(year, month, day).getTime();
        const ws = byDay[day];
        const cls = 'div.cal-day' + (ws ? '.on' : '') + (t === today.getTime() ? '.today' : '') + (t > today.getTime() ? '.future' : '');
        grid.appendChild(el(cls, {
          text: String(day),
          onclick: ws ? function () { R.go('/history/' + ws[0].id); } : null
        }));
      }

      const isCurrent = (function () { const n = new Date(); return n.getFullYear() === year && n.getMonth() === month; })();
      host.appendChild(el('div.card', null, [
        el('div.cal-head', null, [
          el('button.icon-btn', { html: svg(ICON.chevronL), 'aria-label': 'Previous month', onclick: function () {
            calMonth = new Date(year, month - 1, 1).getTime(); renderCalendar(host, list);
          } }),
          el('div.center', null, [
            el('div', { text: U.monthLabel(U.monthKey(calMonth)), style: { fontWeight: '700' } }),
            el('div.faint.tiny', { text: U.pluralize(count, 'workout') })
          ]),
          el('button.icon-btn', { html: svg(ICON.chevronR), 'aria-label': 'Next month', disabled: isCurrent, onclick: function () {
            calMonth = new Date(year, month + 1, 1).getTime(); renderCalendar(host, list);
          } })
        ]),
        grid
      ]));
    }
  }, { tab: 'history' });

  function workoutCard(w) {
    const lines = el('div.wk-lines');
    const shown = w.items.slice(0, 4);
    shown.forEach(function (it) {
      const best = S.bestSet(it);
      const n = (it.sets || []).filter(function (s) { return s.type !== 'warmup'; }).length;
      lines.appendChild(el('div.wk-line', null, [
        UI.exerciseThumb(S.exercise(it.exerciseId), 28),
        el('span.n', { text: n + ' × ' + S.exerciseName(it.exerciseId) }),
        best ? el('span.b', { text: U.fmtNum(App.fmtW(best.weight)) + ' ' + App.unit() + ' × ' + best.reps }) : null
      ]));
    });
    if (w.items.length > shown.length) {
      lines.appendChild(el('div.faint.tiny', { text: '+' + U.pluralize(w.items.length - shown.length, 'more exercise'), style: { paddingTop: '4px' } }));
    }
    const prs = (w.prs || []).length;
    return el('a.wk-card', { href: '#/history/' + w.id }, [
      el('div.rowsplit', null, [
        el('div', { style: { minWidth: 0 } }, [
          el('div.title', { text: w.name }),
          el('div.when', { text: U.relDay(w.startedAt) + ' · ' + U.fmtTime(w.startedAt) })
        ]),
        el('span.chev', { html: svg(ICON.chevronR, ' style="width:18px;height:18px;color:var(--text-faint)"') })
      ]),
      miniStats([
        ['Time', U.fmtDuration(w.durationSec)],
        ['Volume', U.fmtCompact(App.fmtW(S.workoutVolume(w))) + ' ' + App.unit()],
        ['Sets', String(S.workoutSetCount(w))],
        prs ? ['Records', null, el('span', { html: svg(ICON.trophy, ' style="width:14px;height:14px;vertical-align:-2px;color:var(--pr)"') + ' ' + prs })] : null
      ]),
      lines
    ]);
  }

  // [[label, text, optionalNode], ...] -> compact labeled stats row
  function miniStats(rows) {
    return el('div.mini-stats', null, rows.filter(Boolean).map(function (r) {
      return el('div', null, [el('div.k', { text: r[0] }), el('div.v', { text: r[2] ? null : r[1] }, r[2] || null)]);
    }));
  }
  App.miniStats = miniStats;

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

      const prs = (w.prs || []).length;
      v.appendChild(el('div.card', { style: { paddingTop: '4px' } }, miniStats([
        ['Time', U.fmtDuration(w.durationSec)],
        ['Volume', U.fmtCompact(App.fmtW(S.workoutVolume(w))) + ' ' + App.unit()],
        ['Sets', String(S.workoutSetCount(w))],
        prs ? ['Records', String(prs)] : null
      ])));

      if (w.notes) v.appendChild(el('div.card.tight.muted.tiny', { text: w.notes }));

      w.items.forEach(function (it) {
        const prForEx = (w.prs || []).find(function (p) { return p.exerciseId === it.exerciseId; });
        const card = el('div.ex-card');
        card.appendChild(el('div.ex-head', null, [
          UI.exerciseThumb(S.exercise(it.exerciseId), 34),
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
})();
