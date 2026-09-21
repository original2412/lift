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
        return { type: s.type === 'warmup' ? 'warmup' : 'normal', weight: s.weight, reps: s.reps, done: false };
      });
    }
    return [{ type: 'normal', weight: '', reps: '', done: false }];
  }

  function repRangeFor(exId, src) {
    if (src && src.repMin) return { min: src.repMin, max: src.repMax };
    return S.defaultRepRange(exId);
  }

  // Pre-fill not-yet-done working sets with the progression target.
  function applyTarget(item, exceptWorkoutId) {
    const p = S.progression(item.exerciseId, item.repMin, item.repMax, exceptWorkoutId);
    if (!p) return;
    item.sets.forEach(function (s) {
      if (s.done || s.type === 'warmup' || s.type === 'drop') return;
      s.weight = p.weight;
      s.reps = p.reps;
    });
  }

  function newItem(exId, fields) {
    const rr = repRangeFor(exId, fields);
    const item = Object.assign({ exerciseId: exId, notes: '', restSec: S.settings.defaultRestSec }, fields, {
      repMin: rr.min, repMax: rr.max
    });
    applyTarget(item, null);
    return item;
  }

  function itemFromRoutine(rit) {
    return newItem(rit.exerciseId, {
      notes: rit.notes || '',
      restSec: rit.restSec != null ? rit.restSec : S.settings.defaultRestSec,
      repMin: rit.repMin, repMax: rit.repMax,
      sets: (rit.sets && rit.sets.length ? rit.sets : [{ type: 'normal', weight: '', reps: '' }]).map(function (s) {
        return { type: s.type || 'normal', weight: s.weight === '' ? '' : s.weight, reps: s.reps === '' ? '' : s.reps, done: false };
      })
    });
  }

  const Workout = {
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
      const p = S.progression(item.exerciseId, item.repMin, item.repMax, a.id);
      const u = App.unit();
      const w = function (kg) { return U.fmtNum(App.fmtW(kg)); };
      let main, why;
      if (!p) {
        main = 'First time — find your weight';
        why = 'Pick a weight you can do for ' + item.repMin + '–' + item.repMax + ' reps close to failure';
      } else if (p.kind === 'weight') {
        main = 'Target ' + w(p.weight) + ' ' + u + ' × ' + p.reps;
        why = 'Hit ' + p.lastReps + ' reps on every set last time → +' + w(p.incKg) + ' ' + u;
      } else {
        main = 'Target ' + w(p.weight) + ' ' + u + ' × ' + p.reps;
        why = 'Last time ' + w(p.lastWeight) + '×' + p.lastReps + ' → beat it by one rep';
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
        onDone: function (sec) { item.restSec = sec; persist(); render(); }
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
      if (clockEl) clockEl.textContent = U.fmtClock((Date.now() - a.startedAt) / 1000);
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

    // ---- exercise card ----
    function exerciseCard(it, idx) {
      const ex = S.exercise(it.exerciseId);
      const card = el('div.ex-card');
      const last = S.lastPerformance(it.exerciseId, a.id);

      card.appendChild(el('div.ex-head', null, [
        el('a', { href: ex ? '#/exercise/' + ex.id : '#/workout' }, UI.exerciseThumb(ex, 34)),
        el('a.ex-name', { text: ex ? ex.name : 'Removed exercise', href: ex ? '#/exercise/' + ex.id : '#/workout' }),
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

      card.appendChild(el('button.add-set-btn', {
        html: svg(ICON.plus, ' style="width:14px;height:14px;vertical-align:-2px"') + ' Add set',
        onclick: function () {
          const p = it.sets[it.sets.length - 1];
          it.sets.push({ type: 'normal', weight: p ? p.weight : '', reps: p ? p.reps : '', done: false });
          persist();
          renderSetRows();
        }
      }));

      return card;

      function renderSetRows() {
        UI.clear(tb);
        it.sets.forEach(function (st, si) { tb.appendChild(setRow(st, si)); });
      }

      function prevText(si) {
        if (!last || !last.sets[si]) return '—';
        const p = last.sets[si];
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
            if (!last || !last.sets[si]) return;
            const p = last.sets[si];
            if (st.weight === '' || st.weight == null) st.weight = p.weight;
            if (st.reps === '' || st.reps == null) st.reps = p.reps;
            persist(); renderSetRows();
          }
        })));

        tr.appendChild(el('td', null, numInput(st, 'weight', true)));
        tr.appendChild(el('td', null, numInput(st, 'reps', false)));

        tr.appendChild(el('td.done-col', null, el('button.check', {
          html: svg(ICON.check), 'aria-label': 'Complete set',
          onclick: function () { toggleDone(st, si); }
        })));

        // PR tag row
        if (st.done && st._pr) {
          const prTr = el('tr', null, el('td', { colspan: 5, style: { paddingTop: '0' } },
            el('span.pr-tag', { html: svg(ICON.trophy, ' style="width:12px;height:12px" fill="currentColor" stroke="none"') + ' ' + st._pr })));
          // append after; handled by returning fragment-like: we push directly
          tb.appendChild(tr);
          return prTr;
        }
        return tr;
      }

      function numInput(st, key, isW) {
        const shown = st[key] === '' || st[key] == null ? '' : (isW ? U.fmtNum(App.fmtW(st[key])) : String(st[key]));
        return el('input.set-input', {
          type: 'text', inputmode: 'decimal', value: shown, placeholder: isW ? App.unit() : '—',
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
          if ((st.weight === '' || st.weight == null) && last && last.sets[si]) st.weight = last.sets[si].weight;
          if ((st.reps === '' || st.reps == null) && last && last.sets[si]) st.reps = last.sets[si].reps;
          if (st.type !== 'warmup') {
            const pr = checkPR(it.exerciseId, st);
            if (pr) { st._pr = pr; UI.buzz([40, 40, 90]); }
          }
          if (it.restSec) startRest(it.restSec);
        }
        persist();
        renderSetRows();
      }

      function itemMenu(item, i) {
        UI.menu(S.exerciseName(item.exerciseId), [
          { label: item.notes || item._showNote ? 'Hide note' : 'Add note', icon: ICON.note, onClick: function () {
            item._showNote = !(item.notes || item._showNote); if (!item._showNote) {} render();
          } },
          { label: 'Rest timer: ' + (item.restSec ? U.fmtClock(item.restSec) : 'off'), icon: ICON.timer, onClick: function () { pickRest(item); } },
          i > 0 ? { label: 'Move up', icon: ICON.chevronL, onClick: function () { move(i, i - 1); } } : null,
          i < a.items.length - 1 ? { label: 'Move down', icon: ICON.chevronR, onClick: function () { move(i, i + 1); } } : null,
          { label: 'Replace exercise', icon: ICON.swap, onClick: function () {
            App.exercisePicker({ onDone: function (ids) { if (ids[0]) { item.exerciseId = ids[0]; persist(); render(); } } });
          } },
          { label: 'Remove exercise', icon: ICON.trash, danger: true, onClick: function () {
            a.items.splice(i, 1); persist(); render();
          } }
        ]);
      }
      function move(x, y) { const t = a.items[x]; a.items[x] = a.items[y]; a.items[y] = t; persist(); render(); }
    }

    // ---- finish ----
    function finish() {
      const doneSets = a.items.reduce(function (n, it) { return n + it.sets.filter(function (s) { return s.done; }).length; }, 0);
      if (doneSets === 0) {
        UI.confirm({ title: 'Finish with no sets?', message: 'No sets are marked complete, so nothing meaningful will be saved.', confirmText: 'Discard workout', danger: true, cancelText: 'Keep going' })
          .then(function (ok) { if (ok) { endActive(); R.go('/', true); } });
        return;
      }
      const endedAt = Date.now();
      const record = {
        id: a.id,
        name: a.name,
        routineId: a.routineId,
        startedAt: a.startedAt,
        endedAt: endedAt,
        durationSec: Math.round((endedAt - a.startedAt) / 1000),
        notes: '',
        items: a.items
          .map(function (it) {
            return {
              exerciseId: it.exerciseId,
              notes: it.notes || '',
              restSec: it.restSec || 0,
              repMin: it.repMin, repMax: it.repMax,
              sets: it.sets
                .filter(function (s) { return s.done; })
                .map(function (s) { return { type: s.type, weight: Number(s.weight) || 0, reps: Number(s.reps) || 0, done: true }; })
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

    v.appendChild(el('div.summary-hero', null, [
      el('div', { html: svg(ICON.trophy, ' style="width:34px;height:34px;color:var(--pr)"') }),
      el('div.big', { text: w.name }),
      el('div.muted.tiny', { text: U.fmtDate(w.startedAt, { weekday: 'long', month: 'short', day: 'numeric' }) + ' · ' + U.fmtTime(w.startedAt) })
    ]));

    v.appendChild(el('div.stat-grid', { style: { marginTop: '10px' } }, [
      box(U.fmtDuration(w.durationSec), 'Duration'),
      box(compact(App.fmtW(S.workoutVolume(w))) + ' ' + App.unit(), 'Volume'),
      box(String(S.workoutSetCount(w)), 'Sets')
    ]));

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
  }, { tab: 'home', fullscreen: true });

  // ---------------- helpers ----------------
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

  function endActive() {
    scheduleRestAlert(null);
    DB.setActive(null);
  }
})();
