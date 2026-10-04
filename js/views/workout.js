/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router, DB = App.db;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  const SET_TYPES = App.SET_TYPES;
  const SET_GLYPH = App.SET_GLYPH;
  const badgeClass = App.setBadgeClass;

  // ---------------- lifecycle helpers ----------------
  const persist = U.debounce(function () { DB.saveNow('active'); }, 300);

  function newActive(name, routineId) {
    return {
      id: U.uid(),
      name: name || defaultName(),
      routineId: routineId || null,
      startedAt: Date.now(),
      items: [],
      rest: null // { endsAt, duration }
    };
  }

  function defaultName() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
    return part + ' Workout';
  }

  function setsFromLast(exId) {
    const last = S.lastPerformance(exId);
    if (last && last.sets.length) {
      return last.sets.map(function (s) {
        return { type: s.type || 'normal', weight: s.weight, reps: s.reps, done: false };
      });
    }
    return [{ type: 'normal', weight: '', reps: '', done: false }];
  }

  function repRangeFor(exId, src) {
    if (src && src.repMin) return { min: src.repMin, max: src.repMax };
    return S.defaultRepRange(exId);
  }

  // Pre-fill not-yet-done sets from last session's matching set (see
  // S.progressionPlan). Done sets still count toward the position so a
  // re-apply mid-workout lines up. Extra sets beyond last time's count
  // repeat the last one.
  function applyTarget(item, exceptWorkoutId) {
    const plan = S.progressionPlan(item.exerciseId, item.repMin, item.repMax, exceptWorkoutId);
    if (!plan) { autoWarmups(item); return; }
    const pos = {};
    item.sets.forEach(function (s) {
      const g = S.setGroup(s.type);
      const i = pos[g] || 0;
      pos[g] = i + 1;
      const list = plan.byType[g];
      if (s.done || !list) return;
      const t = list[Math.min(i, list.length - 1)];
      s.weight = t.weight;
      s.reps = t.reps;
    });
    autoWarmups(item);
  }

  // Warm-ups ramp up to today's first working weight instead of repeating
  // last time's numbers: few reps, rising load, so they prime without
  // tiring (the working sets are what grow muscle).
  const RAMP = {
    1: [[0.6, 6]],
    2: [[0.5, 8], [0.75, 4]],
    3: [[0.45, 8], [0.65, 5], [0.85, 3]],
    4: [[0.4, 8], [0.55, 6], [0.7, 4], [0.85, 2]]
  };
  function warmupCount(kg) { return kg >= 60 ? 3 : kg >= 25 ? 2 : 1; }
  function autoWarmups(item) {
    const work = item.sets.filter(function (s) { return S.setGroup(s.type) === 'work' && Number(s.weight) > 0; })[0];
    if (!work) return false;
    const W = Number(work.weight);
    const warm = item.sets.filter(function (s) { return s.type === 'warmup'; });
    const ramp = RAMP[Math.min(warm.length, 4)];
    if (!ramp) return false;
    const step = W % 2.5 === 0 ? 2.5 : W % 2 === 0 ? 2 : 1;
    const ex = S.exercise(item.exerciseId);
    const floor = ex && ex.equipment === 'Barbell' ? 20 : step;
    warm.forEach(function (s, i) {
      if (s.done || !ramp[i]) return;
      s.weight = Math.min(W, Math.max(floor, Math.round(W * ramp[i][0] / step) * step));
      s.reps = ramp[i][1];
    });
    return true;
  }

  function newItem(exId, fields) {
    const rr = repRangeFor(exId, fields);
    const item = Object.assign({ exerciseId: exId, notes: '', restSec: S.settings.defaultRestSec }, fields, {
      repMin: rr.min, repMax: rr.max
    });
    applyTarget(item, null);
    if (App.coach.deloadActive()) halveForDeload(item);
    return item;
  }

  // Deload week: same weights (see coach.nextTarget), half the working sets,
  // no drop sets. Warm-ups stay.
  function halveForDeload(item) {
    const work = item.sets.filter(function (s) { return S.setGroup(s.type) === 'work'; }).length;
    const keep = Math.ceil(work / 2);
    let seen = 0;
    item.sets = item.sets.filter(function (s) {
      const g = S.setGroup(s.type);
      if (g === 'warmup') return true;
      if (g === 'drop') return false;
      return ++seen <= keep;
    });
  }

  function itemFromRoutine(rit) {
    return newItem(rit.exerciseId, {
      superset: rit.superset || undefined,
      notes: rit.notes || '',
      restSec: rit.restSec != null ? rit.restSec : S.settings.defaultRestSec,
      repMin: rit.repMin, repMax: rit.repMax,
      sets: (rit.sets && rit.sets.length ? rit.sets : [{ type: 'normal', weight: '', reps: '' }]).map(function (s) {
        return { type: s.type || 'normal', weight: s.weight === '' ? '' : s.weight, reps: s.reps === '' ? '' : s.reps, done: false };
      })
    });
  }

  // Seconds trained so far. A resumed workout counts its earlier part plus
  // the time since resuming — not the gap in between (e.g. driving to
  // another gym).
  function elapsedSec(a) {
    if (a.resumedAt) return (a.priorDurationSec || 0) + (Date.now() - a.resumedAt) / 1000;
    return (Date.now() - a.startedAt) / 1000;
  }
  App.workoutElapsed = elapsedSec;

  const RESUME_WINDOW_MS = 24 * 3600 * 1000;
  App.canResume = function (w) { return !!w && Date.now() - (w.endedAt || w.startedAt) < RESUME_WINDOW_MS; };

  // Reopen a finished workout: done sets stay done; if it came from a routine,
  // exercises and sets you didn't get to are added back. Finishing again
  // replaces the history entry (same id); cancelling leaves it untouched.
  function resumeFinished(w) {
    const a = {
      id: w.id,
      name: w.name,
      routineId: w.routineId || null,
      startedAt: w.startedAt,
      resumedAt: Date.now(),
      priorDurationSec: w.durationSec || 0,
      resumed: true,
      failChecksAssigned: true,
      rest: null,
      items: w.items.map(function (it) {
        return {
          exerciseId: it.exerciseId, notes: it.notes || '', restSec: it.restSec || 0,
          repMin: it.repMin, repMax: it.repMax, superset: it.superset || undefined,
          sets: it.sets.map(function (s) { return Object.assign({}, s, { done: true }); })
        };
      })
    };
    const routine = a.routineId ? S.routine(a.routineId) : null;
    if (routine) {
      routine.items.forEach(function (ri) {
        const it = a.items.filter(function (x) { return x.exerciseId === ri.exerciseId; })[0];
        if (!it) {
          a.items.push(itemFromRoutine(ri));
          return;
        }
        // add the routine's sets beyond what you completed, per set group
        const done = {};
        it.sets.forEach(function (s) { const g = S.setGroup(s.type); done[g] = (done[g] || 0) + 1; });
        const seen = {};
        ri.sets.forEach(function (rs) {
          const g = S.setGroup(rs.type || 'normal');
          seen[g] = (seen[g] || 0) + 1;
          if (seen[g] > (done[g] || 0)) it.sets.push({ type: rs.type || 'normal', weight: rs.weight, reps: rs.reps, done: false });
        });
        applyTarget(it, w.id);
      });
    }
    DB.setActive(a);
    R.go('/workout');
  }

  const Workout = {
    resumeFinished: function (w) {
      if (!App.canResume(w)) { UI.toast('Only workouts from the last 24 hours can be continued'); return; }
      guardExisting(function () { resumeFinished(w); });
    },
    startEmpty: function () {
      guardExisting(function () {
        DB.setActive(newActive());
        R.go('/workout');
      });
    },
    startFromRoutine: function (routineId) {
      const r = S.routine(routineId);
      if (!r) return;
      guardExisting(function () {
        const a = newActive(r.name, routineId);
        a.items = r.items.map(itemFromRoutine);
        DB.setActive(a);
        R.go('/workout');
      });
    }
  };

  function guardExisting(proceed) {
    if (!DB.state.active) return proceed();
    UI.confirm({
      title: 'Discard current workout?',
      message: 'You already have a workout in progress. Starting a new one will discard it.',
      confirmText: 'Discard & start', danger: true, cancelText: 'Keep current'
    }).then(function (ok) {
      if (ok) { endActive(); proceed(); }
    });
  }

  App.workout = Workout;

  // ---------------- the live screen ----------------
  App.router.add('/workout', function (ctx) {
    const a = DB.state.active;
    if (!a) { R.go('/', true); return; }

    // Once per workout: flag up to two exercises that are due a failure
    // check (safe ones only — machines, cables, isolation).
    if (!a.failChecksAssigned) {
      a.failChecksAssigned = true;
      a.items.filter(function (it) { return App.coach.failureCheckDue(it.exerciseId); })
        .slice(0, 2)
        .forEach(function (it) { it._failCheck = true; });
      DB.saveNow('active');
    }

    let wake = null;
    requestWake();
    function requestWake() {
      if (!S.settings.wakeLock) return;
      try {
        if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {});
      } catch (e) {}
    }

    const tick = setInterval(updateClocks, 500);
    document.addEventListener('visibilitychange', onVis);
    function onVis() { if (!document.hidden) { updateClocks(); requestWake(); } }

    // The rest dock lives outside #view so render() doesn't wipe it.
    const dock = el('div.rest-dock', { hidden: true });
    document.getElementById('app').appendChild(dock);
    let dockTime = null, dockProg = null;

    ctx.onLeave(function () {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
      try { if (wake) wake.release(); } catch (e) {}
      dock.remove();
      ctx.el.classList.remove('has-dock');
      DB.saveNow('active');
    });

    let clockEl;
    let restDone = false;

    render();
    renderRestBar();
    // the worker may have been restarted since the rest began
    scheduleRestAlert(a);

    function render() {
      const v = UI.clear(ctx.el);

      // header
      const header = el('div.wk-header');
      const nameInput = el('input.wk-title', {
        value: a.name, 'aria-label': 'Workout name',
        onchange: function (e) { a.name = e.target.value.trim() || defaultName(); persist(); }
      });
      clockEl = el('span.wk-timer', { text: '0:00' });
      header.appendChild(el('div.row', null, [
        el('button.icon-btn', { html: svg(ICON.chevronL), 'aria-label': 'Minimise', onclick: function () { R.go('/'); } }),
        nameInput,
        clockEl,
        el('button.btn.sm.good', { text: 'Finish', onclick: finish })
      ]));
      v.appendChild(header);

      // exercises
      if (!a.items.length) {
        v.appendChild(el('div.empty.tiny', { style: { padding: '30px 10px' }, html: 'No exercises yet.<br>Add your first one below.' }));
      }
      a.items.forEach(function (it, idx) { v.appendChild(exerciseCard(it, idx)); });

      v.appendChild(el('button.fab-add', {
        html: svg(ICON.plus) + '<span>Add exercise</span>',
        onclick: function () {
          App.exercisePicker({
            excludeIds: [],
            onDone: function (ids) {
              ids.forEach(function (exId) {
                a.items.push(newItem(exId, { sets: setsFromLast(exId) }));
              });
              persist();
              render();
            }
          });
        }
      }));

      v.appendChild(el('button.btn.danger.ghost', {
        text: 'Cancel workout', style: { marginTop: '16px' },
        onclick: function () {
          UI.confirm({ title: 'Cancel this workout?', message: 'Nothing will be saved to your history.', confirmText: 'Cancel workout', danger: true, cancelText: 'Keep going' })
            .then(function (ok) { if (ok) { endActive(); R.go('/', true); } });
        }
      }));

      updateClocks();
    }

    // ---- rest timer ----
    function startRest(sec) {
      if (!sec) return;
      UI.unlockAudio();
      restDone = false;
      a.rest = { endsAt: Date.now() + sec * 1000, duration: sec };
      persist();
      scheduleRestAlert(a);
      ensureAlertsEnabled(a);
      renderRestBar();
    }
    function stopRest() { a.rest = null; persist(); scheduleRestAlert(a); renderRestBar(); }
    function targetRow(item) {
      const plan = S.progressionPlan(item.exerciseId, item.repMin, item.repMax, a.id);
      const u = App.unit();
      const w = function (kg) { return U.fmtNum(App.fmtW(kg)); };
      let main, why;
      if (!plan) {
        main = 'First time — find your weight';
        why = 'Pick a weight you can do for ' + item.repMin + '–' + item.repMax + ' reps with 1–3 left in the tank';
      } else if (plan.counts.deload) {
        main = 'Deload: same weight, half the sets';
        why = 'Recovery week — stop every set with 3–4 reps left';
      } else {
        const work = plan.byType.work;
        const shown = work.slice(0, 4).map(function (t) { return w(t.weight) + '×' + t.reps; });
        main = 'Target ' + u + ': ' + shown.join(' · ') + (work.length > 4 ? ' …' : '');
        const c = plan.counts;
        const easy = work.some(function (t) { return t.kind === 'weight' && t.prevEffort === 'easy'; });
        const parts = [];
        if (c.weight) parts.push(easy ? 'heavier — it felt easy' : 'heavier where you hit ' + item.repMax);
        if (c.down) parts.push('lighter where you fell below ' + item.repMin);
        if (c.reps) parts.push(c.weight || c.down ? '+1 rep on the rest' : 'one more rep than last time');
        why = parts.join('; ');
        why = why.charAt(0).toUpperCase() + why.slice(1);
      }
      return el('button.target-row', { onclick: function () { editRange(item); }, 'aria-label': 'Change rep range' }, [
        el('span.target-ic', { html: svg(ICON.target) }),
        el('div.grow', null, [el('div.t', { text: main }), el('div.w', { text: why })]),
        el('span.target-range', { text: item.repMin + '–' + item.repMax })
      ]);
    }
    function editRange(item) {
      UI.repRangePicker({
        title: 'Rep range · ' + S.exerciseName(item.exerciseId),
        min: item.repMin, max: item.repMax,
        onDone: function (lo, hi) {
          item.repMin = lo; item.repMax = hi;
          applyTarget(item, a.id);
          persist(); render();
        }
      });
    }
    function pickRest(item) {
      UI.durationPicker({
        title: 'Rest · ' + S.exerciseName(item.exerciseId),
        value: item.restSec || 0,
        onDone: function (sec) {
          item.restSec = sec;
          persist(); render();
          // Singer 2024: <60s costs reps on later sets; past ~90s no difference
          if (sec > 0 && sec < 60) UI.toast('Under 60s rest costs reps on later sets — 90s+ is better for growth', 3500);
        }
      });
    }
    function bumpRest(delta) {
      if (!a.rest) return;
      a.rest.endsAt = Math.max(Date.now(), a.rest.endsAt + delta * 1000);
      a.rest.duration = Math.max(a.rest.duration, (a.rest.endsAt - Date.now()) / 1000);
      a.rest.quiet = false;
      persist();
      scheduleRestAlert(a);
      updateClocks();
    }
    function renderRestBar() {
      const on = !!a.rest;
      dock.hidden = !on;
      ctx.el.classList.toggle('has-dock', on);
      if (!on) return;
      if (!dockTime) {
        dockProg = el('div.prog');
        dockTime = el('div.time', { text: '0:00' });
        dock.appendChild(dockProg);
        dock.appendChild(el('div.row', null, [
          el('div', { style: { flex: '1' } }, [el('div.lbl', { text: 'Rest' }), dockTime]),
          el('button', { text: '−15', 'aria-label': 'Subtract 15 seconds', onclick: function () { bumpRest(-15); } }),
          el('button', { text: '+15', 'aria-label': 'Add 15 seconds', onclick: function () { bumpRest(15); } }),
          el('button.skip', { text: 'Skip', onclick: stopRest })
        ]));
      }
      updateClocks();
    }

    function updateClocks() {
      if (clockEl) clockEl.textContent = U.fmtClock(elapsedSec(a));
      if (!a.rest || !dockTime) return;
      const remain = (a.rest.endsAt - Date.now()) / 1000;
      if (remain > 0) {
        dockTime.textContent = U.fmtClock(Math.ceil(remain));
        dockProg.style.width = Math.min(100, remain / a.rest.duration * 100) + '%';
        quietIfWatching(a, remain);
        return;
      }
      if (restDone) return;
      restDone = true;
      // Only alert if we're on time — returning to the app long after the
      // rest ended shouldn't suddenly beep.
      if (remain > -3) {
        UI.chime();
        UI.buzz([200, 100, 200]);
      }
      a.rest = null;
      persist();
      renderRestBar();
    }

    // In a superset, after a set on one exercise go to the next one in the
    // group that is behind on this round; null = the round is done (rest).
    function supersetNext(it) {
      if (!it.superset) return null;
      const m = App.ss.members(a.items, it);
      const doneN = function (x) { return x.sets.filter(function (s) { return s.done; }).length; };
      const mine = doneN(it);
      for (let k = m.indexOf(it) + 1; k < m.length; k++) {
        if (doneN(m[k]) < mine && m[k].sets.some(function (s) { return !s.done; })) return m[k];
      }
      return null;
    }
    function focusCard(item) {
      const c = ctx.el.querySelector('.ex-card[data-i="' + a.items.indexOf(item) + '"]');
      if (!c) return;
      c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
    }
    function addWarmups(item) {
      const work = item.sets.filter(function (s) { return S.setGroup(s.type) === 'work' && Number(s.weight) > 0; })[0];
      if (!work) { UI.toast('Enter your working weight first'); return; }
      const n = warmupCount(Number(work.weight));
      const at = Math.max(0, item.sets.findIndex(function (s) { return !s.done; }));
      for (let k = 0; k < n; k++) item.sets.splice(at, 0, { type: 'warmup', weight: '', reps: '', done: false });
      autoWarmups(item);
      persist(); render();
      UI.toast(U.pluralize(n, 'warm-up set') + ' added, ramping to ' + U.fmtNum(App.fmtW(work.weight)) + ' ' + App.unit());
    }

    // ---- exercise card ----
    function exerciseCard(it, idx) {
      const ex = S.exercise(it.exerciseId);
      const card = App.ss.decorate(el('div.ex-card', { 'data-i': idx }), a.items, it);
      const last = S.lastPerformance(it.exerciseId, a.id);
      if (it.sets.length && it.sets.every(function (s) { return s.done; })) card.classList.add('complete');

      card.appendChild(el('div.ex-head', null, [
        el('a', { href: ex ? '#/exercise/' + ex.id : '#/workout' }, UI.exerciseThumb(ex, 38)),
        el('div.ex-name-wrap', null, [
          App.ss.badge(a.items, it),
          el('a.ex-name', { text: ex ? ex.name : 'Removed exercise', href: ex ? '#/exercise/' + ex.id : '#/workout' })
        ]),
        el('button.rest-link', {
          html: svg(ICON.timer, ' style="width:13px;height:13px;vertical-align:-2px"') + ' ' + (it.restSec ? U.fmtClock(it.restSec) : 'Off'),
          'aria-label': 'Change rest timer',
          onclick: function () { pickRest(it); }
        }),
        el('button.icon-btn', { html: svg(ICON.dots), 'aria-label': 'Options', onclick: function () { itemMenu(it, idx); } })
      ]));

      if (it.notes || it._showNote) {
        card.appendChild(el('input.ex-note', {
          value: it.notes || '', placeholder: 'Note…',
          oninput: function (e) { it.notes = e.target.value; persist(); }
        }));
      }

      if (!(ex && ex.tracking === 'cardio')) {
        if (!it.repMin) {
          // workouts started before rep ranges existed
          const rr = repRangeFor(it.exerciseId);
          it.repMin = rr.min; it.repMax = rr.max;
        }
        card.appendChild(targetRow(it));
        if (!App.coach.deloadActive()) {
          const tr = App.coach.trend(it.exerciseId);
          if (tr.status === 'stalled') {
            card.appendChild(el('button.stall-row', { onclick: function () { stallSheet(it); } }, [
              el('span', { text: '⚠' }),
              el('span.grow', { text: 'No progress for ' + tr.stalledFor + ' sessions — see options' }),
              el('span', { html: svg(ICON.chevronR, ' style="width:16px;height:16px"') })
            ]));
          }
        }
        if (it._failCheck === true) {
          card.appendChild(el('div.fail-check', null, [
            el('strong', { text: 'Failure check · ' }),
            'On your last set, keep going until you can’t do another clean rep. It shows how hard your “Good” sets really are.'
          ]));
        }
      }

      const table = el('table.set-grid');
      table.appendChild(el('thead', null, el('tr', null, [
        el('th.set-col', { text: 'Set' }),
        el('th.prev-col', { text: 'Prev' }),
        el('th', { text: App.unit() }),
        el('th', { text: 'Reps' }),
        el('th.done-col', { html: svg(ICON.check, ' style="width:15px;height:15px"') })
      ])));
      const tb = el('tbody');
      table.appendChild(tb);
      card.appendChild(table);
      renderSetRows();

      const hasWarm = it.sets.some(function (s) { return s.type === 'warmup'; });
      card.appendChild(el('div.add-row', null, [
        el('button.add-set-btn', {
          html: svg(ICON.plus, ' style="width:14px;height:14px;vertical-align:-2px"') + ' Add set',
          onclick: function () {
            const p = it.sets[it.sets.length - 1];
            it.sets.push({ type: 'normal', weight: p ? p.weight : '', reps: p ? p.reps : '', done: false });
            persist();
            renderSetRows();
            card.classList.remove('complete');
          }
        }),
        !hasWarm && !(ex && ex.tracking === 'cardio') ? el('button.add-set-btn.warm', {
          html: svg(ICON.flame2, ' style="width:14px;height:14px;vertical-align:-2px"') + ' Warm-up',
          onclick: function () { addWarmups(it); }
        }) : null
      ]));

      return card;

      function renderSetRows() {
        UI.clear(tb);
        it.sets.forEach(function (st, si) { UI.append(tb, setRow(st, si)); });
      }

      function lastWorkingIdx() {
        for (let i = it.sets.length - 1; i >= 0; i--) if (S.setGroup(it.sets[i].type) === 'work') return i;
        return -1;
      }

      function defaultEffort(si) {
        if (App.coach.deloadActive()) return 'easy';
        if (it._failCheck === true && si === lastWorkingIdx()) return 'fail';
        return 'good';
      }

      // "How hard was it?" — shown under the most recently completed working set
      function effortRow(st) {
        return el('tr.effort-tr', null, el('td', { colspan: 5 }, el('div.effort', null,
          [el('span.effort-q', { text: 'How hard?' })].concat(App.coach.EFFORTS.map(function (e) {
            return el('button.effort-btn' + (st.effort === e.key ? '.on' : '') + '.' + e.key, {
              onclick: function () { st.effort = e.key; persist(); renderSetRows(); }
            }, [el('span', { text: e.label }), el('small', { text: e.sub })]);
          }))
        )));
      }

      // Last session's set matching set `si`: same type group (working /
      // warm-up / drop), same position within it — the same matching
      // applyTarget uses, so PREV lines up even if you add a warm-up.
      function prevFor(si) {
        if (!last) return null;
        const g = S.setGroup(it.sets[si].type);
        let pos = 0;
        for (let i = 0; i < si; i++) if (S.setGroup(it.sets[i].type) === g) pos++;
        const same = last.sets.filter(function (s) { return S.setGroup(s.type) === g; });
        return same[pos] || null;
      }

      function prevText(si) {
        const p = prevFor(si);
        if (!p) return '—';
        return U.fmtNum(App.fmtW(p.weight)) + '×' + U.fmtNum(p.reps);
      }

      function setRow(st, si) {
        const tr = el('tr' + (st.done ? '.done' : ''));
        const label = SET_GLYPH[st.type] || String(workingNum(it, si));
        const badge = el('div.set-badge ' + badgeClass(st.type), { text: label });
        tr.appendChild(el('td.set-col', null, el('button', { style: { width: '100%' }, 'aria-label': 'Set type', onclick: function () {
          st.type = SET_TYPES[(SET_TYPES.indexOf(st.type) + 1) % SET_TYPES.length];
          persist(); renderSetRows();
        } }, badge)));

        tr.appendChild(el('td.prev-col', null, el('span.prev-cell', {
          text: prevText(si),
          onclick: function () {
            // tap PREV to copy last time's numbers into this set
            const p = prevFor(si);
            if (!p || st.done) return;
            st.weight = p.weight;
            st.reps = p.reps;
            persist(); renderSetRows();
          }
        })));

        const prev = prevFor(si);
        tr.appendChild(el('td', null, numInput(st, 'weight', true, prev && prev.weight)));
        tr.appendChild(el('td', null, numInput(st, 'reps', false, prev && prev.reps)));

        tr.appendChild(el('td.done-col', null, el('button.check', {
          html: svg(ICON.check), 'aria-label': 'Complete set',
          onclick: function () { toggleDone(st, si); }
        })));

        const rows = [tr];
        if (st.done && st._pr) {
          rows.push(el('tr', null, el('td', { colspan: 5, style: { paddingTop: '0' } },
            el('span.pr-tag', { html: svg(ICON.trophy, ' style="width:12px;height:12px" fill="currentColor" stroke="none"') + ' ' + st._pr }))));
        }
        if (st.done && si === it._effortIdx && S.setGroup(st.type) === 'work') rows.push(effortRow(st));
        return rows;
      }

      // prevVal: last session's value, shown greyed when the field is empty
      function numInput(st, key, isW, prevVal) {
        const shown = st[key] === '' || st[key] == null ? '' : (isW ? U.fmtNum(App.fmtW(st[key])) : String(st[key]));
        const hasPrev = prevVal !== '' && prevVal != null;
        const ph = hasPrev ? (isW ? U.fmtNum(App.fmtW(prevVal)) : String(prevVal)) : (isW ? App.unit() : '—');
        return el('input.set-input', {
          type: 'text', inputmode: 'decimal', value: shown, placeholder: ph,
          onfocus: function (e) { e.target.select(); },
          onblur: function (e) {
            const raw = e.target.value.trim().replace(',', '.');
            if (raw === '') { st[key] = ''; persist(); return; }
            const num = parseFloat(raw);
            if (isNaN(num) || num < 0) { e.target.value = shown; return; }
            st[key] = isW ? U.fromDisplayWeight(num, App.unit()) : Math.round(num);
            e.target.value = isW ? U.fmtNum(App.fmtW(st[key])) : String(st[key]);
            persist();
          }
        });
      }

      function toggleDone(st, si) {
        st.done = !st.done;
        st._pr = null;
        if (st.done) {
          UI.buzz(12);
          // ticking an empty set logs last time's numbers (the greyed placeholders)
          const p = prevFor(si);
          if ((st.weight === '' || st.weight == null) && p) st.weight = p.weight;
          if ((st.reps === '' || st.reps == null) && p) st.reps = p.reps;
          if (st.type !== 'warmup') {
            const pr = checkPR(it.exerciseId, st);
            if (pr) { st._pr = pr; UI.buzz([40, 40, 90]); }
          }
          if (S.setGroup(st.type) === 'work') {
            if (!st.effort) st.effort = defaultEffort(si);
            it._effortIdx = si;
            if (it._failCheck === true && si === lastWorkingIdx()) finishFailureCheck(si);
          }
          const next = supersetNext(it);
          if (next) {
            // superset: straight to the partner exercise, rest after the round
            if (a.rest) stopRest();
            UI.toast('Next: ' + S.exerciseName(next.exerciseId));
            setTimeout(function () { focusCard(next); }, 60);
          } else if (it.restSec) {
            // warm-ups only need a short breather
            startRest(st.type === 'warmup' ? Math.min(it.restSec, 60) : it.restSec);
          }
        } else if (it._effortIdx === si) {
          it._effortIdx = null;
        }
        persist();
        renderSetRows();
        card.classList.toggle('complete', it.sets.every(function (s) { return s.done; }));
      }

      function finishFailureCheck(si) {
        it._failCheck = 'done';
        const res = App.coach.calibrate(it.sets, si);
        if (!res) { render(); return; }
        App.coach.recordCalibration(it.exerciseId, res);
        const word = res.said === 'easy' ? 'Easy' : 'Good';
        const msg = res.gap >= 2
          ? 'You got ' + res.failReps + ' reps to failure — ' + res.gap + ' more than your “' + word + '” set suggested. Your normal sets are probably further from failure than they feel: push 1–2 reps harder.'
          : res.gap <= -2
            ? 'You got ' + res.failReps + ' reps to failure — fewer than expected. Your sets are already hard; “Good” may really be 0–1 in the tank. Keep it there.'
            : 'You got ' + res.failReps + ' reps to failure — right about what your “' + word + '” set predicted. Your effort estimates are accurate.';
        let r;
        r = UI.sheet({
          title: 'Failure check · ' + S.exerciseName(it.exerciseId),
          body: el('p', { text: msg, style: { margin: '2px 2px 4px', lineHeight: '1.5' } }),
          footer: el('button.btn.primary', { text: 'Got it', onclick: function () { r.close(); } }),
          onClose: render
        });
      }

      function stallSheet(item) {
        const ex2 = S.exercise(item.exerciseId);
        const T = App.muscleTarget(ex2.primary);
        const wk = U.weekStart(Date.now()) - 7 * 86400000;
        const lastWeek = S.weeklyMuscleSets(wk)[ex2.primary] || 0;
        const altRange = item.repMax <= 10 ? [10, 15] : [6, 10];
        const alts = App.coach.alternatives(item.exerciseId, a.items.map(function (x) { return x.exerciseId; }), 3);
        const fat = App.coach.fatigue();
        let ref;
        const act = function (fn) { return function () { fn(); persist(); ref.close(); render(); }; };
        const step = function (n, title, text, buttons) {
          return el('div.stall-step', null, [
            el('div.stall-n', { text: String(n) }),
            el('div.grow', null, [el('strong', { text: title }), el('div.muted.tiny', { text: text }), buttons ? el('div.stall-actions', null, buttons) : null])
          ]);
        };
        const under = lastWeek < T.min;
        ref = UI.sheet({
          title: 'Stalled · ' + ex2.name,
          body: el('div', null, [
            el('p.muted.tiny', { text: 'Your best estimated 1RM hasn’t gone up in 3+ sessions. Try these in order — the end-of-workout “Update routine?” question lets you keep a change.', style: { margin: '0 2px 10px' } }),
            fat.suggest ? el('div.fail-check', { text: 'You also show signs of fatigue — a deload week may fix this by itself (see Home).' }) : null,
            step(1, 'Check volume', ex2.primary + ': ' + U.fmtNum(lastWeek) + ' sets last week (zone ' + T.min + '–' + T.max + '). ' +
              (under ? 'Below the minimum — add a set.' : 'In range — volume isn’t the problem.'),
              under ? [el('button.btn.sm', { text: 'Add a set here', onclick: act(function () {
                const p = item.sets.filter(function (s) { return S.setGroup(s.type) === 'work'; }).pop() || {};
                item.sets.push({ type: 'normal', weight: p.weight || '', reps: p.reps || '', done: false });
              }) })] : null),
            step(2, 'Change the rep range', 'A new range is a new stimulus — loads and reps both grow muscle when sets are hard.',
              [el('button.btn.sm', { text: 'Switch to ' + altRange[0] + '–' + altRange[1] + ' reps', onclick: act(function () {
                item.repMin = altRange[0]; item.repMax = altRange[1]; applyTarget(item, a.id);
              }) })]),
            step(3, 'Swap the exercise', 'Same muscle, different angle. ↗ = trains the muscle stretched, which tends to grow it more.',
              alts.map(function (x) {
                return el('button.btn.sm', { text: (x.lengthened ? '↗ ' : '') + x.name, onclick: act(function () {
                  item.exerciseId = x.id;
                  const rr = S.defaultRepRange(x.id);
                  item.repMin = rr.min; item.repMax = rr.max;
                  item.sets.forEach(function (s) { if (!s.done) { s.weight = ''; s.reps = ''; } });
                  applyTarget(item, a.id);
                }) });
              }))
          ])
        });
      }

      function itemMenu(item, i) {
        UI.menu(S.exerciseName(item.exerciseId), [
          { label: item.notes || item._showNote ? 'Hide note' : 'Add note', icon: ICON.note, onClick: function () {
            item._showNote = !(item.notes || item._showNote); if (!item._showNote) {} render();
          } },
          { label: 'Rest timer: ' + (item.restSec ? U.fmtClock(item.restSec) : 'off'), icon: ICON.timer, onClick: function () { pickRest(item); } },
          i > 0 ? { label: 'Move up', icon: ICON.chevronL, onClick: function () { move(i, i - 1); } } : null,
          i < a.items.length - 1 ? { label: 'Move down', icon: ICON.chevronR, onClick: function () { move(i, i + 1); } } : null
        ].concat(App.ss.menuItems(a.items, item, function () { persist(); render(); }), [
          item.sets.some(function (s) { return s.type === 'warmup'; }) ? null
            : { label: 'Add warm-up sets', icon: ICON.flame2, onClick: function () { addWarmups(item); } },
          { label: 'Replace exercise', icon: ICON.swap, onClick: function () {
            App.exercisePicker({ onDone: function (ids) { if (ids[0]) { item.exerciseId = ids[0]; persist(); render(); } } });
          } },
          { label: 'Remove exercise', icon: ICON.trash, danger: true, onClick: function () {
            a.items.splice(i, 1); App.ss.tidy(a.items); persist(); render();
          } }
        ]));
      }
      function move(x, y) { const t = a.items[x]; a.items[x] = a.items[y]; a.items[y] = t; App.ss.tidy(a.items); persist(); render(); }
    }

    // ---- finish ----
    function finish() {
      const doneSets = a.items.reduce(function (n, it) { return n + it.sets.filter(function (s) { return s.done; }).length; }, 0);
      if (doneSets === 0) {
        UI.confirm({ title: 'Finish with no sets?', message: 'No sets are marked complete, so nothing meaningful will be saved.', confirmText: 'Discard workout', danger: true, cancelText: 'Keep going' })
          .then(function (ok) { if (ok) { endActive(); R.go('/', true); } });
        return;
      }

      // Like HEVY: if you changed the structure of a routine's workout, ask
      // whether the routine should take the changes.
      const routine = a.routineId ? S.routine(a.routineId) : null;
      const changes = routine ? routineDiff(routine, a.items) : [];
      if (!changes.length) { saveWorkout(); return; }

      let chosen = false;
      const ref = UI.sheet({
        title: 'Update “' + routine.name + '”?',
        body: el('div', null, [
          el('p.muted', { text: 'You changed this workout compared to the routine:', style: { margin: '0 2px 8px' } }),
          el('ul.change-list', null, changes.slice(0, 12).map(function (c) { return el('li', { text: c }); })),
          changes.length > 12 ? el('div.faint.tiny', { text: '+' + (changes.length - 12) + ' more' }) : null,
          el('p.faint.tiny', { text: 'Either way, this workout is saved to your history.', style: { margin: '10px 2px 0' } })
        ]),
        footer: el('div', null, [
          el('button.btn.primary', { text: 'Update routine', onclick: function () {
            chosen = true;
            const copy = U.deepClone(routine);
            copy.items = routineItemsFrom(a.items, routine);
            S.saveRoutine(copy);
            ref.close();
            saveWorkout();
          } }),
          el('button.btn.ghost', { text: 'Keep original routine', style: { marginTop: '8px' }, onclick: function () {
            chosen = true;
            ref.close();
            saveWorkout();
          } })
        ]),
        // closing with ✕ / backdrop means "not yet" — stay in the workout
        onClose: function () { if (!chosen) UI.toast('Still in your workout'); }
      });
    }

    function saveWorkout() {
      const endedAt = Date.now();
      const record = {
        id: a.id,
        name: a.name,
        routineId: a.routineId,
        startedAt: a.startedAt,
        endedAt: endedAt,
        durationSec: Math.round(elapsedSec(a)),
        notes: '',
        deload: App.coach.deloadActive() || undefined,
        items: a.items
          .map(function (it) {
            return {
              exerciseId: it.exerciseId,
              notes: it.notes || '',
              restSec: it.restSec || 0,
              repMin: it.repMin, repMax: it.repMax,
              superset: it.superset || undefined,
              sets: it.sets
                .filter(function (s) { return s.done; })
                .map(function (s) {
                  const out = { type: s.type, weight: Number(s.weight) || 0, reps: Number(s.reps) || 0, done: true };
                  if (s.effort) out.effort = s.effort;
                  return out;
                })
            };
          })
          .filter(function (it) { return it.sets.length; })
      };

      // PRs vs committed history (a.id not yet committed)
      const prs = [];
      record.items.forEach(function (it) {
        const b = S.exerciseBests(it.exerciseId, a.id);
        let top1 = 0, topW = 0, vol = 0;
        it.sets.forEach(function (s) {
          if (s.type === 'warmup') return;
          top1 = Math.max(top1, U.epley1RM(s.weight, s.reps));
          topW = Math.max(topW, s.weight);
          vol += s.weight * s.reps;
        });
        const hits = [];
        if (top1 > b.e1rm + 0.01) hits.push('1RM ' + U.fmtNum(App.fmtW(top1)) + App.unit());
        if (topW > b.weight + 0.01) hits.push('weight ' + U.fmtNum(App.fmtW(topW)) + App.unit());
        if (vol > b.volume + 0.01 && b.volume > 0) hits.push('volume');
        if (hits.length) prs.push({ exerciseId: it.exerciseId, hits: hits });
      });
      record.prs = prs;

      // a resumed workout replaces its earlier entry instead of duplicating it
      if (a.resumed) S.deleteWorkout(a.id);
      S.commitWorkout(record);
      endActive();
      R.go('/summary/' + record.id, true);
    }
  }, { tab: 'home', fullscreen: true });

  // ---------------- summary ----------------
  App.router.add('/summary/:id', function (ctx) {
    const w = S.workout(ctx.params.id);
    const v = UI.clear(ctx.el);
    if (!w) { R.go('/', true); return; }

    const nth = S.workouts().filter(function (x) { return x.startedAt <= w.startedAt; }).length;
    const prCount = (w.prs || []).length;
    v.appendChild(el('div.summary-hero', null, [
      el('div.badge-ring', { html: svg(prCount ? ICON.trophy : ICON.check) }),
      el('div.kicker', { text: 'Workout #' + nth + (prCount ? ' · ' + U.pluralize(prCount, 'record') : '') }),
      el('div.big', { text: w.name }),
      el('div.muted.tiny', { text: U.fmtDate(w.startedAt, { weekday: 'long', month: 'short', day: 'numeric' }) + ' · ' + U.fmtTime(w.startedAt) })
    ]));
    // celebrate only right after finishing, not when revisiting
    if (Date.now() - (w.endedAt || 0) < 60000 && !ctx.params._seen) confetti(prCount ? 160 : 80);

    v.appendChild(el('div.stat-grid', { style: { marginTop: '10px' } }, [
      box(U.fmtDuration(w.durationSec), 'Duration'),
      box(compact(App.fmtW(S.workoutVolume(w))) + ' ' + App.unit(), 'Volume'),
      box(String(S.workoutSetCount(w)), 'Sets')
    ]));

    // weekly goal progress
    if (App.weeklyGoal) {
      const ws = U.weekStart(w.startedAt);
      const n = S.workouts().filter(function (x) { return x.startedAt >= ws && x.startedAt < ws + 7 * 86400000; }).length;
      const goal = App.weeklyGoal();
      const streak = App.weekStreak();
      const txt = n >= goal
        ? (n === goal ? 'Weekly goal hit — ' : n + ' this week, goal smashed — ') + (streak > 1 ? U.pluralize(streak, 'week') + ' streak!' : 'streak started!')
        : n + ' of ' + goal + ' this week — ' + U.pluralize(goal - n, 'more workout') + ' to hit your goal';
      v.appendChild(el('div.card.tight.goal-note', { style: { marginTop: '12px' } }, [
        el('span', { html: svg(ICON.flame) }),
        el('div.tiny', { text: txt, style: { fontWeight: '650', fontSize: '13.5px' } })
      ]));
    }

    if (w.prs && w.prs.length) {
      v.appendChild(el('div.section-label', { text: w.prs.length + ' new record' + (w.prs.length > 1 ? 's' : '') }));
      w.prs.forEach(function (p) {
        v.appendChild(el('div.card.tight', null, [
          el('div.rowsplit', null, [
            el('strong', { text: S.exerciseName(p.exerciseId), style: { fontSize: '14px' } }),
            el('span.pr-tag', { html: svg(ICON.trophy, ' style="width:13px;height:13px" fill="currentColor" stroke="none"') })
          ]),
          el('div.tiny.muted', { text: 'New ' + p.hits.join(' · '), style: { marginTop: '3px' } })
        ]));
      });
    }

    v.appendChild(el('div.section-label', { text: 'Exercises' }));
    w.items.forEach(function (it) {
      v.appendChild(el('div.card.tight', null, [
        el('strong', { text: S.exerciseName(it.exerciseId), style: { fontSize: '14px' } }),
        el('div.tiny.muted', { style: { marginTop: '4px' }, text: it.sets.map(function (s) {
          return (s.type === 'warmup' ? 'W ' : '') + U.fmtNum(App.fmtW(s.weight)) + '×' + U.fmtNum(s.reps);
        }).join('   ') })
      ]));
    });

    v.appendChild(el('button.btn.primary', { text: 'Done', style: { marginTop: '18px' }, onclick: function () { R.go('/', true); } }));
    v.appendChild(el('button.btn.ghost', { text: 'View in history', style: { marginTop: '10px' }, onclick: function () { R.go('/history/' + w.id, true); } }));
    v.appendChild(el('button.btn.ghost', {
      html: svg(ICON.play) + '<span>Not done? Continue this workout</span>', style: { marginTop: '10px' },
      onclick: function () { App.workout.resumeFinished(w); }
    }));
  }, { tab: 'home', fullscreen: true });

  // ---------------- helpers ----------------
  // A short burst of confetti (canvas, ~2.5s, removes itself).
  function confetti(n) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas');
    c.className = 'confetti';
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    document.body.appendChild(c);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const colors = ['#4f8dff', '#8b5cf6', '#a855f7', '#22c55e', '#fbbf24', '#ff8a3d', '#f472b6'];
    const ps = [];
    for (let i = 0; i < n; i++) {
      ps.push({
        x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.32,
        vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 13 - 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[i % colors.length]
      });
    }
    const t0 = performance.now();
    (function frame(t) {
      const age = t - t0;
      g.clearRect(0, 0, innerWidth, innerHeight);
      g.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1600) / 900);
      ps.forEach(function (p) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      });
      if (age < 2500) requestAnimationFrame(frame); else c.remove();
    })(t0);
    UI.buzz([30, 40, 30]);
  }

  function workingNum(it, si) {
    let n = 0;
    for (let i = 0; i <= si; i++) if (it.sets[i].type !== 'warmup') n++;
    return n || 1;
  }
  function box(v, k) { return el('div.stat-box', null, [el('div.v', { text: v }), el('div.k', { text: k })]); }
  function compact(n) { n = Math.round(n); return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

  // Compare against committed history plus every other completed set of this
  // exercise in the live workout. Computed fresh each time so re-renders can't
  // reset it.
  function checkPR(exId, st) {
    const w = Number(st.weight) || 0, r = Number(st.reps) || 0;
    if (!w || !r) return null;
    const a = DB.state.active;
    const b = S.exerciseBests(exId, a.id);
    let e1Best = b.e1rm, wBest = b.weight;
    a.items.forEach(function (it) {
      if (it.exerciseId !== exId) return;
      it.sets.forEach(function (s) {
        if (s === st || !s.done || s.type === 'warmup') return;
        const sw = Number(s.weight) || 0;
        e1Best = Math.max(e1Best, U.epley1RM(sw, Number(s.reps) || 0));
        wBest = Math.max(wBest, sw);
      });
    });
    if (U.epley1RM(w, r) > e1Best + 0.01) return 'Est. 1RM PR';
    if (w > wBest + 0.01) return 'Weight PR';
    return null;
  }

  // ---- background rest alert (handled by the service worker, see sw.js) ----
  function postToWorker(msg) {
    if (!('serviceWorker' in navigator) || location.protocol.indexOf('http') !== 0) return;
    navigator.serviceWorker.ready
      .then(function (reg) { if (reg.active) reg.active.postMessage(msg); })
      .catch(function () {});
  }

  // Server push when available (the only thing that works on iPhone), else the
  // service-worker timer (Android, rests ≤ 5 min). Never both — that would
  // double-notify.
  function scheduleRestAlert(a) {
    const active = !!(a && a.rest && a.rest.endsAt > Date.now() && !a.rest.quiet);
    if (App.push.ready()) {
      postToWorker({ type: 'rest-cancel' });
      if (active) App.push.schedule(a.rest.endsAt, nextSetText(a));
      else App.push.cancel();
      return;
    }
    if (!active) { postToWorker({ type: 'rest-cancel' }); return; }
    postToWorker({ type: 'rest-schedule', endsAt: a.rest.endsAt, body: nextSetText(a) });
  }
  App.scheduleRestAlert = scheduleRestAlert;

  // If you're looking at the app as rest ends, the page chimes itself — pull
  // the server push ~2s early so you don't also get a banner.
  function quietIfWatching(a, remainSec) {
    if (!a || !a.rest || a.rest.quiet || document.hidden || remainSec > 2) return;
    a.rest.quiet = true;
    DB.saveNow('active');
    if (App.push.ready()) App.push.cancel();
    else postToWorker({ type: 'rest-cancel' });
  }
  App.quietIfWatching = quietIfWatching;

  // Called from the set-complete tap on each rest start: turns alerts on the
  // first time (permission prompt must come from a tap).
  function ensureAlertsEnabled(a) {
    if (App.push.status() === 'off') {
      App.push.enable().then(function (ok) { if (ok) scheduleRestAlert(a); });
    } else if (!App.push.supported()) {
      try {
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      } catch (e) {}
    }
  }

  // "Bench Press · set 3: 62.5 kg × 8" for the notification body
  function nextSetText(a) {
    for (let i = 0; i < a.items.length; i++) {
      const it = a.items[i];
      const si = it.sets.findIndex(function (s) { return !s.done; });
      if (si < 0) continue;
      const s = it.sets[si];
      const load = s.weight !== '' && s.reps !== '' && s.weight != null
        ? ': ' + U.fmtNum(App.fmtW(s.weight)) + ' ' + App.unit() + ' × ' + s.reps : '';
      return S.exerciseName(it.exerciseId) + ' · set ' + (si + 1) + load;
    }
    return 'All sets done — tap Finish when ready';
  }

  // ---- routine vs. this workout ----
  function typeSig(sets) { return sets.map(function (s) { return s.type || 'normal'; }).join(','); }
  function findItem(items, exId) { return items.filter(function (x) { return x.exerciseId === exId; })[0] || null; }

  // Human-readable list of structural differences (exercises, order, sets,
  // rest, rep range). Weights/reps aren't structure — they change every time.
  function routineDiff(r, items) {
    const out = [];
    const name = function (id) { return S.exerciseName(id); };
    const rIds = r.items.map(function (i) { return i.exerciseId; });
    const wIds = items.map(function (i) { return i.exerciseId; });
    items.forEach(function (it) { if (rIds.indexOf(it.exerciseId) < 0) out.push('Added ' + name(it.exerciseId) + ' (' + U.pluralize(it.sets.length, 'set') + ')'); });
    r.items.forEach(function (ri) { if (wIds.indexOf(ri.exerciseId) < 0) out.push('Removed ' + name(ri.exerciseId)); });
    const keptR = rIds.filter(function (id) { return wIds.indexOf(id) >= 0; });
    const keptW = wIds.filter(function (id) { return rIds.indexOf(id) >= 0; });
    if (keptR.join() !== keptW.join()) out.push('Changed exercise order');
    const sr = App.ss.signature(r.items), sw = App.ss.signature(items);
    if (keptW.some(function (id) { return (sr[id] || '') !== (sw[id] || ''); })) out.push('Changed supersets');
    items.forEach(function (it) {
      const ri = findItem(r.items, it.exerciseId);
      if (!ri) return;
      const n = name(it.exerciseId);
      if (it.sets.length !== ri.sets.length) out.push(n + ': ' + ri.sets.length + ' → ' + U.pluralize(it.sets.length, 'set'));
      else if (typeSig(it.sets) !== typeSig(ri.sets)) out.push(n + ': changed set types');
      if ((it.restSec || 0) !== (ri.restSec || 0)) {
        out.push(n + ': rest ' + (ri.restSec ? U.fmtClock(ri.restSec) : 'off') + ' → ' + (it.restSec ? U.fmtClock(it.restSec) : 'off'));
      }
      if (ri.repMin && (it.repMin !== ri.repMin || it.repMax !== ri.repMax)) {
        out.push(n + ': reps ' + ri.repMin + '–' + ri.repMax + ' → ' + it.repMin + '–' + it.repMax);
      }
    });
    return out;
  }

  // The routine as this workout was actually laid out. Routine notes are kept
  // (workout notes are per-session); set values become the template.
  function routineItemsFrom(items, r) {
    return items.map(function (it) {
      const ri = findItem(r.items, it.exerciseId);
      return {
        exerciseId: it.exerciseId,
        restSec: it.restSec || 0,
        repMin: it.repMin,
        repMax: it.repMax,
        superset: it.superset || undefined,
        notes: ri ? (ri.notes || '') : '',
        sets: it.sets.map(function (s) {
          return {
            type: s.type || 'normal',
            weight: s.weight === '' || s.weight == null ? '' : Number(s.weight),
            reps: s.reps === '' || s.reps == null ? '' : Number(s.reps)
          };
        })
      };
    });
  }

  function endActive() {
    scheduleRestAlert(null);
    DB.setActive(null);
  }
})();
