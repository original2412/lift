/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  // ---------- shared: create / edit exercise form ----------
  function exerciseForm(existing, onSaved) {
    const isEdit = !!existing;
    const name = el('input.input', { value: existing ? existing.name : '', placeholder: 'Exercise name' });
    const primary = el('select.input', null, App.MUSCLES.map(function (m) {
      return el('option', { value: m, text: m, selected: existing && existing.primary === m });
    }));
    const equip = el('select.input', null, App.EQUIPMENT.map(function (q) {
      return el('option', { value: q, text: q, selected: existing && existing.equipment === q });
    }));
    const tracking = el('select.input', null, [
      el('option', { value: 'weight', text: 'Weight & reps', selected: !existing || existing.tracking !== 'cardio' }),
      el('option', { value: 'cardio', text: 'Duration (cardio)', selected: existing && existing.tracking === 'cardio' })
    ]);

    const body = el('div', null, [
      el('label.field', null, [el('span.label', { text: 'Name' }), name]),
      el('label.field', null, [el('span.label', { text: 'Primary muscle' }), primary]),
      el('label.field', null, [el('span.label', { text: 'Equipment' }), equip]),
      el('label.field', null, [el('span.label', { text: 'Tracking' }), tracking])
    ]);

    const ref = UI.sheet({
      title: isEdit ? 'Edit exercise' : 'New exercise',
      body: body,
      footer: el('button.btn.primary', {
        text: isEdit ? 'Save' : 'Create exercise',
        onclick: function () {
          const n = name.value.trim();
          if (!n) { name.focus(); UI.toast('Give it a name'); return; }
          let result;
          if (isEdit) {
            S.updateExercise(existing.id, { name: n, primary: primary.value, equipment: equip.value, tracking: tracking.value });
            result = S.exercise(existing.id);
          } else {
            result = S.addExercise({ name: n, primary: primary.value, equipment: equip.value, tracking: tracking.value });
          }
          ref.close();
          if (onSaved) onSaved(result);
        }
      })
    });
    setTimeout(function () { name.focus(); }, 250);
  }
  App.exerciseForm = exerciseForm;

  // ---------- shared: multi-select picker ----------
  // App.exercisePicker({ onDone: fn(ids[]), excludeIds:[] })
  App.exercisePicker = function (opts) {
    opts = opts || {};
    const exclude = opts.excludeIds || [];
    const picked = {};
    let query = '';
    let muscle = 'All';

    const listWrap = el('div.list');
    const countBtn = el('button.btn.primary', { text: 'Add', disabled: true });

    function refreshList() {
      UI.clear(listWrap);
      const all = S.exercises().filter(function (e) { return exclude.indexOf(e.id) < 0; });
      const filtered = all.filter(function (e) {
        if (muscle !== 'All' && e.primary !== muscle) return false;
        if (query && (e.name + ' ' + e.equipment + ' ' + e.primary).toLowerCase().indexOf(query) < 0) return false;
        return true;
      });
      if (!filtered.length) {
        listWrap.appendChild(el('div.empty.tiny', { text: 'No matching exercises' }));
      }
      filtered.forEach(function (e) {
        const on = !!picked[e.id];
        const row = el('div.pick-item' + (on ? '.on' : ''), {
          onclick: function () {
            if (picked[e.id]) delete picked[e.id]; else picked[e.id] = true;
            row.classList.toggle('on');
            row.querySelector('.box').innerHTML = picked[e.id] ? svg(ICON.check) : '';
            updateCount();
          }
        }, [
          el('span.box', { html: on ? svg(ICON.check) : '' }),
          UI.exerciseThumb(e, 36),
          el('div.grow', { style: { minWidth: 0 } }, [
            el('div.name', { text: e.name }),
            el('div.meta', { text: e.primary + ' · ' + e.equipment + (e.isCustom ? ' · custom' : '') })
          ])
        ]);
        listWrap.appendChild(row);
      });
    }

    function updateCount() {
      const n = Object.keys(picked).length;
      countBtn.disabled = n === 0;
      countBtn.textContent = n ? 'Add ' + n + (n === 1 ? ' exercise' : ' exercises') : 'Add';
    }

    const search = el('div.search', null, [
      el('span', { html: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>') }),
      el('input', {
        type: 'search', placeholder: 'Search exercises', autocomplete: 'off',
        oninput: function (e) { query = e.target.value.trim().toLowerCase(); refreshList(); }
      })
    ]);

    const chips = el('div.chips', null, ['All'].concat(App.MUSCLES).map(function (m) {
      return el('button.chip' + (m === 'All' ? '.on' : ''), {
        text: m,
        onclick: function (ev) {
          muscle = m;
          Array.prototype.forEach.call(chips.children, function (c) { c.classList.toggle('on', c === ev.target); });
          refreshList();
        }
      });
    }));

    const body = el('div', null, [
      el('button.fab-add', {
        html: svg(ICON.plus) + '<span>Create new exercise</span>',
        style: { marginBottom: '10px' },
        onclick: function () {
          exerciseForm(null, function (ex) { picked[ex.id] = true; refreshList(); updateCount(); });
        }
      }),
      search, chips, listWrap
    ]);

    const ref = UI.sheet({
      title: 'Add exercises',
      body: body,
      footer: countBtn
    });
    countBtn.addEventListener('click', function () {
      const ids = Object.keys(picked);
      if (!ids.length) return;
      ref.close();
      opts.onDone(ids);
    });
    refreshList();
  };

  // ---------- Exercises tab ----------
  App.router.add('/exercises', function (ctx) {
    let query = '';
    let muscle = 'All';

    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      v.appendChild(el('div.page-head', null, [
        el('h1', { text: 'Exercises' }),
        el('button.icon-btn', { html: svg(ICON.plus), 'aria-label': 'New exercise', onclick: function () {
          exerciseForm(null, function (ex) { R.go('/exercise/' + ex.id); });
        } })
      ]));

      v.appendChild(el('div.search', null, [
        el('span', { html: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>') }),
        el('input', {
          type: 'search', placeholder: 'Search exercises', autocomplete: 'off', value: query,
          oninput: function (e) { query = e.target.value.trim().toLowerCase(); renderList(); }
        })
      ]));

      const chips = el('div.chips', null, ['All'].concat(App.MUSCLES).map(function (m) {
        return el('button.chip' + (m === muscle ? '.on' : ''), {
          text: m,
          onclick: function (ev) {
            muscle = m;
            Array.prototype.forEach.call(chips.children, function (c) { c.classList.toggle('on', c === ev.target); });
            renderList();
          }
        });
      }));
      v.appendChild(chips);

      const listHost = el('div.list');
      v.appendChild(listHost);

      function renderList() {
        UI.clear(listHost);
        const items = S.exercises().filter(function (e) {
          if (muscle !== 'All' && e.primary !== muscle) return false;
          if (query && (e.name + ' ' + e.equipment + ' ' + e.primary).toLowerCase().indexOf(query) < 0) return false;
          return true;
        });
        if (!items.length) {
          listHost.appendChild(el('div.empty.tiny', { text: 'Nothing here. Tap + to add a custom exercise.' }));
          return;
        }
        items.forEach(function (e) {
          const best = S.exerciseBests(e.id);
          listHost.appendChild(el('a.list-item', {
            href: '#/exercise/' + e.id
          }, [
            UI.exerciseThumb(e, 40),
            el('div.grow', null, [
              el('div.name', { text: e.name }),
              el('div.meta', { text: e.primary + ' · ' + e.equipment + (best.e1rm ? ' · best ' + U.fmtNum(App.fmtW(best.e1rm)) + App.unit() : '') })
            ]),
            el('span.chev', { html: svg(ICON.chevronR) })
          ]));
        });
      }
      renderList();
    });
  }, { tab: 'exercises' });

  // ---------- Exercise detail ----------
  App.router.add('/exercise/:id', function (ctx) {
    const id = ctx.params.id;
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      const ex = S.exercise(id);
      if (!ex) { v.appendChild(el('div.empty', { text: 'Exercise not found' })); return; }

      v.appendChild(el('div.back-row', null, [
        el('button.icon-btn', { html: svg(ICON.back), 'aria-label': 'Back', onclick: function () { R.back('/exercises'); } }),
        el('span.title', { text: ex.name }),
        el('button.icon-btn', { html: svg(ICON.dots), 'aria-label': 'Options', onclick: function () { detailMenu(ex); } })
      ]));
      if (ex.image) v.appendChild(el('img.ex-hero', { src: ex.image, alt: '' }));
      v.appendChild(el('div.muted.tiny', { text: ex.primary + ' · ' + ex.equipment + (ex.isCustom ? ' · custom' : ''), style: { margin: '0 2px 14px' } }));

      const bests = S.exerciseBests(id);
      const series = S.exerciseSeries(id);

      v.appendChild(el('div.stat-grid', { style: { marginBottom: '14px' } }, [
        statBox(bests.e1rm ? U.fmtNum(App.fmtW(bests.e1rm)) : '—', 'Est. 1RM ' + App.unit()),
        statBox(bests.weight ? U.fmtNum(App.fmtW(bests.weight)) : '—', 'Top set ' + App.unit()),
        statBox(bests.volume ? compact(App.fmtW(bests.volume)) : '—', 'Best session ' + App.unit())
      ]));

      if (series.length) {
        v.appendChild(el('div.chart-wrap', null, [
          el('div.chart-title', null, [el('span', { text: 'Estimated 1RM' }), el('span', { text: App.unit() })]),
          el('div', { html: App.charts.line(series.map(function (p) { return { t: p.t, v: App.fmtW(p.e1rm) }; }), 'v') })
        ]));
        v.appendChild(el('div.chart-wrap', null, [
          el('div.chart-title', null, [el('span', { text: 'Volume per session' }), el('span', { text: App.unit() })]),
          el('div', { html: App.charts.bars(series.slice(-14).map(function (p) {
            return { label: U.fmtDate(p.t, { month: 'short', day: 'numeric' }), value: Math.round(App.fmtW(p.volume)) };
          })) })
        ]));
      }

      v.appendChild(el('div.section-label', { text: 'History' }));
      const hist = S.workouts().filter(function (w) {
        return (w.items || []).some(function (it) { return it.exerciseId === id; });
      });
      if (!hist.length) {
        v.appendChild(el('div.empty.tiny', { text: 'No logged sets yet' }));
      } else {
        hist.forEach(function (w) {
          const it = w.items.find(function (x) { return x.exerciseId === id; });
          const sets = (it.sets || []).filter(function (s) { return s.done; });
          v.appendChild(el('a.card.tight', { href: '#/history/' + w.id, style: { display: 'block' } }, [
            el('div.rowsplit', null, [
              el('strong.tiny', { text: U.fmtDate(w.startedAt, { month: 'short', day: 'numeric', year: 'numeric' }) }),
              el('span.faint.tiny', { text: U.relDay(w.startedAt) })
            ]),
            el('div.tiny.muted', { style: { marginTop: '4px' }, text: sets.length
              ? sets.map(function (s) { return U.fmtNum(App.fmtW(s.weight)) + '×' + U.fmtNum(s.reps); }).join('   ')
              : 'no completed sets' })
          ]));
        });
      }
    });
  }, { tab: 'exercises', fullscreen: true });

  function statBox(v, k) { return el('div.stat-box', null, [el('div.v', { text: v }), el('div.k', { text: k })]); }
  function compact(n) {
    n = Math.round(n);
    return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }

  function detailMenu(ex) {
    const items = [
      { label: 'Edit exercise', icon: ICON.edit, onClick: function () { exerciseForm(ex, function () { App.router.render(); }); } }
    ];
    if (ex.isCustom) {
      items.push({ label: 'Delete exercise', icon: ICON.trash, danger: true, onClick: function () {
        const used = S.exerciseUsedCount(ex.id);
        UI.confirm({
          title: 'Delete “' + ex.name + '”?',
          message: used ? 'It appears in ' + U.pluralize(used, 'past workout') + '. Those stay, but the name will show as removed.' : 'This cannot be undone.',
          confirmText: 'Delete', danger: true
        }).then(function (ok) { if (ok) { S.deleteExercise(ex.id); App.router.back('/exercises'); } });
      } });
    }
    UI.menu(ex.name, items);
  }
})();
