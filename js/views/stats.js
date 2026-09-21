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
      v.appendChild(weeklyVolume());
      v.appendChild(el('div.section-label', { text: 'Overview' }));

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

  function volStatus(n) {
    const T = App.VOLUME_TARGET;
    return n < T.min ? 'low' : n > T.max ? 'high' : 'ok';
  }
  App.volStatus = volStatus;

  function weeklyVolume() {
    const T = App.VOLUME_TARGET;
    const thisWk = U.weekStart(Date.now());
    const cur = S.weeklyMuscleSets(thisWk);
    const prev = S.weeklyMuscleSets(thisWk - 7 * 86400000);
    const muscles = App.GROWTH_MUSCLES.slice();
    Object.keys(cur).forEach(function (m) {
      if (muscles.indexOf(m) < 0 && ['Cardio', 'Other', 'Full Body'].indexOf(m) < 0) muscles.push(m);
    });
    const scale = Math.max.apply(null, [T.max + 5].concat(muscles.map(function (m) { return cur[m] || 0; })));
    const inRange = muscles.filter(function (m) { return volStatus(cur[m] || 0) === 'ok'; }).length;

    const card = el('div.card');
    card.appendChild(el('div.muted.tiny', {
      text: 'Aim for ' + T.min + '–' + T.max + ' hard sets per muscle each week. ' + inRange + ' of ' + muscles.length + ' in range.'
    }));
    muscles.forEach(function (m) {
      const n = cur[m] || 0, st = volStatus(n);
      card.appendChild(el('div.vol-row', null, [
        el('div.rowsplit.tiny', null, [
          el('span', null, [el('span.vol-dot.' + st), m]),
          el('span', null, [el('strong', { text: String(n) }), el('span.faint', { text: '  · last wk ' + (prev[m] || 0) })])
        ]),
        el('div.vol-track', null, [
          el('div.vol-zone', { style: { left: (T.min / scale * 100) + '%', width: ((T.max - T.min) / scale * 100) + '%' } }),
          el('div.vol-fill.' + st, { style: { width: Math.min(100, n / scale * 100) + '%' } })
        ])
      ]));
    });
    return el('div', null, [el('div.section-label', { text: 'Sets per muscle · this week' }), card]);
  }

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
