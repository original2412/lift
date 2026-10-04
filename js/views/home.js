/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;
  const DAY = 86400000, WEEK = 7 * DAY;

  function routineSubtitle(r) {
    const names = r.items.map(function (it) { return S.exerciseName(it.exerciseId); });
    if (!names.length) return 'No exercises yet';
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? shown + ' +' + (names.length - 3) + ' more' : shown;
  }

  function lastDone(routineId) {
    return S.workouts().find(function (x) { return x.routineId === routineId; }) || null;
  }

  // ---------- weekly goal + streak ----------
  function weekCounts() {
    const m = {};
    S.workouts().forEach(function (w) { const k = U.weekStart(w.startedAt); m[k] = (m[k] || 0) + 1; });
    return m;
  }

  // Your setting, else what you've actually been doing (median of the last
  // 8 weeks that had any training), 2–6.
  App.weeklyGoal = function () {
    if (S.settings.weeklyGoal) return S.settings.weeklyGoal;
    const m = weekCounts();
    const cur = U.weekStart(Date.now());
    const xs = [];
    for (let k = 1; k <= 8; k++) { const n = m[cur - k * WEEK]; if (n) xs.push(n); }
    if (!xs.length) return 3;
    xs.sort(function (a, b) { return a - b; });
    return U.clamp(xs[Math.floor(xs.length / 2)], 2, 6);
  };

  // Weeks in a row you hit the goal. This week counts once it's hit; until
  // then the streak from earlier weeks is still alive.
  App.weekStreak = function () {
    const m = weekCounts(), goal = App.weeklyGoal();
    let wk = U.weekStart(Date.now());
    let n = 0;
    if ((m[wk] || 0) >= goal) n++;
    wk -= WEEK;
    while ((m[wk] || 0) >= goal) { n++; wk -= WEEK; }
    return n;
  };

  function pickGoal() {
    const values = [1, 2, 3, 4, 5, 6, 7];
    UI.wheelPicker({
      title: 'Weekly goal',
      values: values,
      value: App.weeklyGoal(),
      label: function (n) { return U.pluralize(n, 'workout') + ' a week'; },
      onDone: function (n) { App.db.setSettings({ weeklyGoal: n }); S.emit(); }
    });
  }

  function ring(done, goal) {
    const r = 26, c = 2 * Math.PI * r, f = Math.min(1, done / goal);
    return el('button.goal-ring', { 'aria-label': 'Weekly goal', onclick: pickGoal, html:
      '<svg viewBox="0 0 64 64"><circle class="trk" cx="32" cy="32" r="' + r + '"/>' +
      (f <= 0 ? '' : '<circle class="val' + (f >= 1 ? ' full' : '') + '" cx="32" cy="32" r="' + r + '" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 32 32)"/>') + '</svg>' +
      '<div class="num"><b>' + done + '</b><span>/' + goal + '</span></div>' });
  }

  function weekCard() {
    const ws = U.weekStart(Date.now());
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = {};
    S.workouts().forEach(function (w) {
      if (w.startedAt < ws) return;
      const d = new Date(w.startedAt); d.setHours(0, 0, 0, 0);
      days[d.getTime()] = true;
    });
    const done = S.workouts().filter(function (w) { return w.startedAt >= ws; }).length;
    const goal = App.weeklyGoal();
    const streak = App.weekStreak();
    const strip = el('div.week-strip');
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws); d.setDate(d.getDate() + i);
      const t = d.getTime();
      strip.appendChild(el('div.wd' + (days[t] ? '.on' : '') + (t === today.getTime() ? '.today' : '') + (t > today.getTime() ? '.future' : ''), null, [
        el('span.l', { text: d.toLocaleDateString(U.LOCALE, { weekday: 'narrow' }) }),
        el('span.d', { html: days[t] ? svg(ICON.check) : String(d.getDate()) })
      ]));
    }
    const left = goal - done;
    const msg = left > 0
      ? U.pluralize(left, 'workout') + ' to hit your goal' + (streak ? ' and keep the streak' : '')
      : done > goal ? 'Goal smashed — ' + (done - goal) + ' extra this week' : 'Weekly goal hit';
    return el('div.card.week-card', null, [
      el('div.week-top', null, [
        ring(done, goal),
        el('div.grow', null, [
          el('div.k', { text: 'This week' }),
          el('div.msg', { text: msg }),
          streak ? el('div.streak', { html: svg(ICON.flame) + '<span>' + U.pluralize(streak, 'week') + ' streak</span>' }) : null
        ])
      ]),
      strip
    ]);
  }

  // ---------- up next ----------
  // Routines are a rotation: next is the one after the routine you did most
  // recently (in your list's order).
  function nextRoutine() {
    const list = S.routines().filter(function (r) { return r.items.length; });
    if (!list.length) return null;
    const last = S.workouts().find(function (w) { return w.routineId && S.routine(w.routineId); });
    if (!last) return list[0];
    const i = list.findIndex(function (r) { return r.id === last.routineId; });
    return list[(i + 1) % list.length];
  }

  function avgMinutes(routineId) {
    const ws = S.workouts().filter(function (w) { return w.routineId === routineId && w.durationSec > 300; }).slice(0, 6);
    if (!ws.length) return 0;
    return Math.round(ws.reduce(function (n, w) { return n + w.durationSec; }, 0) / ws.length / 60);
  }

  // What the Coach has lined up: how many exercises go heavier / +reps.
  function planLine(r) {
    let up = 0, reps = 0, first = 0;
    r.items.forEach(function (it) {
      const ex = S.exercise(it.exerciseId);
      if (!ex || ex.tracking === 'cardio') return;
      const rr = it.repMin ? { min: it.repMin, max: it.repMax } : S.defaultRepRange(it.exerciseId);
      const p = S.progressionPlan(it.exerciseId, rr.min, rr.max);
      if (!p) { first++; return; }
      if (p.counts.weight) up++;
      else if (p.counts.reps) reps++;
    });
    if (App.coach.deloadActive()) return 'Deload week — lighter session lined up';
    const bits = [];
    if (up) bits.push(up + ' heavier');
    if (reps) bits.push(reps + ' with more reps');
    if (first) bits.push(first + ' new');
    return bits.length ? 'Targets ready: ' + bits.join(' · ') : '';
  }

  function heroCard() {
    const active = App.db.state.active;
    if (active) {
      const done = active.items.reduce(function (n, it) { return n + it.sets.filter(function (s) { return s.done; }).length; }, 0);
      const all = active.items.reduce(function (n, it) { return n + it.sets.length; }, 0);
      return el('div.hero', null, [
        el('div.hero-k', { text: 'In progress' }),
        el('div.hero-t', { text: active.name || 'Workout' }),
        el('div.hero-s', { text: done + ' of ' + all + ' sets · ' + U.fmtClock(App.workoutElapsed(active)) }),
        el('div.hero-bar', null, el('i', { style: { width: (all ? done / all * 100 : 0) + '%' } })),
        el('button.hero-btn', { html: svg(ICON.play) + '<span>Resume workout</span>', onclick: function () { R.go('/workout'); } })
      ]);
    }
    const r = nextRoutine();
    if (!r) {
      return el('div.hero', null, [
        el('div.hero-k', { text: 'Get started' }),
        el('div.hero-t', { text: 'Build your first routine' }),
        el('div.hero-s', { text: 'Or start an empty workout and add exercises as you go.' }),
        el('button.hero-btn', { html: svg(ICON.plus) + '<span>New routine</span>', onclick: function () { R.go('/routine/new'); } })
      ]);
    }
    const last = lastDone(r.id);
    const mins = avgMinutes(r.id);
    const meta = [U.pluralize(r.items.length, 'exercise')];
    if (mins) meta.push('~' + mins + ' min');
    if (last) meta.push('last ' + U.relDay(last.startedAt).replace(/^(Today|Yesterday)/, function (m) { return m.toLowerCase(); }));
    const plan = planLine(r);
    const thumbs = el('div.hero-thumbs', null, r.items.slice(0, 5).map(function (it) { return UI.exerciseThumb(S.exercise(it.exerciseId), 40); })
      .concat(r.items.length > 5 ? [el('span.more', { text: '+' + (r.items.length - 5) })] : []));
    return el('div.hero', null, [
      el('div.hero-k', { text: 'Up next' }),
      el('div.hero-t', { text: r.name }),
      el('div.hero-s', { text: meta.join(' · ') }),
      thumbs,
      plan ? el('div.hero-plan', { html: svg(ICON.target) + '<span>' + U.escape(plan) + '</span>' }) : null,
      el('button.hero-btn', { html: svg(ICON.play) + '<span>Start ' + U.escape(r.name) + '</span>', onclick: function () { App.workout.startFromRoutine(r.id); } })
    ]);
  }

  // ---------- routines ----------
  function routineCard(r) {
    const last = lastDone(r.id);
    return el('div.card.routine-card', null, [
      el('div.rowsplit', null, [
        el('button.grow.routine-main', { onclick: function () { App.workout.startFromRoutine(r.id); }, disabled: r.items.length === 0 }, [
          el('h3', { text: r.name }),
          el('div.muted.tiny', { text: routineSubtitle(r) }),
          last ? el('div.faint.tiny', { text: 'Last done ' + U.relDay(last.startedAt), style: { marginTop: '2px' } }) : null
        ]),
        el('button.play-btn', { html: svg(ICON.play), 'aria-label': 'Start ' + r.name, disabled: r.items.length === 0, onclick: function () { App.workout.startFromRoutine(r.id); } }),
        el('button.icon-btn', { html: svg(ICON.dots), 'aria-label': 'Routine options', onclick: function () { routineMenu(r); } })
      ])
    ]);
  }

  // Until backup is on: offer it (or a restore, on a phone with no history).
  function backupNudge() {
    const B = App.backup;
    if (!B.available() || B.isOn() || B.nudgeDismissed()) return null;
    const fresh = !S.workouts().length;
    const g = B.googleAvailable();
    const text = g
      ? (fresh ? 'Used Lift before? Sign in with Google to get your workouts back.' : 'Sign in with Google so your workouts are saved even if this phone isn’t.')
      : (fresh ? 'Restore your data with your backup code.' : 'Turn on encrypted cloud backup so nothing is lost if this phone is.');
    return el('div.card.tight.nudge', null, [
      el('div.grow', null, [
        el('strong', { text: fresh ? 'New phone?' : 'Protect your workouts' }),
        el('div.muted.tiny', { text: text })
      ]),
      el('button.btn.sm.primary', {
        text: g ? 'Sign in' : (fresh ? 'Restore' : 'Turn on'),
        onclick: g ? App.backup.signIn : (fresh ? App.backupUI.restore : App.backupUI.enable)
      }),
      el('button.icon-btn', { html: svg(ICON.x), 'aria-label': 'Dismiss', onclick: function () { B.dismissNudge(); App.store.emit(); } })
    ]);
  }

  function muscleCard() {
    const cur = S.weeklyMuscleSets(U.weekStart(Date.now()));
    // how far below its own minimum each muscle is, most-behind first
    const low = App.GROWTH_MUSCLES
      .map(function (m) { return [m, cur[m] || 0, App.muscleTarget(m).min]; })
      .filter(function (p) { return p[1] < p[2]; })
      .sort(function (a, b) { return (a[1] / a[2]) - (b[1] / b[2]); });
    const onTarget = App.GROWTH_MUSCLES.length - low.length;
    return el('a.card.tight', { href: '#/stats', style: { display: 'block' } }, [
      el('div.rowsplit', null, [
        el('strong', { text: 'Muscles this week', style: { fontSize: '14px' } }),
        el('span.faint.tiny', { text: onTarget + '/' + App.GROWTH_MUSCLES.length + ' in growth zone' })
      ]),
      low.length
        ? el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' } },
            low.map(function (p) {
              return el('span.pill', { text: p[0] + ' ' + U.fmtNum(p[1]) + '/' + p[2] });
            }))
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

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Late session?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late session?';
  }

  App.router.add('/', function (ctx) {
    let tick = 0;
    ctx.onLeave(function () { clearInterval(tick); });
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      const streak = S.workouts().length ? App.weekStreak() : 0;
      v.appendChild(el('div.home-head', null, [
        el('div.grow', null, [
          el('div.date', { text: new Date().toLocaleDateString(U.LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }) }),
          el('h1', { text: greeting() })
        ]),
        streak ? el('div.streak-chip', { html: svg(ICON.flame) + '<b>' + streak + '</b>', title: U.pluralize(streak, 'week') + ' streak' }) : null
      ]));

      v.appendChild(heroCard());
      // keep the in-progress timer moving
      clearInterval(tick);
      if (App.db.state.active) {
        tick = setInterval(function () {
          const s = v.querySelector('.hero-s');
          const a = App.db.state.active;
          if (!s || !a) return;
          s.textContent = s.textContent.replace(/[\d:]+$/, U.fmtClock(App.workoutElapsed(a)));
        }, 1000);
      }

      if (S.workouts().length) v.appendChild(weekCard());
      const deload = App.deloadCard(true);
      if (deload) v.appendChild(deload);
      const nudge = backupNudge();
      if (nudge) v.appendChild(nudge);
      v.appendChild(App.coachCard());
      if (S.workouts().length) v.appendChild(muscleCard());

      v.appendChild(el('div.rowsplit', { style: { margin: '20px 2px 10px' } }, [
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
      if (!App.db.state.active) {
        v.appendChild(el('button.btn.ghost', {
          html: svg(ICON.plus) + '<span>Start empty workout</span>',
          style: { marginTop: '4px' },
          onclick: function () { App.workout.startEmpty(); }
        }));
      }
    });
  }, { tab: 'home' });
})();
