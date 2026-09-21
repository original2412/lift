/* global window */
(function () {
  'use strict';
  const App = window.App;

  // Server in push-server/. url is empty until it's deployed — then push is
  // simply "unsupported" and the service-worker timer fallback is used.
  const CFG = {
    url: '',
    vapidPublicKey: 'BIcjAsrher16c2uBtNzIKG6B_JPm4J-3zgUbhibipbcvN6EM0cqgteZEB6Gy1THJMyIgihzhpvDX99UXjU5RjOc'
  };
  const LS_KEY = 'lift.v1.push';

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  const state = load();
  if (!state.id) {
    const rnd = new Uint8Array(16);
    crypto.getRandomValues(rnd);
    state.id = 'd' + Array.prototype.map.call(rnd, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    save();
  }

  function keyBytes(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function post(path, data) {
    // keepalive: the request still goes out if the phone is locked right after the tap
    return fetch(CFG.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      keepalive: true
    }).then(function (r) { return r.ok; }, function () { return false; });
  }

  const Push = {
    // iOS only exposes PushManager to apps opened from the Home Screen.
    supported: function () {
      return !!CFG.url && location.protocol === 'https:' &&
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    },

    // 'unsupported' | 'blocked' | 'on' | 'off'
    status: function () {
      if (!Push.supported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'blocked';
      if (Notification.permission === 'granted' && state.sub) return 'on';
      return 'off';
    },

    ready: function () { return Push.status() === 'on'; },

    // Must be called from a tap: requestPermission() runs before any await.
    enable: function () {
      if (!Push.supported()) return Promise.resolve(false);
      const perm = Notification.permission === 'granted'
        ? Promise.resolve('granted')
        : Notification.requestPermission();
      return perm.then(function (p) {
        if (p !== 'granted') return false;
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) {
            return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CFG.vapidPublicKey) });
          });
        }).then(function (sub) {
          state.sub = sub.toJSON();
          save();
          return true;
        });
      }).catch(function (e) {
        console.warn('push enable failed', e);
        return false;
      });
    },

    // On boot: the browser may have rotated or dropped the subscription.
    refresh: function () {
      if (!Push.supported() || Notification.permission !== 'granted') return;
      navigator.serviceWorker.ready
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) { state.sub = sub ? sub.toJSON() : null; save(); })
        .catch(function () {});
    },

    schedule: function (endsAt, body) {
      return post('/schedule', {
        id: state.id,
        subscription: state.sub,
        endsAt: endsAt,
        title: 'Rest over — next set',
        body: body,
        url: location.origin + location.pathname + '#/workout'
      });
    },

    cancel: function () { return post('/cancel', { id: state.id }); }
  };

  App.push = Push;
})();
