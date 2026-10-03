/* global window */
// Automatic, end-to-end encrypted cloud backup.
//
// A random recovery code (100 bits, e.g. LIFT-K7Q2M-9XRTA-…) is the only
// secret. From it we derive:
//   - the backup id  = SHA-256("lift-id:" + code)   → where it's stored
//   - the AES key    = HKDF(code, "lift-backup-v1") → what encrypts it
// The server (push-server/) stores only ciphertext under the id, so it can't
// read the data or tie it to a person. Entering the code on another phone
// finds and decrypts the same backup. Lose both the phone and the code and
// the data is gone — that's the trade for nobody else being able to read it.
(function () {
  'use strict';
  const App = window.App;
  const DB = App.db, S = App.store;
  const LS_KEY = 'lift.v1.backup';
  // 32 symbols, no 0/O/1/I to avoid misreading
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_LEN = 20;

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  const state = load();
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  const enc = new TextEncoder();

  function normalize(code) {
    let c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.indexOf('LIFT') === 0 && c.length === CODE_LEN + 4) c = c.slice(4);
    if (c.length !== CODE_LEN) return null;
    for (let i = 0; i < c.length; i++) if (ALPHABET.indexOf(c[i]) < 0) return null;
    return c;
  }
  function format(norm) { return 'LIFT-' + norm.match(/.{5}/g).join('-'); }

  function newCode() {
    const bytes = new Uint8Array(CODE_LEN);
    crypto.getRandomValues(bytes);
    let s = '';
    for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[bytes[i] & 31];
    return s;
  }

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function derive(norm) {
    return Promise.all([
      crypto.subtle.digest('SHA-256', enc.encode('lift-id:' + norm)).then(hex),
      crypto.subtle.importKey('raw', enc.encode(norm), 'HKDF', false, ['deriveKey']).then(function (ikm) {
        return crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('lift-backup-v1'), info: enc.encode('aes-gcm') },
          ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      })
    ]).then(function (r) { return { id: r[0], key: r[1] }; });
  }

  function gz(bytes, decompress) {
    const Stream = decompress ? window.DecompressionStream : window.CompressionStream;
    return new Response(new Blob([bytes]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer()
      .then(function (b) { return new Uint8Array(b); });
  }
  const canGzip = !!(window.CompressionStream && window.DecompressionStream);

  function encrypt(key, plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return (canGzip ? gz(plain) : Promise.resolve(plain)).then(function (body) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, body);
    }).then(function (ct) {
      return { v: 1, gz: canGzip, iv: b64(iv), data: b64(new Uint8Array(ct)), t: Date.now() };
    });
  }

  function decrypt(key, box) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data))
      .then(function (pt) { pt = new Uint8Array(pt); return box.gz ? gz(pt, true) : pt; })
      .then(function (bytes) { return JSON.parse(new TextDecoder().decode(bytes)); });
  }

  function url(id) { return Backup.url + '/backup/' + id; }

  // The data that matters (no timestamps that change on every export).
  function snapshot() {
    const all = DB.exportAll();
    return JSON.stringify({ app: all.app, version: all.version, data: all.data });
  }

  let timer = 0, running = false, again = false;

  const Backup = {
    url: App.SERVER_URL || '',

    available: function () { return !!Backup.url && !!(window.crypto && crypto.subtle); },
    isOn: function () { return !!state.code; },
    code: function () { return state.code ? format(state.code) : null; },
    lastAt: function () { return state.lastAt || 0; },
    lastError: function () { return state.lastError || null; },

    // Turn on with a fresh code and upload right away. Resolves the code.
    enable: function () {
      state.code = newCode();
      state.lastHash = null;
      save();
      return Backup.now().then(function () { return format(state.code); });
    },

    disable: function () {
      state.code = null; state.lastHash = null; state.lastAt = 0; state.lastError = null;
      save();
    },

    // Upload if anything changed since the last successful backup.
    now: function () {
      if (!state.code || !Backup.available()) return Promise.resolve(false);
      if (running) { again = true; return Promise.resolve(false); }
      running = true;
      const plain = snapshot();
      let hash;
      return crypto.subtle.digest('SHA-256', enc.encode(plain)).then(function (h) {
        hash = hex(h);
        if (hash === state.lastHash) return false;
        return derive(state.code).then(function (k) {
          return encrypt(k.key, enc.encode(plain)).then(function (box) {
            return fetch(url(k.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(box) });
          });
        }).then(function (res) {
          if (!res.ok) throw new Error('server ' + res.status);
          state.lastHash = hash; state.lastAt = Date.now(); state.lastError = null;
          save();
          return true;
        });
      }).catch(function (e) {
        state.lastError = e.message || 'offline';
        save();
        return false;
      }).then(function (r) {
        running = false;
        if (again) { again = false; Backup.schedule(); }
        return r;
      });
    },

    schedule: function () {
      if (!state.code) return;
      clearTimeout(timer);
      timer = setTimeout(Backup.now, 4000);
    },

    // Fetch + decrypt the backup for a code. Resolves { data, t } or rejects
    // with a user-facing message.
    fetchBackup: function (code) {
      const norm = normalize(code);
      if (!norm) return Promise.reject(new Error('That doesn’t look like a Lift code (LIFT- and 20 letters/digits)'));
      return derive(norm).then(function (k) {
        return fetch(url(k.id), { cache: 'no-store' }).then(function (res) {
          if (res.status === 404) throw new Error('No backup found for this code');
          if (!res.ok) throw new Error('Couldn’t reach the backup server');
          return res.json();
        }).then(function (box) {
          return decrypt(k.key, box).catch(function () { throw new Error('Couldn’t decrypt — check the code'); })
            .then(function (obj) { return { obj: obj, t: box.t, norm: norm }; });
        });
      }, function () { throw new Error('Couldn’t reach the backup server'); });
    },

    // Replace this phone's data with the backup and keep backing up to it.
    restore: function (fetched) {
      DB.importAll(fetched.obj, 'replace');
      state.code = fetched.norm;
      state.lastHash = null;
      state.lastAt = fetched.t;
      state.lastError = null;
      save();
      S.emit();
      return Backup.now();
    },

    dismissNudge: function () { state.nudgeDismissed = true; save(); },
    nudgeDismissed: function () { return !!state.nudgeDismissed; }
  };

  // Back up a few seconds after any change, and right away when the app is
  // backgrounded (iOS may not give us another chance).
  S.subscribe(function () { Backup.schedule(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state.code) { clearTimeout(timer); Backup.now(); }
  });

  App.backup = Backup;
})();
