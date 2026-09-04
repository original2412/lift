/* global window, document */
(function () {
  'use strict';
  const App = (window.App = window.App || {});

  const routes = [];
  let currentUnsub = null;
  let currentCleanup = null;

  function add(pattern, handler, opts) {
    // pattern: '/exercise/:id'  ->  regex + param names
    const names = [];
    const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, function (m) {
      names.push(m.slice(1));
      return '([^/]+)';
    }).replace(/\//g, '\\/') + '$');
    routes.push({ rx: rx, names: names, handler: handler, opts: opts || {} });
  }

  function parseHash() {
    let h = location.hash || '#/';
    if (h[0] === '#') h = h.slice(1);
    if (h[0] !== '/') h = '/' + h;
    return h;
  }

  function resolve(path) {
    for (let i = 0; i < routes.length; i++) {
      const m = path.match(routes[i].rx);
      if (m) {
        const params = {};
        routes[i].names.forEach(function (n, idx) { params[n] = decodeURIComponent(m[idx + 1]); });
        return { route: routes[i], params: params };
      }
    }
    return null;
  }

  const Router = {
    add: add,

    go: function (path, replace) {
      const target = '#' + path;
      if (replace) location.replace(target);
      else location.hash = path;
    },

    back: function (fallback) {
      if (history.length > 1) history.back();
      else Router.go(fallback || '/', true);
    },

    render: function () {
      const path = parseHash();
      const match = resolve(path) || resolve('/');
      const view = document.getElementById('view');
      const tabbar = document.getElementById('tabbar');

      // tear down previous view
      if (currentUnsub) { currentUnsub(); currentUnsub = null; }
      if (currentCleanup) { try { currentCleanup(); } catch (e) {} currentCleanup = null; }

      const ctx = {
        params: match.params,
        el: view,
        // let a view re-render itself on store changes
        bind: function (renderFn) {
          renderFn();
          currentUnsub = App.store.subscribe(function () {
            // only re-render if still on same hash
            if (parseHash() === path) renderFn();
          });
        },
        onLeave: function (fn) { currentCleanup = fn; }
      };

      view.scrollTop = 0;
      window.scrollTo(0, 0);
      App.ui.clear(view);

      const hideTabbar = !!match.route.opts.fullscreen;
      tabbar.hidden = hideTabbar;
      view.classList.toggle('no-tabbar', hideTabbar);

      // active tab highlight
      const activeTab = match.route.opts.tab;
      Array.prototype.forEach.call(tabbar.querySelectorAll('.tab'), function (a) {
        a.classList.toggle('on', a.dataset.tab === activeTab);
      });

      try {
        match.route.handler(ctx);
      } catch (e) {
        console.error('view error', e);
        App.ui.clear(view);
        view.appendChild(App.ui.el('div.empty', { html: 'Something went wrong.<br><span class="tiny">' + App.utils.escape(e.message) + '</span>' }));
      }

      App.updateResumeBar && App.updateResumeBar();
    }
  };

  window.addEventListener('hashchange', Router.render);
  App.router = Router;
})();
