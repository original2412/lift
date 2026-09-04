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

  function itemFromRoutine(rit) {
    return {
      exerciseId: rit.exerciseId,
      notes: rit.notes || '',
      restSec: rit.restSec != null ? rit.restSec : S.settings.defaultRestSec,
      sets: (rit.sets && rit.sets.length ? rit.sets : [{ type: 'normal', weight: '', reps: '' }]).map(function (s) {
        return { type: s.type || 'normal', weight: s.weight === '' ? '' : s.weight, reps: s.reps === '' ? '' : s.reps, done: false };
      })
    };
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
      if (ok) { DB.setActive(null); proceed(); }
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

    ctx.onLeave(function () {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
      try { if (wake) wake.release(); } catch (e) {}
      DB.saveNow('active');
    });

    let restBarEl, clockEl;
    let restDone = false;

    render();

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

      // rest bar placeholder
      restBarEl = el('div');
      v.appendChild(restBarEl);
      renderRestBar();

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
                a.items.push({ exerciseId: exId, notes: '', restSec: S.settings.defaultRestSec, sets: setsFromLast(exId) });
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
            .then(function (ok) { if (ok) { DB.setActive(null); R.go('/', true); } });
        }
      }));

      updateClocks();
    }

    // ---- rest timer ----
    function startRest(sec) {
      if (!sec) return;
      a.rest = { endsAt: Date.now() + sec * 1000, duration: sec };
      persist();
      renderRestBar();
    }
    function stopRest() { a.rest = null; persist(); renderRestBar(); }
    function bumpRest(delta) {
      if (!a.rest) return;
      a.rest.endsAt = Math.max(Date.now(), a.rest.endsAt + delta * 1000);
      persist();
      updateClocks();
    }
    function renderRestBar() {
      UI.clear(restBarEl);
      if (!a.rest) return;
      const time = el('span.time', { text: '0:00' });
      restBarEl.appendChild(el('div.rest-bar', null, [
        el('span', { html: svg(ICON.timer, ' style="width:18px;height:18px"') }),
        time,
        el('span.grow'),
        el('button', { text: '-15', onclick: function () { bumpRest(-15); } }),
        el('button', { text: '+15', onclick: function () { bumpRest(15); } }),
        el('button', { text: 'Skip', onclick: stopRest })
      ]));
      restBarEl._time = time;
      updateClocks();
    }

    function updateClocks() {
      if (clockEl) clockEl.textContent = U.fmtClock((Date.now() - a.startedAt) / 1000);
      if (a.rest && restBarEl._time) {
        const remain = (a.rest.endsAt - Date.now()) / 1000;
        if (remain <= 0) {
          restBarEl._time.textContent = '0:00';
          if (!restDone) {
            restDone = true;
            UI.buzz([120, 60, 120]);
            notify('Rest complete', a.name);
            a.rest = null; persist();
            setTimeout(renderRestBar, 400);
          }
        } else {
          restDone = false;
          restBarEl._time.textContent = U.fmtClock(remain);
        }
      }
    }

    // ---- exercise card ----
    function exerciseCard(it, idx) {
      const ex = S.exercise(it.exerciseId);
      const card = el('div.ex-card');
      const bests = liveBests(it.exerciseId);
      const last = S.lastPerformance(it.exerciseId, a.id);

      card.appendChild(el('div.ex-head', null, [
        el('a.ex-name', { text: ex ? ex.name : 'Removed exercise', href: ex ? '#/exercise/' + ex.id : '#/workout' }),
        el('span.faint.tiny', { text: it.restSec ? U.fmtClock(it.restSec) + ' rest' : 'no rest' }),
        el('button.icon-btn', { html: svg(ICON.dots), 'aria-label': 'Options', onclick: function () { itemMenu(it, idx); } })
      ]));

      if (it.notes || it._showNote) {
        card.appendChild(el('input.ex-note', {
          value: it.notes || '', placeholder: 'Note…',
          oninput: function (e) { it.notes = e.target.value; persist(); }
        }));
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
            const pr = checkPR(it.exerciseId, st, bests);
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
          { label: 'Rest timer: ' + (item.restSec ? U.fmtClock(item.restSec) : 'off'), icon: ICON.timer, onClick: function () {
            const opts = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];
            item.restSec = opts[(opts.indexOf(item.restSec || 0) + 1) % opts.length];
            persist(); render();
          } },
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
          .then(function (ok) { if (ok) { DB.setActive(null); R.go('/', true); } });
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
      DB.setActive(null);
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

  // best numbers combining committed history + current live session progress
  function liveBests(exId) {
    const b = S.exerciseBests(exId, DB.state.active ? DB.state.active.id : null);
    return b;
  }
  function checkPR(exId, st, bests) {
    const w = Number(st.weight) || 0, r = Number(st.reps) || 0;
    if (!w || !r) return null;
    const e1 = U.epley1RM(w, r);
    if (e1 > (bests._e1rm || bests.e1rm) + 0.01) {
      bests._e1rm = e1;
      if (w > (bests._weight || bests.weight) + 0.01) bests._weight = w;
      return 'Est. 1RM PR';
    }
    if (w > (bests._weight || bests.weight) + 0.01) {
      bests._weight = w;
      return 'Weight PR';
    }
    return null;
  }

  function notify(title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: body, silent: false });
      }
    } catch (e) {}
  }
})();
