/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;
  const WEEK = 7 * 86400000;

  const MEASURE_TYPES = [
    { key: 'bodyweight', label: 'Bodyweight', unit: 'weight' },
    { key: 'waist', label: 'Waist', unit: 'cm' },
    { key: 'chest', label: 'Chest', unit: 'cm' },
    { key: 'arm', label: 'Arm', unit: 'cm' },
    { key: 'thigh', label: 'Thigh', unit: 'cm' }
  ];

  const CHART_METRICS = {
    volume: { label: 'Volume', get: function (p) { return Math.round(App.fmtW(p.volume)); }, fmt: U.fmtCompact },
    sets: { label: 'Sets', get: function (p) { return p.sets; }, fmt: U.fmtNum },
    workouts: { label: 'Workouts', get: function (p) { return p.workouts; }, fmt: U.fmtNum }
  };

  App.router.add('/stats', function (ctx) {
    let metric = 'volume';

    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      v.appendChild(el('div.page-head', null, [el('h1', { text: 'Stats' })]));

      const weeks = S.weeklyVolume(12);
      v.appendChild(thisWeekCard(weeks));
      v.appendChild(muscleCard());

      const chartHost = el('div');
      v.appendChild(chartHost);
      renderChart();

      const prs = S.recentPRs(5);
      if (prs.length) v.appendChild(prCard(prs));

      v.appendChild(allTimeCard());
      v.appendChild(measurementsSection());

      function renderChart() {
        UI.clear(chartHost);
        const m = CHART_METRICS[metric];
        const seg = el('div.seg', null, Object.keys(CHART_METRICS).map(function (k) {
          return el('button' + (k === metric ? '.on' : ''), {
            text: CHART_METRICS[k].label,
            onclick: function () { metric = k; renderChart(); }
          });
        }));
        chartHost.appendChild(el('div.card', null, [
          el('div.card-title', null, [el('h3', { text: 'Last 12 weeks' }), seg]),
          el('div', { html: App.charts.bars(weeks.map(function (p) {
            return { label: U.fmtDate(p.t, { day: 'numeric', month: 'short' }), value: m.get(p) };
          }), m.fmt, { labelEvery: 3 }) })
        ]));
      }
    });
  }, { tab: 'stats' });

  // ---------- this week vs last week ----------
  // Totals for workouts started in [from, to).
  function totals(from, to) {
    const t = { workouts: 0, sets: 0, volume: 0, seconds: 0 };
    S.workouts().forEach(function (w) {
      if (w.startedAt < from || w.startedAt >= to) return;
      t.workouts++; t.sets += S.workoutSetCount(w); t.volume += S.workoutVolume(w); t.seconds += w.durationSec || 0;
    });
    return t;
  }

  function thisWeekCard(weeks) {
    const cur = weeks[weeks.length - 1];
    // Compare against last week *up to the same moment* — on a Monday, a
    // full last week would always look like a big drop.
    const now = Date.now(), start = U.weekStart(now);
    const prev = totals(start - WEEK, now - WEEK);
    function delta(a, b) {
      if (!b) return null;
      const pct = Math.round((a - b) / b * 100);
      if (!pct) return null;
      return el('span.d.' + (pct > 0 ? 'up' : 'down'), { text: (pct > 0 ? '▲' : '▼') + Math.abs(pct) + '%' });
    }
    function stat(k, val, d) {
      return el('div', null, [el('div.k', { text: k }), el('div.v', { text: val }), d || el('div.d', { html: '&nbsp;' })]);
    }
    return el('div.card', null, [
      el('div.card-title', null, [
        el('h3', { text: 'This week' }),
        el('span.faint.tiny', { text: 'vs same point last week' })
      ]),
      el('div.mini-stats', { style: { marginTop: 0 } }, [
        stat('Workouts', String(cur.workouts), delta(cur.workouts, prev.workouts)),
        stat('Sets', String(cur.sets), delta(cur.sets, prev.sets)),
        stat('Volume', U.fmtCompact(App.fmtW(cur.volume)) + ' ' + App.unit(), delta(cur.volume, prev.volume)),
        stat('Time', cur.seconds ? U.fmtDuration(cur.seconds) : '0m', delta(cur.seconds, prev.seconds))
      ])
    ]);
  }

  // ---------- sets per muscle vs research-based targets ----------
  function volStatus(m, n) {
    const T = App.muscleTarget(m);
    return n < T.min ? 'low' : n > T.max ? 'high' : 'ok';
  }
  App.volStatus = volStatus;

  function muscleCard() {
    const thisWk = U.weekStart(Date.now());
    const cur = S.weeklyMuscleSets(thisWk);
    const prev = S.weeklyMuscleSets(thisWk - WEEK);
    const muscles = App.GROWTH_MUSCLES.slice();
    Object.keys(cur).forEach(function (m) {
      if (muscles.indexOf(m) < 0 && ['Cardio', 'Other', 'Full Body'].indexOf(m) < 0) muscles.push(m);
    });
    const scale = Math.max.apply(null, [24].concat(muscles.map(function (m) { return cur[m] || 0; })));
    const inRange = muscles.filter(function (m) { return volStatus(m, cur[m] || 0) === 'ok'; }).length;

    const card = el('div.card');
    card.appendChild(el('div.card-title', null, [
      el('h3', { text: 'Sets per muscle · this week' }),
      el('button.info-btn', { html: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'), 'aria-label': 'How targets work', onclick: explainTargets })
    ]));
    card.appendChild(el('div.vol-legend', null, [
      el('span', null, [el('span.vol-dot.low'), 'Below min']),
      el('span', null, [el('span.vol-dot.ok'), 'Growth zone']),
      el('span', null, [el('span.vol-dot.high'), 'High']),
      el('span.faint', { text: inRange + '/' + muscles.length + ' in zone', style: { marginLeft: 'auto' } })
    ]));
    muscles.forEach(function (m) {
      const n = cur[m] || 0, st = volStatus(m, n), T = App.muscleTarget(m);
      card.appendChild(el('div.vol-row', null, [
        el('div.rowsplit', null, [
          el('span.vol-name', null, [el('span.vol-dot.' + st), m]),
          el('span.tiny', null, [
            el('strong', { text: U.fmtNum(n) }),
            el('span.faint', { text: ' / ' + T.min + '–' + T.max + '  ·  last wk ' + U.fmtNum(prev[m] || 0) })
          ])
        ]),
        el('div.vol-track', null, [
          el('div.vol-zone', { style: { left: (T.min / scale * 100) + '%', width: ((T.max - T.min) / scale * 100) + '%' } }),
          el('div.vol-fill.' + st, { style: { width: Math.min(100, n / scale * 100) + '%' } })
        ])
      ]));
    });
    return card;
  }

  function explainTargets() {
    const li = function (b, t) { return el('li', null, [el('strong', { text: b + ' ' }), t]); };
    UI.sheet({
      title: 'How the targets work',
      body: el('div.explain', null, [
        el('ul', null, [
          li('Hard sets per week drive growth.', 'More weekly sets per muscle means more growth, with diminishing returns. Around 4 sets is the minimum; most growth comes by roughly 10–20 (Pelland et al. 2024; Schoenfeld et al. 2017).'),
          li('Targets differ per muscle.', 'Each muscle has its own zone (e.g. Back 10–20, Triceps 6–12, Glutes 4–12), based on Renaissance Periodization’s volume landmarks. Muscles that get plenty of work from compound lifts need fewer direct sets.'),
          li('Secondary muscles count half.', 'A bench press set counts 1 for chest and ½ for triceps; a squat counts ½ for glutes. This “fractional” counting predicted growth best in the 2024 meta-analysis.'),
          li('Above the zone isn’t bad.', 'Growth keeps coming but slower, and recovery becomes the limit. If performance drops, cut back.'),
          li('Reps: anything from ~6 to 30 works', 'if the set ends close to failure (Schoenfeld 2017/2021). Stop 1–3 reps short of failure — nearly the same growth with less fatigue (Refalo et al. 2023).'),
          li('Only warm-ups are excluded.', 'Every completed working set counts, so keep them hard.')
        ]),
        el('p.faint.tiny', { text: 'Targets are population averages — if a muscle keeps growing on less, or recovers fine on more, trust your results.' })
      ])
    });
  }

  // ---------- recent records ----------
  function prCard(prs) {
    const card = el('div.card', null, [el('div.card-title', null, [el('h3', { text: 'Recent records' })])]);
    prs.forEach(function (p) {
      card.appendChild(el('a.list-item', { href: '#/history/' + p.workoutId }, [
        UI.exerciseThumb(S.exercise(p.exerciseId), 36),
        el('div.grow', null, [
          el('div.name', { text: S.exerciseName(p.exerciseId) }),
          el('div.meta', { text: 'New ' + p.hits.join(' · ') })
        ]),
        el('span.faint.tiny', { text: U.relDay(p.t) })
      ]));
    });
    return card;
  }

  // ---------- all-time ----------
  function allTimeCard() {
    const ws = S.workouts();
    const vol = ws.reduce(function (n, w) { return n + S.workoutVolume(w); }, 0);
    const avg = ws.length ? ws.reduce(function (n, w) { return n + (w.durationSec || 0); }, 0) / ws.length : 0;
    return el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: 'All time' })]),
      el('div.mini-stats', { style: { marginTop: 0 } }, [
        el('div', null, [el('div.k', { text: 'Workouts' }), el('div.v', { text: String(ws.length) })]),
        el('div', null, [el('div.k', { text: 'Volume' }), el('div.v', { text: U.fmtCompact(App.fmtW(vol)) + ' ' + App.unit() })]),
        el('div', null, [el('div.k', { text: 'Avg length' }), el('div.v', { text: ws.length ? U.fmtDuration(avg) : '—' })]),
        el('div', null, [el('div.k', { text: 'Streak' }), el('div.v', { text: S.workoutStreakDays() + 'd' })])
      ])
    ]);
  }

  // ---------- body measurements ----------
  function measurementsSection() {
    const wrap = el('div');
    wrap.appendChild(el('div.card-title', { style: { margin: '18px 2px 8px' } }, [
      el('h3', { text: 'Body measurements' }),
      el('button.btn.sm.ghost', { html: svg(ICON.plus) + '<span>Log</span>', onclick: logMeasurement })
    ]));
    let any = false;
    MEASURE_TYPES.forEach(function (mt) {
      const series = S.measurements(mt.key);
      if (!series.length) return;
      any = true;
      const latest = series[series.length - 1];
      const val = function (x) { return mt.unit === 'weight' ? App.fmtW(x) : x; };
      const unitLabel = mt.unit === 'weight' ? App.unit() : mt.unit;
      const first = series[0];
      const change = val(latest.value) - val(first.value);
      wrap.appendChild(el('div.card', null, [
        el('div.card-title', null, [
          el('div', null, [
            el('div.faint.tiny', { text: mt.label }),
            el('div', { text: U.fmtNum(val(latest.value)) + ' ' + unitLabel, style: { fontSize: '20px', fontWeight: '800' } })
          ]),
          series.length > 1
            ? el('span.tiny.faint', { text: (change > 0 ? '+' : '') + U.fmtNum(Math.round(change * 10) / 10) + ' ' + unitLabel + ' since ' + U.fmtDate(first.date, { day: 'numeric', month: 'short' }) })
            : null
        ]),
        el('div', { html: App.charts.line(series.map(function (p) { return { t: p.date, v: val(p.value) }; }), 'v') }),
        el('button.tiny.faint', { text: 'Remove last entry', style: { marginTop: '6px', padding: '4px 0' }, onclick: function () {
          S.deleteMeasurement(latest.id);
        } })
      ]));
    });
    if (!any) {
      wrap.appendChild(el('div.card.center.muted.tiny', { text: 'Track bodyweight and tape measurements to see if the scale and your arms move the right way.' }));
    }
    return wrap;
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
})();
