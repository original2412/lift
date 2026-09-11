/* global window */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, R = App.router;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  const SET_TYPES = ['normal', 'warmup', 'drop', 'fail'];
  const SET_GLYPH = { normal: null, warmup: 'W', drop: 'D', fail: 'F' };
  function setBadgeClass(t) { return t === 'warmup' ? 'warmup' : t === 'drop' ? 'drop' : t === 'fail' ? 'fail' : ''; }

  function blankSet() { return { type: 'normal', weight: '', reps: '' }; }

  function editorView(ctx, routine) {
    // routine is a working copy
    const v = UI.clear(ctx.el);
    const isNew = !S.routine(routine.id);

    v.appendChild(el('div.back-row', null, [
      el('button.icon-btn', { html: svg(ICON.back), 'aria-label': 'Back', onclick: leave }),
      el('span.title', { text: isNew ? 'New Routine' : 'Edit Routine' }),
      el('button.btn.sm.primary', { text: 'Save', onclick: save })
    ]));

    const nameInput = el('input.input', { value: routine.name === 'Untitled routine' ? '' : routine.name, placeholder: 'Routine name', style: { fontWeight: '700', fontSize: '17px' } });
    v.appendChild(el('div.field', { style: { marginTop: '6px' } }, [nameInput]));

    const notesInput = el('textarea.input', { value: routine.notes || '', placeholder: 'Notes (optional)' });
    v.appendChild(el('div.field', null, [notesInput]));

    const itemsHost = el('div');
    v.appendChild(itemsHost);

    v.appendChild(el('button.fab-add', {
      html: svg(ICON.plus) + '<span>Add exercise</span>',
      onclick: function () {
        App.exercisePicker({
          onDone: function (ids) {
            ids.forEach(function (exId) {
              routine.items.push({ exerciseId: exId, restSec: routine.items.length ? routine.items[0].restSec : S.settings.defaultRestSec, notes: '', sets: [blankSet()] });
            });
            renderItems();
          }
        });
      }
    }));

    if (!isNew) {
      v.appendChild(el('button.btn.danger.ghost', {
        text: 'Delete routine', style: { marginTop: '18px' },
        onclick: function () {
          UI.confirm({ title: 'Delete this routine?', confirmText: 'Delete', danger: true }).then(function (ok) {
            if (ok) { S.deleteRoutine(routine.id); R.go('/', true); }
          });
        }
      }));
    }

    function renderItems() {
      UI.clear(itemsHost);
      if (!routine.items.length) {
        itemsHost.appendChild(el('div.empty.tiny', { text: 'No exercises yet. Add some below.' }));
        return;
      }
      routine.items.forEach(function (it, idx) {
        itemsHost.appendChild(itemCard(it, idx));
      });
    }

    function itemCard(it, idx) {
      const ex = S.exercise(it.exerciseId);
      const card = el('div.ex-card');

      card.appendChild(el('div.ex-head', null, [
        UI.exerciseThumb(ex, 34),
        el('span.ex-name', { text: ex ? ex.name : 'Removed exercise' }),
        el('button.icon-btn', { html: svg(ICON.dots), 'aria-label': 'Options', onclick: function () { itemMenu(it, idx); } })
      ]));

      card.appendChild(el('input.ex-note', {
        value: it.notes || '', placeholder: 'Add note…',
        oninput: function (e) { it.notes = e.target.value; }
      }));

      // rest timer row
      card.appendChild(el('div.rowsplit', { style: { margin: '2px 0 8px' } }, [
        el('span.faint.tiny', { html: svg(ICON.timer, ' style="width:13px;height:13px;vertical-align:-2px"') + ' Rest timer' }),
        el('button.pill', {
          text: it.restSec ? U.fmtClock(it.restSec) : 'Off',
          onclick: function (e) {
            const cur = it.restSec || 0;
            const opts = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];
            const next = opts[(opts.indexOf(cur) + 1) % opts.length];
            it.restSec = next;
            e.target.textContent = next ? U.fmtClock(next) : 'Off';
          }
        })
      ]));

      // sets table
      const table = el('table.set-grid');
      table.appendChild(el('thead', null, el('tr', null, [
        el('th.set-col', { text: 'Set' }),
        el('th', { text: 'Kg' === App.unit() ? 'Kg' : App.unit() }),
        el('th', { text: 'Reps' }),
        el('th.done-col', { text: '' })
      ])));
      const tb = el('tbody');
      it.sets.forEach(function (st, si) { tb.appendChild(setRow(it, st, si)); });
      table.appendChild(tb);
      card.appendChild(table);

      card.appendChild(el('button.add-set-btn', {
        html: svg(ICON.plus, ' style="width:14px;height:14px;vertical-align:-2px"') + ' Add set',
        onclick: function () {
          const prev = it.sets[it.sets.length - 1];
          it.sets.push(prev ? { type: 'normal', weight: prev.weight, reps: prev.reps } : blankSet());
          renderRows(tb, it);
        }
      }));

      return card;

      function setRow(item, st, si) {
        const tr = el('tr');
        const badge = el('div.set-badge ' + setBadgeClass(st.type), { text: SET_GLYPH[st.type] || String(workingIndex(item, si)) });
        tr.appendChild(el('td.set-col', null, el('button', { style: { width: '100%' }, onclick: function () {
          st.type = SET_TYPES[(SET_TYPES.indexOf(st.type) + 1) % SET_TYPES.length];
          renderRows(tb, item);
        } }, badge)));
        tr.appendChild(el('td', null, numInput(st, 'weight', 'kg')));
        tr.appendChild(el('td', null, numInput(st, 'reps', 'reps')));
        tr.appendChild(el('td.done-col', null, el('button.icon-btn', {
          html: svg(ICON.trash, ' style="width:16px;height:16px"'), 'aria-label': 'Remove set',
          onclick: function () {
            item.sets.splice(si, 1);
            if (!item.sets.length) item.sets.push(blankSet());
            renderRows(tb, item);
          }
        })));
        return tr;
      }

      function numInput(st, key, kind) {
        const isW = kind === 'kg';
        const val = isW ? (st[key] === '' || st[key] == null ? '' : U.fmtNum(App.fmtW(st[key]))) : (st[key] == null ? '' : st[key]);
        return el('input.set-input', {
          type: 'text', inputmode: 'decimal', value: val, placeholder: isW ? App.unit() : '—',
          onblur: function (e) {
            const raw = e.target.value.trim().replace(',', '.');
            if (raw === '') { st[key] = ''; return; }
            const num = parseFloat(raw);
            if (isNaN(num)) { e.target.value = val; return; }
            st[key] = isW ? U.fromDisplayWeight(num, App.unit()) : num;
            e.target.value = isW ? U.fmtNum(App.fmtW(st[key])) : String(num);
          }
        });
      }

      function renderRows(tbody, item) {
        UI.clear(tbody);
        item.sets.forEach(function (s, i) { tbody.appendChild(setRow(item, s, i)); });
        // refresh numbering badges
      }
    }

    function workingIndex(item, si) {
      let n = 0;
      for (let i = 0; i <= si; i++) if (item.sets[i].type !== 'warmup') n++;
      return n || 1;
    }

    function itemMenu(it, idx) {
      UI.menu(S.exerciseName(it.exerciseId), [
        idx > 0 ? { label: 'Move up', icon: ICON.chevronL, onClick: function () { swap(idx, idx - 1); } } : null,
        idx < routine.items.length - 1 ? { label: 'Move down', icon: ICON.chevronR, onClick: function () { swap(idx, idx + 1); } } : null,
        { label: 'Replace exercise', icon: ICON.swap, onClick: function () {
          App.exercisePicker({ onDone: function (ids) { if (ids[0]) { it.exerciseId = ids[0]; renderItems(); } } });
        } },
        { label: 'Remove from routine', icon: ICON.trash, danger: true, onClick: function () {
          routine.items.splice(idx, 1); renderItems();
        } }
      ]);
    }
    function swap(a, b) {
      const t = routine.items[a]; routine.items[a] = routine.items[b]; routine.items[b] = t;
      renderItems();
    }

    function collect() {
      routine.name = nameInput.value.trim() || 'Untitled routine';
      routine.notes = notesInput.value.trim();
    }

    function save() {
      collect();
      if (!routine.items.length) { UI.toast('Add at least one exercise'); return; }
      const saved = S.saveRoutine(routine);
      dirty = false;
      UI.toast('Routine saved');
      R.go('/', true);
    }

    function leave() {
      collect();
      const changed = dirty || JSON.stringify(routine) !== baseline;
      if (!changed) { R.back('/'); return; }
      UI.confirm({ title: 'Discard changes?', message: 'This routine has unsaved edits.', confirmText: 'Discard', danger: true, cancelText: 'Keep editing' })
        .then(function (ok) { if (ok) R.back('/'); });
    }

    let dirty = false;
    ['input', 'change'].forEach(function (ev) {
      v.addEventListener(ev, function () { dirty = true; });
    });
    const baseline = JSON.stringify(routine);

    renderItems();
  }

  App.router.add('/routine/new', function (ctx) {
    editorView(ctx, { id: U.uid(), name: 'Untitled routine', notes: '', items: [] });
  }, { tab: 'home', fullscreen: true });

  App.router.add('/routine/:id/edit', function (ctx) {
    const r = S.routine(ctx.params.id);
    if (!r) { ctx.el.appendChild(el('div.empty', { text: 'Routine not found' })); return; }
    editorView(ctx, U.deepClone(r));
  }, { tab: 'home', fullscreen: true });

  // expose set-type helpers for workout view
  App.SET_TYPES = SET_TYPES;
  App.SET_GLYPH = SET_GLYPH;
  App.setBadgeClass = setBadgeClass;
})();
