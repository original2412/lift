/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  const MEASURE_TYPES = [
    { key: 'bodyweight', label: 'Bodyweight', unit: 'weight' },
    { key: 'waist', label: 'Waist', unit: 'cm' },
    { key: 'chest', label: 'Chest', unit: 'cm' },
    { key: 'arm', label: 'Arm', unit: 'cm' },
    { key: 'thigh', label: 'Thigh', unit: 'cm' }
  ];

  App.router.add('/stats', function (ctx) {
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      v.appendChild(el('div.page-head', null, [el('h1', { text: 'Stats' })]));

      const workouts = S.workouts();
      const now = Date.now();
      const weekStart = U.weekStart(now);
      const thisWeek = workouts.filter(function (w) { return w.startedAt >= weekStart; });
      const last30 = workouts.filter(function (w) { return w.startedAt >= now - 30 * 86400000; });
      const avgDur = workouts.length ? workouts.reduce(function (n, w) { return n + w.durationSec; }, 0) / workouts.length : 0;

      v.appendChild(el('div.stat-grid', null, [
        box(String(workouts.length), 'Total workouts'),
        box(String(thisWeek.length), 'This week'),
        box(String(S.workoutStreakDays()) + 'd', 'Day streak')
      ]));
      v.appendChild(el('div.stat-grid', { style: { marginTop: '10px' } }, [
        box(String(last30.length), 'Last 30 days'),
        box(workouts.length ? U.fmtDuration(avgDur) : '—', 'Avg length'),
        box(compact(App.fmtW(workouts.reduce(function (n, w) { return n + S.workoutVolume(w); }, 0))), 'Volume ' + App.unit())
      ]));

      // weekly volume
      const wk = S.weeklyVolume(12);
      v.appendChild(el('div.chart-wrap', { style: { marginTop: '14px' } }, [
        el('div.chart-title', null, [el('span', { text: 'Weekly volume · 12 weeks' }), el('span', { text: App.unit() })]),
        el('div', { html: App.charts.bars(wk.map(function (p) {
          return { label: U.fmtDate(p.t, { month: 'short', day: 'numeric' }), value: Math.round(App.fmtW(p.volume)) };
        })) })
      ]));

      // sets per muscle (last 30d)
      const muscleVol = {};
      last30.forEach(function (w) {
        (w.items || []).forEach(function (it) {
          const ex = S.exercise(it.exerciseId);
          const m = ex ? ex.primary : 'Other';
          it.sets.forEach(function (s) { if (s.done && s.type !== 'warmup') muscleVol[m] = (muscleVol[m] || 0) + 1; });
        });
      });
      const muscleRows = Object.keys(muscleVol).sort(function (a, b) { return muscleVol[b] - muscleVol[a]; });
      if (muscleRows.length) {
        const maxM = muscleVol[muscleRows[0]];
        v.appendChild(el('div.section-label', { text: 'Working sets by muscle · 30 days' }));
        const card = el('div.card');
        muscleRows.forEach(function (m) {
          card.appendChild(el('div', { style: { margin: '7px 0' } }, [
            el('div.rowsplit.tiny', null, [el('span', { text: m }), el('span.muted', { text: String(muscleVol[m]) })]),
            el('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--bg-elev-2)', marginTop: '3px', overflow: 'hidden' } },
              el('div', { style: { height: '100%', width: (muscleVol[m] / maxM * 100) + '%', background: 'var(--accent)' } }))
          ]));
        });
        v.appendChild(card);
      }

      // measurements
      v.appendChild(el('div.rowsplit', { style: { margin: '18px 2px 8px' } }, [
        el('div.section-label', { text: 'Body measurements', style: { margin: 0 } }),
        el('button.btn.sm.ghost', { html: svg(ICON.plus) + '<span>Log</span>', onclick: logMeasurement })
      ]));

      MEASURE_TYPES.forEach(function (mt) {
        const series = S.measurements(mt.key);
        if (!series.length) return;
        const latest = series[series.length - 1];
        const unitLabel = mt.unit === 'weight' ? App.unit() : mt.unit;
        v.appendChild(el('div.chart-wrap', null, [
          el('div.chart-title', null, [
            el('span', { text: mt.label }),
            el('span', { text: U.fmtNum(mt.unit === 'weight' ? App.fmtW(latest.value) : latest.value) + ' ' + unitLabel })
          ]),
          el('div', { html: App.charts.line(series.map(function (p) {
            return { t: p.date, v: mt.unit === 'weight' ? App.fmtW(p.value) : p.value };
          }), 'v') }),
          el('button.tiny.faint', { text: 'Remove last entry', style: { marginTop: '6px', padding: '4px' }, onclick: function () {
            S.deleteMeasurement(latest.id);
          } })
        ]));
      });

      if (!S.measurements().length) {
        v.appendChild(el('div.empty.tiny', { text: 'No measurements yet. Tap “Log” to add bodyweight or tape measurements.' }));
      }
    });
  }, { tab: 'stats' });

  function logMeasurement() {
    const typeSel = el('select.input', null, MEASURE_TYPES.map(function (mt) {
      return el('option', { value: mt.key, text: mt.label + (mt.unit === 'weight' ? ' (' + App.unit() + ')' : ' (' + mt.unit + ')') });
    }));
    const valInput = el('input.input', { type: 'text', inputmode: 'decimal', placeholder: 'Value' });
    const dateInput = el('input.input', { type: 'date', value: new Date().toISOString().slice(0, 10) });

    const ref = UI.sheet({
      title: 'Log measurement',
      body: el('div', null, [
        el('label.field', null, [el('span.label', { text: 'Type' }), typeSel]),
        el('label.field', null, [el('span.label', { text: 'Value' }), valInput]),
        el('label.field', null, [el('span.label', { text: 'Date' }), dateInput])
      ]),
      footer: el('button.btn.primary', { text: 'Save', onclick: function () {
        const raw = parseFloat(String(valInput.value).replace(',', '.'));
        if (isNaN(raw)) { valInput.focus(); UI.toast('Enter a number'); return; }
        const mt = MEASURE_TYPES.filter(function (x) { return x.key === typeSel.value; })[0];
        const value = mt.unit === 'weight' ? U.fromDisplayWeight(raw, App.unit()) : raw;
        const d = dateInput.value ? new Date(dateInput.value + 'T12:00:00').getTime() : Date.now();
        S.addMeasurement(typeSel.value, value, d);
        ref.close();
        UI.toast('Saved');
      } })
    });
    setTimeout(function () { valInput.focus(); }, 250);
  }

  function box(v, k) { return el('div.stat-box', null, [el('div.v', { text: v }), el('div.k', { text: k })]); }
  function compact(n) { n = Math.round(App.fmtW ? n : n); n = Math.round(n); return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
})();
