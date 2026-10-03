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
      const vol = st.chimeVolume != null ? st.chimeVolume : 50;
      card.appendChild(el('div.list-item', null, [
        el('div.grow', null, [
          el('div.name', { text: 'Rest-end sound' }),
          el('div.meta', { text: 'Volume when the app is open (on top of your phone’s media volume). Tap Play to hear it.' })
        ]),
        el('button.pill', { text: vol + '%', 'aria-label': 'Rest-end volume', onclick: function (e) {
          const btn = e.currentTarget;
          UI.unlockAudio(); // the picker's Save is a tap, so the preview may play
          const values = [];
          for (let p = 10; p <= 100; p += 10) values.push(p);
          UI.wheelPicker({
            title: 'Rest-end volume',
            values: values,
            value: vol,
            label: function (p) { return p + '%'; },
            onDone: function (p) {
              DB.setSettings({ chimeVolume: p });
              btn.textContent = p + '%';
              UI.chime();
            }
          });
        } }),
        el('button.pill', { text: 'Play', style: { marginLeft: '6px' }, onclick: function () { UI.unlockAudio(); UI.chime(); UI.buzz([200, 100, 200]); } })
      ]));
      v.appendChild(card);

      // --- Data ---
      v.appendChild(el('div.section-label', { text: 'Cloud backup' }));
      v.appendChild(backupCard());

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

  // ---------- cloud backup ----------
  function backupCard() {
    const B = App.backup;
    const card = el('div.card', { style: { padding: '4px 14px' } });
    if (!B.available()) {
      card.appendChild(el('div.list-item', null, [el('div.grow', null, [el('div.meta', { text: 'Cloud backup isn’t available here.' })])]));
      return card;
    }
    if (B.account()) {
      const acct = B.account(), err = B.lastError();
      card.appendChild(el('div.list-item', null, [
        el('div.grow', null, [
          el('div.name', { text: 'Signed in as ' + (acct.email || acct.name || 'Google account') }),
          el('div.meta', { text: err
            ? 'Last sync failed (' + err + ')'
            : (B.lastAt() ? 'Synced ' + U.relDay(B.lastAt()).toLowerCase() + ' at ' + U.fmtTime(B.lastAt()) + ' — restore on any phone by signing in' : 'Syncing…') })
        ]),
        el('button.pill', { text: 'Sync now', onclick: function () {
          B.now().then(function (ok) {
            UI.toast(ok ? 'Synced' : (B.lastError() ? 'Sync failed: ' + B.lastError() : 'Already up to date'));
            App.store.emit();
          });
        } })
      ]));
      card.appendChild(el('button.list-item', { style: { width: '100%', textAlign: 'left' }, onclick: function () {
        UI.confirm({ title: 'Sign out?', message: 'Your data stays on this phone and in your Google account; this phone just stops syncing.', confirmText: 'Sign out' })
          .then(function (ok) { if (ok) { B.signOut(); App.store.emit(); } });
      } }, [el('div.grow', null, [el('div.name', { text: 'Sign out' })])]));
      return card;
    }
    if (!B.isOn()) {
      if (B.googleAvailable()) {
        card.appendChild(el('div.list-item', null, [
          el('div.grow', null, [
            el('div.name', { text: 'Sign in with Google' }),
            el('div.meta', { text: 'Your workouts sync to your Google account automatically — sign in on any phone to get them back.' })
          ]),
          el('button.pill.google-btn', { html: googleG() + 'Continue', onclick: App.backup.signIn })
        ]));
      }
      card.appendChild(el('div.list-item', null, [
        el('div.grow', null, [
          el('div.name', { text: B.googleAvailable() ? 'Or use a recovery code' : 'Off' }),
          el('div.meta', { text: 'No account: backups are encrypted with a code only you have. Keep the code safe.' })
        ]),
        el('button.pill', { text: 'Turn on', onclick: App.backupUI.enable })
      ]));
    } else {
      const err = B.lastError();
      card.appendChild(el('div.list-item', null, [
        el('div.grow', null, [
          el('div.name', { text: 'On' }),
          el('div.meta', { text: err
            ? 'Last try failed (' + err + ') — retries automatically when you’re online'
            : (B.lastAt() ? 'Last backup ' + U.relDay(B.lastAt()).toLowerCase() + ' at ' + U.fmtTime(B.lastAt()) : 'Waiting for first backup…') })
        ]),
        el('button.pill', { text: 'Back up now', onclick: function () {
          B.now().then(function (ok) {
            UI.toast(ok ? 'Backed up' : (B.lastError() ? 'Backup failed: ' + B.lastError() : 'Already up to date'));
            App.store.emit();
          });
        } })
      ]));
      card.appendChild(el('button.list-item', { style: { width: '100%', textAlign: 'left' }, onclick: function () { App.backupUI.showCode(B.code(), false); } }, [
        el('div.grow', null, [el('div.name', { text: 'Show recovery code' }), el('div.meta', { text: 'You need it to restore on a new phone' })])
      ]));
    }
    card.appendChild(el('button.list-item', { style: { width: '100%', textAlign: 'left' }, onclick: App.backupUI.restore }, [
      el('div.grow', null, [el('div.name', { text: 'Restore from a code' }), el('div.meta', { text: 'Bring back your data on this phone' })])
    ]));
    return card;
  }

  function googleG() {
    return '<svg viewBox="0 0 48 48" width="15" height="15" style="vertical-align:-3px;margin-right:6px"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.4-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.4 2.2-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
  }

  // Back from Google: keep the session, then reconcile phone vs cloud.
  App.router.add('/signin/:token', function (ctx) {
    if (!App.backup.acceptSession(ctx.params.token)) { UI.toast('Sign-in failed — try again'); App.router.go('/settings', true); return; }
    App.router.go('/settings', true);
    UI.toast('Signed in — checking your cloud data…');
    App.backup.fetchCloud().then(function (cloud) {
      if (!cloud) return App.backup.now().then(function () { UI.toast('Signed in — your workouts now sync to your Google account', 3000); App.store.emit(); });
      const cd = cloud.obj.data || {};
      const cloudN = (cd.workouts || []).length;
      if (!App.store.workouts().length) {
        return App.backup.adopt(cloud, 'replace').then(function () { App.applyTheme(); UI.toast('Restored ' + U.pluralize(cloudN, 'workout'), 3000); App.router.go('/', true); });
      }
      reconcile(cloud);
    }).catch(function (e) { UI.toast(e.message || 'Couldn’t reach the server'); App.store.emit(); });
  }, { tab: 'settings' });

  App.router.add('/signin-error/:why', function (ctx) {
    const why = decodeURIComponent(ctx.params.why);
    UI.toast(why === 'cancelled' || why === 'access_denied' ? 'Sign-in cancelled' : 'Sign-in failed (' + why + ')', 3500);
    App.router.go('/settings', true);
  }, { tab: 'settings' });

  // Data on this phone and in the account: combine (union by id), or pick one.
  function reconcile(cloud) {
    const cd = cloud.obj.data || {};
    let chosen = false, ref;
    const pick = function (fn) { return function () { chosen = true; ref.close(); fn(); }; };
    const done = function (msg) { return function () { App.applyTheme(); UI.toast(msg, 3000); App.store.emit(); }; };
    ref = UI.sheet({
      title: 'You have workouts here and in your account',
      body: el('div', null, [
        el('ul.change-list', null, [
          el('li', { text: 'This phone: ' + U.pluralize(App.store.workouts().length, 'workout') + ', ' + U.pluralize(App.store.routines().length, 'routine') }),
          el('li', { text: 'Your account: ' + U.pluralize((cd.workouts || []).length, 'workout') + ', ' + U.pluralize((cd.routines || []).length, 'routine') +
            ' (saved ' + U.fmtDate(cloud.t, { day: 'numeric', month: 'short' }) + ')' })
        ]),
        el('p.faint.tiny', { text: 'Combining keeps everything from both — nothing is duplicated or lost.', style: { margin: '10px 2px 0' } })
      ]),
      footer: el('div', null, [
        el('button.btn.primary', { text: 'Combine both', onclick: pick(function () { App.backup.adopt(cloud, 'merge').then(done('Combined and synced')); }) }),
        el('button.btn.ghost', { text: 'Use my account’s data', style: { marginTop: '8px' }, onclick: pick(function () { App.backup.adopt(cloud, 'replace').then(done('Loaded from your account')); }) }),
        el('button.btn.ghost', { text: 'Keep this phone’s data', style: { marginTop: '8px' }, onclick: pick(function () { App.backup.now().then(done('This phone’s data is now in your account')); }) })
      ]),
      onClose: function () { if (!chosen) { App.backup.signOut(); UI.toast('Not synced — sign in again when ready'); App.store.emit(); } }
    });
  }

  App.backupUI = {
    enable: function () {
      UI.toast('Creating your backup…');
      App.backup.enable().then(function (code) {
        App.backupUI.showCode(code, true);
        App.store.emit();
      });
    },

    showCode: function (code, isNew) {
      let ref;
      ref = UI.sheet({
        title: isNew ? 'Save your recovery code' : 'Your recovery code',
        body: el('div', null, [
          el('div.code-box', { text: code }),
          el('p.muted.tiny', { style: { margin: '10px 2px 0', lineHeight: '1.5' }, text:
            'This code is the only way to restore your data on a new phone. Your backup is encrypted with it — nobody else, including the app, can read it or reset it. Save it now: screenshot, Notes, or your password manager.' })
        ]),
        footer: el('div', null, [
          el('button.btn.primary', { text: 'Copy code', onclick: function () {
            (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(
              function () { UI.toast('Copied'); },
              function () { UI.toast('Long-press the code to copy it'); });
          } }),
          el('button.btn.ghost', { text: isNew ? 'I’ve saved it' : 'Done', style: { marginTop: '8px' }, onclick: function () { ref.close(); } })
        ])
      });
    },

    restore: function () {
      const input = el('input.input', { type: 'text', placeholder: 'LIFT-XXXXX-XXXXX-XXXXX-XXXXX', autocapitalize: 'characters', autocomplete: 'off', spellcheck: false });
      const status = el('div.tiny', { style: { margin: '8px 2px 0', minHeight: '18px' } });
      let ref;
      const go = el('button.btn.primary', { text: 'Find backup', onclick: function () {
        status.textContent = 'Looking…'; status.style.color = 'var(--text-dim)';
        App.backup.fetchBackup(input.value).then(function (f) {
          ref.close();
          confirmRestore(f);
        }, function (e) {
          status.textContent = e.message; status.style.color = 'var(--bad)';
        });
      } });
      ref = UI.sheet({
        title: 'Restore from a code',
        body: el('div', null, [input, status]),
        footer: go
      });
      setTimeout(function () { input.focus(); }, 250);
    }
  };

  function confirmRestore(f) {
    const d = f.obj.data || {};
    const n = function (k) { return (d[k] || []).length; };
    UI.confirm({
      title: 'Restore this backup?',
      message: 'Backup from ' + U.fmtDate(f.t, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + U.fmtTime(f.t) + ': ' +
        U.pluralize(n('workouts'), 'workout') + ', ' + U.pluralize(n('routines'), 'routine') +
        '. It replaces everything on this phone, and this phone will keep backing up to it.',
      confirmText: 'Restore'
    }).then(function (ok) {
      if (!ok) return;
      App.backup.restore(f).then(function () {
        App.applyTheme();
        UI.toast('Restored');
        App.router.go('/', true);
      });
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
