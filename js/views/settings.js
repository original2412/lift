/* global window, document */
(function () {
  'use strict';
  const App = window.App;
  const UI = App.ui, S = App.store, U = App.utils, DB = App.db;
  const el = UI.el, svg = UI.svg, ICON = UI.ICON;

  function rowToggle(label, sub, value, onChange) {
    const knob = el('span', { style: {
      position: 'absolute', top: '3px', left: value ? '23px' : '3px',
      width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left .15s'
    } });
    const track = el('button', {
      'aria-pressed': String(value),
      style: {
        position: 'relative', width: '46px', height: '26px', borderRadius: '999px', flex: '0 0 auto',
        background: value ? 'var(--accent)' : 'var(--bg-elev-2)', border: '1px solid var(--line)'
      },
      onclick: function () {
        value = !value;
        track.style.background = value ? 'var(--accent)' : 'var(--bg-elev-2)';
        track.style.borderColor = value ? 'var(--accent)' : 'var(--line)';
        knob.style.left = value ? '23px' : '3px';
        onChange(value);
      }
    }, knob);
    return el('div.list-item', null, [
      el('div.grow', null, [el('div.name', { text: label }), sub ? el('div.meta', { text: sub }) : null]),
      track
    ]);
  }

  function segmented(options, value, onChange) {
    const wrap = el('div', { style: { display: 'flex', gap: '6px' } });
    options.forEach(function (o) {
      wrap.appendChild(el('button.btn.sm', {
        text: o.label,
        style: o.value === value
          ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
          : {},
        onclick: function () { if (o.value !== value) onChange(o.value); }
      }));
    });
    return wrap;
  }

  App.router.add('/settings', function (ctx) {
    ctx.bind(function () {
      const v = UI.clear(ctx.el);
      const st = S.settings;
      v.appendChild(el('div.page-head', null, [el('h1', { text: 'Settings' })]));

      // --- Units ---
      v.appendChild(el('div.section-label', { text: 'Preferences' }));
      const card = el('div.card', { style: { padding: '4px 14px' } });

      card.appendChild(el('div.list-item', null, [
        el('div.grow', null, [el('div.name', { text: 'Units' }), el('div.meta', { text: 'Weight display everywhere' })]),
        segmented([{ label: 'kg', value: 'kg' }, { label: 'lb', value: 'lb' }], st.units, function (u) {
          DB.setSettings({ units: u }); S.emit();
        })
      ]));

      card.appendChild(el('div.list-item', null, [
        el('div.grow', null, [el('div.name', { text: 'Default rest timer' }), el('div.meta', { text: 'Used for new exercises' })]),
        el('button.pill', { text: st.defaultRestSec ? U.fmtClock(st.defaultRestSec) : 'Off', onclick: function (e) {
          const btn = e.currentTarget;
          UI.durationPicker({
            title: 'Default rest timer',
            value: st.defaultRestSec || 0,
            onDone: function (sec) {
              DB.setSettings({ defaultRestSec: sec });
              btn.textContent = sec ? U.fmtClock(sec) : 'Off';
            }
          });
        } })
      ]));

      card.appendChild(el('div.list-item', null, [
        el('div.grow', null, [el('div.name', { text: 'Theme' })]),
        segmented([{ label: 'Dark', value: 'dark' }, { label: 'Light', value: 'light' }], st.theme, function (t) {
          DB.setSettings({ theme: t }); App.applyTheme(); S.emit();
        })
      ]));

      card.appendChild(rowToggle('Keep screen awake', 'During an active workout', !!st.wakeLock, function (on) {
        DB.setSettings({ wakeLock: on });
      }));

      card.appendChild(restAlertRow());
      v.appendChild(card);

      // --- Data ---
      v.appendChild(el('div.section-label', { text: 'Your data' }));
      const dcard = el('div.card', { style: { padding: '4px 14px' } });

      dcard.appendChild(el('button.list-item', { style: { width: '100%', textAlign: 'left' }, onclick: exportData }, [
        el('span', { html: svg(ICON.download), style: { color: 'var(--accent)' } }),
        el('div.grow', null, [el('div.name', { text: 'Export backup' }), el('div.meta', { text: 'Download everything as a JSON file' })])
      ]));
      dcard.appendChild(el('button.list-item', { style: { width: '100%', textAlign: 'left' }, onclick: importData }, [
        el('span', { html: svg(ICON.upload), style: { color: 'var(--accent)' } }),
        el('div.grow', null, [el('div.name', { text: 'Import backup' }), el('div.meta', { text: 'Restore or merge from a JSON file' })])
      ]));
      dcard.appendChild(el('button.list-item', { style: { width: '100%', textAlign: 'left' }, onclick: reseed }, [
        el('span', { html: svg(ICON.dumbbell) }),
        el('div.grow', null, [el('div.name', { text: 'Restore default exercises' }), el('div.meta', { text: 'Re-add any built-ins you deleted' })])
      ]));
      dcard.appendChild(el('button.list-item.danger', { style: { width: '100%', textAlign: 'left' }, onclick: wipe }, [
        el('span', { html: svg(ICON.trash) }),
        el('div.grow', null, [el('div.name', { text: 'Erase all data' }), el('div.meta', { text: 'Delete routines, history and settings' })])
      ]));
      v.appendChild(dcard);

      // counts
      v.appendChild(el('div.card.tiny.muted', null, [
        el('div', { text: U.pluralize(S.exercises().length, 'exercise') + ' · ' + U.pluralize(S.routines().length, 'routine') + ' · ' + U.pluralize(S.workouts().length, 'workout') }),
        el('div', { text: 'Storage used: ~' + storageKB() + ' KB', style: { marginTop: '3px' } })
      ]));

      v.appendChild(el('div.center.faint.tiny', { style: { marginTop: '14px' }, html: 'Lift · local-only workout tracker<br>All data stays on this device.' }));
    });
  }, { tab: 'settings' });

  // ---------- data actions ----------
  function exportData() {
    const blob = new Blob([JSON.stringify(DB.exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const aTag = document.createElement('a');
    aTag.href = url;
    aTag.download = 'lift-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(aTag);
    aTag.click();
    aTag.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    UI.toast('Backup downloaded');
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = function () {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        let parsed;
        try { parsed = JSON.parse(reader.result); }
        catch (e) { UI.toast('Not a valid JSON file'); return; }
        UI.menu('Import ' + (file.name || 'backup'), [
          { label: 'Merge into current data', icon: ICON.upload, onClick: function () { doImport(parsed, 'merge'); } },
          { label: 'Replace everything', icon: ICON.trash, danger: true, onClick: function () {
            UI.confirm({ title: 'Replace all data?', message: 'Your current routines and history will be overwritten.', confirmText: 'Replace', danger: true })
              .then(function (ok) { if (ok) doImport(parsed, 'replace'); });
          } }
        ]);
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function doImport(parsed, mode) {
    try {
      DB.importAll(parsed, mode);
      App.applyTheme();
      S.emit();
      UI.toast(mode === 'replace' ? 'Data replaced' : 'Data merged');
    } catch (e) {
      UI.toast(e.message || 'Import failed');
    }
  }

  function reseed() {
    const have = {};
    DB.state.exercises.forEach(function (e) { have[e.id] = true; });
    let added = 0;
    App.seed.exercises().forEach(function (e) {
      if (!have[e.id]) { DB.state.exercises.push(e); added++; }
    });
    DB.saveNow('exercises');
    S.emit();
    UI.toast(added ? added + ' exercises restored' : 'Nothing was missing');
  }

  function wipe() {
    UI.confirm({
      title: 'Erase everything?',
      message: 'This permanently deletes all routines, workout history, custom exercises and settings on this device. Export a backup first if unsure.',
      confirmText: 'Erase all data', danger: true
    }).then(function (ok) {
      if (!ok) return;
      DB.wipe();
      DB.state.exercises = App.seed.exercises();
      DB.state.settings.firstRunDone = true;
      DB.saveNow();
      App.applyTheme();
      S.emit();
      UI.toast('All data erased');
      App.router.go('/', true);
    });
  }

  // Background rest alert: server push where possible, else the local
  // service-worker timer (Android, ≤ 5 min).
  function restAlertRow() {
    const P = App.push;
    const st = P.status();
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let meta, action = null;
    if (st === 'on') {
      meta = 'On — notification with sound + vibration when rest ends, even if the app is closed';
      action = el('button.pill', { text: 'Test', onclick: function () {
        P.schedule(Date.now() + 5000, 'This is a test — lock your phone now').then(function (ok) {
          UI.toast(ok ? 'Test alert in 5 seconds — lock the phone' : 'Could not reach the alert server');
        });
      } });
    } else if (st === 'off') {
      meta = 'Off — alert when rest ends while the app is in the background';
      action = el('button.pill', { text: 'Turn on', onclick: function () {
        P.enable().then(function (ok) {
          UI.toast(ok ? 'Rest alerts on' : 'Allow notifications for Lift to turn this on');
          App.store.emit();
        });
      } });
    } else if (st === 'blocked') {
      meta = 'Notifications are blocked — allow them for Lift in your phone’s Settings → Notifications';
    } else if (!standalone && /iPhone|iPad/.test(navigator.userAgent)) {
      meta = 'On iPhone this needs the app opened from the Home Screen (Share → Add to Home Screen)';
    } else {
      meta = 'Not available here' + ('Notification' in window ? ' — falls back to an alert for rests up to 5 min' : '');
    }
    return el('div.list-item', null, [
      el('div.grow', null, [el('div.name', { text: 'Rest alert in background' }), el('div.meta', { text: meta })]),
      action
    ]);
  }
  function storageKB() {
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('lift.') === 0) total += (localStorage.getItem(k) || '').length;
      }
    } catch (e) {}
    return Math.max(1, Math.round(total / 1024));
  }
})();
