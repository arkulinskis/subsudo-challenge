/* core.js: the shared front-end engine (window.UI). Same in every app made from APP_MAKER/template;
   app-specific things live in web/app.js (brand, nav, footer) and web/pages/*.html (the pages).

   Pages:   UI.page(name, {title, nav, icon, auth, order, chrome}, mount)
              auth: null (anyone) | 'guest' (signed-out only) | 'user' | 'admin'
              nav: label for the header / phone tab bar (omit to keep it out of the menus)
              mount(view, ctx) draws into `view`; ctx = {args, me, go, api}. Return a Promise (the page
              is "ready" when it resolves) or {ready, destroy}. URLs are #name/arg1/arg2.
   Server:  UI.api(fn, ...args) -> Promise of the server function's return value. A reply of
              {ok: false, error} rejects with that message (shown as a toast unless you .catch it).
            UI.apiQuiet(fn, ...args) is the same without Anvil's loading spinner.
   Auth:    UI.auth('login'|'signup'|'reset'|'logout', {...}) -> Promise of {ok, me, message}
   Helpers: UI.esc, UI.icon, UI.toast, UI.modal, UI.confirm, UI.busy, UI.formData, UI.fmtDate, UI.ago,
            UI.store, UI.setTheme, UI.feedback, UI.go, UI.refresh
   Tests:   window.UI_READY is true when the current page has finished loading. */
(function () {
  'use strict';
  if (window.UI && window.UI.__v) return;
  var UI = window.UI = { __v: 1, pages: {}, me: null, config: { name: 'App', key: 'app', home: 'home', landing: 'landing' } };
  window.UI_READY = false;

  UI.configure = function (cfg) { Object.keys(cfg).forEach(function (k) { UI.config[k] = cfg[k]; }); };

  /* ------------------------------------------------------------------ small helpers */
  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  UI.initials = function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.fmtDate = function (iso, opts) {
    if (!iso) return '';
    var d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  };
  UI.fmtDateTime = function (iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  };
  UI.ago = function (iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    var steps = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']], n = s / 60;
    for (var i = 0; i < steps.length; i++) {
      if (n < steps[i][0]) { n = Math.floor(n); return UI.plural(n, steps[i][1]) + ' ago'; }
      n = n / steps[i][0];
    }
    return '';
  };
  UI.store = {
    get: function (k, dflt) { try { var v = localStorage.getItem(UI.config.key + '.' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
    set: function (k, v) { try { localStorage.setItem(UI.config.key + '.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  UI.formData = function (form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };
  /* Disable a button while a Promise runs; returns the Promise. */
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2.2.6 3.5 2.4 3.5 5.3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5.5 7.5 4M15 5.5 16.5 4M7 13H3M21 13h-4M7.5 18l-3 2M16.5 18l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };
  UI.ICONS = ICONS;
  UI.icon = function (name, cls) {
    return '<svg class="ui-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sparkle) + '</svg>';
  };

  /* ------------------------------------------------------------------ toasts, modals */
  UI.toast = function (msg, kind) {
    var box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui ui-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.innerHTML = (kind === 'error' ? UI.icon('info') : kind === 'ok' ? UI.icon('check') : '') + '<span>' + UI.esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'error' ? 6500 : 3200);
  };
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<button class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
    document.body.appendChild(wrap);
    document.documentElement.classList.add('ui-modal-open');
    function key(e) { if (e.key === 'Escape') close(); }
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove(); document.removeEventListener('keydown', key);
      if (!document.querySelector('.ui-modal-wrap')) document.documentElement.classList.remove('ui-modal-open');
      if (opts.onclose) opts.onclose();
      if (prev && prev.focus) prev.focus();
    }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    var first = wrap.querySelector('input, textarea, select');
    setTimeout(function () { (first || wrap.querySelector('.ui-modal')).focus && (first || wrap.querySelector('.ui-modal')).focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return new Promise(function (resolve) {
      var answered = false;
      var m = UI.modal('<h2>' + UI.esc(o.title || 'Are you sure?') + '</h2>' + (o.text ? '<p class="muted">' + UI.esc(o.text) + '</p>' : '') +
        '<div class="ui-row end" style="margin-top:20px"><button class="ui-btn ghost" data-close>' + UI.esc(o.cancel || 'Cancel') + '</button>' +
        '<button class="ui-btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok>' + UI.esc(o.ok || 'OK') + '</button></div>',
      { onclose: function () { if (!answered) resolve(false); } });
      m.el.querySelector('[data-ok]').onclick = function () { answered = true; m.close(); resolve(true); };
    });
  };

  /* ------------------------------------------------------------------ theme */
  UI.theme = function () { return UI.store.get('theme', 'auto'); };
  UI.applyTheme = function (t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('ui-dark', !!dark);
  };
  UI.setTheme = function (t) { UI.store.set('theme', t); UI.applyTheme(t); };
  UI.applyTheme(UI.theme());
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { UI.applyTheme(UI.theme()); }); } catch (e) {}
  }

  /* ------------------------------------------------------------------ server bridge */
  var bridge = null;
  function send(kind, payload) {
    if (!bridge) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = bridge(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(out).then(function (r) {
      r = typeof r === 'string' ? JSON.parse(r) : (r || {});
      if (r.error) {
        var err = new Error(r.error); err.uiApi = true; err.denied = !!r.denied;
        if (r.detail) console.error(kind, payload && payload.fn, r.detail);
        if (r.reload) setTimeout(function () { location.reload(); }, 2500);
        throw err;
      }
      return r.result;
    });
  }
  function apiCall(quiet, fn, args) {
    return send('call', { fn: fn, args: args, quiet: quiet }).then(function (res) {
      if (res && typeof res === 'object' && res.ok === false) {
        var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
        throw err;
      }
      return res;
    });
  }
  UI.api = function (fn) { return apiCall(false, fn, Array.prototype.slice.call(arguments, 1)); };
  UI.apiQuiet = function (fn) { return apiCall(true, fn, Array.prototype.slice.call(arguments, 1)); };
  /* Errors nobody caught become a toast, so a failed action is never silent. */
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* Sign in / up / out. On success it navigates: to where the visitor was heading (UI.after) or home
     after signing in, to the landing page after signing out. */
  UI.auth = function (kind, payload) {
    return send(kind, payload || {}).then(function (r) {
      if (r && r.ok === false) { var err = new Error(r.error); err.uiApi = true; err.expected = true; throw err; }
      if (r && 'me' in r && (r.me || kind === 'logout')) {
        UI.me = r.me || null;
        var target = r.me ? (UI.after || '#' + UI.config.home) : '#' + UI.config.landing;
        UI.after = null;
        if (location.hash === target) route(); else location.hash = target;
      }
      return r;
    });
  };
  /* Update the signed-in user's details (e.g. a new name) and redraw the header, without reloading the page. */
  UI.setMe = function (me) {
    UI.me = me || null;
    if (shellRoot) renderChrome(current.name);
  };

  /* ------------------------------------------------------------------ pages and routing */
  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  UI.allowed = function (p) {
    if (!p) return false;
    if (p.auth === 'user') return !!UI.me;
    if (p.auth === 'admin') return !!(UI.me && UI.me.is_admin);
    if (p.auth === 'guest') return !UI.me;
    return true;
  };
  UI.navPages = function () {
    return Object.keys(UI.pages).map(function (k) { return UI.pages[k]; })
      .filter(function (p) { return p.nav && UI.allowed(p) && (!p.when || p.when()); })
      .sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
  };
  UI.parseHash = function () {
    var h = (location.hash || '').replace(/^#!?\/?/, '');
    var parts = h.split('?')[0].split('/').filter(function (x) { return x !== ''; }).map(decodeURIComponent);
    return { name: parts[0] || '', args: parts.slice(1) };
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function (name) {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h) route(); else location.hash = h;
  };
  UI.refresh = function () { route(); };
  UI.after = null;  // where to go after signing in

  var shellRoot = null, view = null, current = { name: null, destroy: null }, routeSeq = 0;

  function defaultPage() { return UI.me ? UI.config.home : UI.config.landing; }

  function route() {
    var r = UI.parseHash(), name = r.name || defaultPage(), p = UI.pages[name];
    if (!p) { name = defaultPage(); p = UI.pages[name]; r.args = []; }
    if (p.auth === 'guest' && UI.me) { p = UI.pages[UI.config.home]; name = UI.config.home; r.args = []; }
    if ((p.auth === 'user' || p.auth === 'admin') && !UI.me) {
      UI.after = location.hash && location.hash !== '#' ? location.hash : null;
      p = UI.pages.auth; name = 'auth'; r.args = [];
    }
    if (p.auth === 'admin' && !(UI.me && UI.me.is_admin)) {
      UI.toast('That page is for admins only.', 'error');
      p = UI.pages[UI.config.home]; name = UI.config.home; r.args = [];
    }
    var seq = ++routeSeq;
    window.UI_READY = false;
    if (current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    current = { name: name, args: r.args, destroy: null };
    if (shellRoot) {
      shellRoot.className = 'ui ui-shell page-' + name + (UI.me ? ' signed-in' : ' signed-out') + (p.chrome === false ? ' no-chrome' : '');
      renderChrome(name);
    }
    // A fresh element for every page, so listeners a page adds to `view` never pile up.
    var fresh = view.cloneNode(false);
    view.parentNode.replaceChild(fresh, view);
    view = fresh;
    window.scrollTo(0, 0);
    document.title = (p.title ? (typeof p.title === 'function' ? p.title(r.args) : p.title) + ' · ' : '') + UI.config.name;
    var ctx = { name: name, args: r.args, me: UI.me, go: UI.go, api: UI.api, page: p };
    var out;
    try { out = p.mount(view, ctx); } catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    if (out && out.destroy) current.destroy = out.destroy;
    Promise.resolve(ready).then(function () { if (seq === routeSeq) window.UI_READY = true; },
      function (e) {
        if (seq !== routeSeq) return;
        console.error(e);
        if (!view.innerHTML) view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') +
          '<h3>This page didn\'t load</h3><p class="muted">' + UI.esc(e && e.message || 'Something went wrong.') + '</p>' +
          '<button class="ui-btn" onclick="UI.refresh()">Try again</button></div></div>';
        window.UI_READY = true;
      });
  }
  UI.current = function () { return current; };

  /* The shell's parts come from web/app.js: UI.shell = {header(me, active), footer(me), tabbar(me, active)} */
  function renderChrome(active) {
    var S = UI.shell || {};
    var hd = shellRoot.querySelector('[data-ui-header]'), ft = shellRoot.querySelector('[data-ui-footer]'), tb = shellRoot.querySelector('[data-ui-tabbar]');
    if (hd) hd.innerHTML = S.header ? S.header(UI.me, active) : '';
    if (ft) ft.innerHTML = S.footer ? S.footer(UI.me, active) : '';
    if (tb) tb.innerHTML = S.tabbar ? S.tabbar(UI.me, active) : '';
  }
  UI.renderChrome = function () { if (shellRoot) renderChrome(current.name); };

  /* Called by client_code/Main.py (and by the local harness) once the page is up. */
  UI.start = function (node, bridgeFn, bootJson) {
    bridge = bridgeFn;
    var boot = typeof bootJson === 'string' ? JSON.parse(bootJson || '{}') : (bootJson || {});
    UI.me = boot.me || null;
    var host = node && node.matches && node.matches('[data-ui-app]') ? node : (node && node.querySelector('[data-ui-app]')) || node || document.body;
    host.innerHTML = '<div class="ui ui-shell">' +
      '<header class="ui-header" data-ui-header></header>' +
      '<main class="ui-main" data-ui-view></main>' +
      '<footer class="ui-footer" data-ui-footer></footer>' +
      '<nav class="ui-tabbar" data-ui-tabbar aria-label="Main"></nav></div>';
    shellRoot = host.firstChild;
    view = host.querySelector('[data-ui-view]');
    if (UI.shell && UI.shell.wire) UI.shell.wire(shellRoot);
    window.addEventListener('hashchange', route);
    route();
  };

  /* ------------------------------------------------------------------ feedback (footer + menu)
     All feedback goes to Prepsto. The widget tag in head.html (data-prepsto="CODE") slides its panel in;
     any [data-feedback] or [data-prepsto-open] element opens it. If the widget hasn't loaded, the panel opens in a new tab.
     There is no in-app feedback form any more: Admin -> Feedback only lists older messages (and app requests). */
  UI.feedback = function () {
    if (window.Prepsto && window.Prepsto.open) { window.Prepsto.open(); return; }
    var tag = document.querySelector('script[data-prepsto]');
    var code = tag && tag.getAttribute('data-prepsto');
    if (code && code.indexOf('__') !== 0) window.open('https://prepsto.com/#f/' + encodeURIComponent(code), '_blank', 'noopener');
    else UI.toast('Feedback is not set up yet.', 'error');
  };

  /* Shared clicks: [data-go="page/arg"], [data-feedback], [data-theme-set] anywhere in the app. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go],[data-feedback],[data-theme-set]');
    if (!el) return;
    if (el.hasAttribute('data-go')) { e.preventDefault(); UI.go.apply(null, el.getAttribute('data-go').split('/')); }
    else if (el.hasAttribute('data-feedback')) { e.preventDefault(); UI.feedback(el.getAttribute('data-feedback') || null); }
    else if (el.hasAttribute('data-theme-set')) { e.preventDefault(); UI.setTheme(el.getAttribute('data-theme-set')); if (UI.shell && UI.shell.onTheme) UI.shell.onTheme(); }
  });
})();


/* app.js: this app's identity and frame: name, header, footer, phone tab bar.
   Pages live in web/pages/*.html. The engine (window.UI) is web/core.js. */
(function () {
  'use strict';
  UI.configure({
    name: 'Subsudo',
    key: 'subsudo',          // prefix for this app's browser storage
    tagline: 'The virtual fight club. Bouts by mail, rankings by city.',   // footer line
    home: 'home',                // first page after signing in
    landing: 'landing'           // first page for visitors who aren't signed in
  });

  var esc = UI.esc;

  function brand() {
    return '<a class="ui-brand" href="#" data-go="' + (UI.me ? UI.config.home : UI.config.landing) + '" aria-label="' + esc(UI.config.name) + ' home">' +
      '<img src="_/theme/icon.svg" alt="" width="32" height="32"><span>' + esc(UI.config.name) + '</span></a>';
  }

  function themeSwitch() {
    var t = UI.theme();
    return '<div class="ui-seg" role="group" aria-label="Appearance">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return '<button type="button" data-theme-set="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function userMenu(me) {
    return '<div class="ui-menu" data-menu hidden>' +
      '<div class="ui-menu-head"><strong>' + esc(me.name) + '</strong><span class="muted small">' + esc(me.email) + '</span></div>' +
      '<a href="#profile" data-go="profile">' + UI.icon('user') + 'Fighter card</a>' +
      '<a href="#locker" data-go="locker">' + UI.icon('sparkle') + 'Locker room</a>' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<div class="ui-menu-block"><span class="small muted">Appearance</span>' + themeSwitch() + '</div>' +
      '<button type="button" data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button type="button" data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms</button>' +
      '<button type="button" data-signout>' + UI.icon('logout') + 'Sign out</button></div>';
  }

  UI.shell = {
    header: function (me, active) {
      var nav = UI.navPages();
      return '<div class="ui-header-in">' + brand() +
        (me ? '<nav class="ui-nav" aria-label="Main">' + nav.map(function (p) {
          return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
        }).join('') + '</nav>' : '') +
        '<div class="ui-header-right">' +
        (me ? '<button type="button" class="ui-avatar-btn" data-menu-toggle aria-label="Your account" aria-haspopup="true">' + esc(UI.initials(me.name)) + '</button>' + userMenu(me)
          : (active === 'auth' ? '' : '<a class="ui-btn ghost" href="#auth" data-go="auth">Sign in</a><a class="ui-btn primary" href="#auth/signup" data-go="auth/signup">Get started</a>')) +
        '</div></div>';
    },
    footer: function (me) {
      return '<div class="ui-footer-in"><div class="ui-footer-brand">' + brand() + '<p class="muted small">' + esc(UI.config.tagline) + '</p></div>' +
        '<div class="ui-footer-links">' +
        '<a href="#landing" data-go="landing">About</a>' +
        '<a href="https://prepsto.com/#f/z5yjpux" target="_blank" rel="noopener" data-prepsto-open>Submit feedback</a>' +
        '<button type="button" data-lk-open="overview">Privacy &amp; Terms</button>' +
        '</div><p class="ui-footer-legal small muted">© ' + new Date().getFullYear() + ' ' + esc(UI.config.name) + '</p></div>';
    },
    tabbar: function (me, active) {
      var nav = UI.navPages();
      if (!me || nav.length < 2) return '';
      return nav.slice(0, 4).map(function (p) {
        return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
      }).join('') + '<a href="#profile" class="' + (active === 'profile' ? 'on' : '') + '">' + UI.icon('user') + '<span>You</span></a>';
    },
    wire: function (root) {
      root.addEventListener('click', function (e) {
        var t = e.target.closest('[data-menu-toggle]');
        var menu = root.querySelector('[data-menu]');
        if (t && menu) { menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden)); return; }
        if (e.target.closest('[data-signout]')) { UI.auth('logout').then(function () { UI.toast('Signed out. See you soon!'); }); }
        if (menu && !menu.hidden && !e.target.closest('[data-menu] .ui-seg')) menu.hidden = true;
      });
      document.addEventListener('keydown', function (e) {
        var menu = root.querySelector('[data-menu]');
        if (e.key === 'Escape' && menu) menu.hidden = true;
      });
    },
    onTheme: function () {  // redraw the menu's Auto/Light/Dark buttons and keep the menu open
      var menu = document.querySelector('[data-menu]'), open = menu && !menu.hidden;
      UI.renderChrome();
      if (open) document.querySelector('[data-menu]').hidden = false;
    }
  };
})();


/* ===== _ss_core.html ===== */
(function () {
  'use strict';
  var esc = UI.esc;
  var SS = window.SS = window.SS || {};

  /* ------------------------------------------------------------------ icons for this app */
  Object.assign(UI.ICONS, {
    glove: '<path d="M7 14c-2-3-1.5-9 3.5-10.5C15 2.4 18.5 5 18.3 9.6 18.1 13 16.6 14.6 15 15H7z"/><path d="M7 14c-2 .2-3.6-1.4-3.2-3.2.3-1.4 2-1.7 2.7-.6"/><rect x="6.5" y="15" width="9" height="5" rx="1"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4"/><path d="M12 13v4M8 21h8M9.5 17h5v4h-5z"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    bag: '<path d="M4 9h16l-1 11H5z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/><path d="M4 13h16"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
    megaphone: '<path d="M3 10v4h3l7 4V6L6 10z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    send: '<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m10 13 4.5-4.5"/>',
    ranks: '<path d="M4 20V11h4v9M10 20V5h4v15M16 20v-6h4v6"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    house: '<path d="M3 11 12 4l9 7"/><path d="M6 10v10h12V10"/><rect x="10" y="14" width="4" height="6"/>'
  });

  /* ------------------------------------------------------------------ glove avatars */
  SS.GLOVES = { oxblood: '#8e1b1b', black: '#24211e', brass: '#c4912e', royal: '#2a47a6', white: '#efe8db', green: '#1f6b45' };
  SS.GLOVE_NAMES = { oxblood: 'Oxblood', black: 'Black', brass: 'Brass', royal: 'Royal blue', white: 'White', green: 'Green' };
  SS.gloveSvg = function (color) {
    var c = SS.GLOVES[color] || color || SS.GLOVES.oxblood;
    var light = color === 'white' || color === 'brass';
    var line = light ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.28)';
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M11 25C7 20 7 9.5 15 6.5 22.5 4 29.5 8.5 29.2 16 29 21.5 26.5 24.5 23.5 25.2z" fill="' + c + '"/>' +
      '<path d="M11.2 25.2C6.5 24.5 4.2 20 6 16.6c1.1-2 3.8-1.8 4.6.2.8 2 2.1 3.9 4.6 4.5" fill="' + c + '" stroke="' + line + '" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path d="M15 10c3-1.6 7-1.8 10-.2" fill="none" stroke="' + line + '" stroke-width="1.4" stroke-linecap="round"/>' +
      '<rect x="10.5" y="25" width="14" height="8" rx="1.6" fill="' + (light ? '#3a2d14' : '#d09b35') + '"/></svg>';
  };
  /* f: a fighter dict, or {name, house, guest} for the house / a guest */
  /* a fighter dict -> their Locker room face (with today's bout damage); the house and guests keep a glove */
  SS.avatar = function (f, size) {
    f = f || {};
    if (!f.house && !f.guest && !f.bare && (f.avatar || f.id) && SS.face) {
      var t = f.hurt ? ' title="' + esc((f.hurt.ko ? 'Seeing stars' : f.hurt.label) + ', ' + f.hurt.hours_left + 'h to heal') + '"' : '';
      return '<span class="ss-av face' + (size ? ' ' + size : '') + (f.hurt ? ' hurt' : '') + '"' + t + '>' +
        SS.face(f.avatar || SS.defaultFace(f.id || f.ring), { glove: f.glove, hurt: f.hurt }) + '</span>';
    }
    var cls = 'ss-av' + (size ? ' ' + size : '') + (f.house ? ' house' : '') + (f.guest ? ' guest' : '');
    var glove = f.house ? 'brass' : (f.glove || 'oxblood');
    return '<span class="' + cls + '">' + SS.gloveSvg(f.guest ? 'white' : glove) + '<b>' + (f.bare ? '' : esc(UI.initials(f.ring || f.name || '?'))) + '</b></span>';
  };

  /* ------------------------------------------------------------------ countries (Intl gives the names) */
  SS.COUNTRY_CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
    'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
    'OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
    'UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) {}
  SS.country = function (code) {
    if (!code) return '';
    try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; }
  };
  SS.countryOptions = function (selected) {
    var list = SS.COUNTRY_CODES.map(function (c) { return [c, SS.country(c)]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); });
    return '<option value="">Country…</option>' + list.map(function (c) {
      return '<option value="' + c[0] + '"' + (c[0] === selected ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
    }).join('');
  };
  SS.place = function (f) {
    if (!f || !f.city) return f && f.country ? '<span class="ss-cc">' + esc(f.country) + '</span>' : '';
    return esc(f.city) + (f.country ? '<span class="ss-cc" title="' + esc(SS.country(f.country)) + '">' + esc(f.country) + '</span>' : '');
  };
  SS.tier = function (name) { return '<span class="ss-tier t-' + String(name || '').toLowerCase().replace(/\s+/g, '-') + '">' + esc(name) + '</span>'; };
  SS.belts = function (list) {
    return (list || []).map(function (b) { return '<span class="ss-belt">' + esc(b === 'World' ? 'World belt' : b + ' belt') + '</span>'; }).join(' ');
  };
  SS.record = function (r) { return r ? r.w + '-' + r.l + '-' + r.d + (r.ko ? ' <span class="faint">(' + r.ko + ' KO)</span>' : '') : ''; };

  /* ------------------------------------------------------------------ bouts */
  SS.TYPE_NAMES = { s: 'Straight', u: 'Uppercut', h: 'Hook', b: 'Block' };
  SS.DEVICE_NAMES = { phone: 'Phone', camera: 'Camera', house: 'House', pads: 'Pads' };
  SS.boutName = function (side) { return side.fighter ? side.fighter.ring : side.name; };
  SS.sideAvatar = function (side, size) {
    return side.fighter ? SS.avatar(side.fighter, size) : SS.avatar({ name: side.name, house: side.house, guest: side.guest || !side.house }, size);
  };
  function sideHtml(b, key) {
    var s = b[key], won = b.result && b.result.winner === key;
    var name = s.fighter ? '<a class="ss-ring" href="#fighter/' + esc(s.fighter.id) + '" data-go="fighter/' + esc(s.fighter.id) + '">' + esc(s.fighter.ring) + '</a>'
      : '<span class="ss-ring">' + esc(s.name) + '</span>';
    var sub = s.fighter ? SS.place(s.fighter) : (s.house ? 'House · ' + esc(s.level || '') : (s.guest ? 'Guest' : (b.status === 'open' ? (b.city ? esc(b.city) + ' only' : 'Any city') : '')));
    var score = '';
    if (typeof s.score === 'number') score = '<div class="score' + (won ? ' win' : '') + '">' + s.score + '</div>';
    else if (s.recorded) score = '<div class="score sealed" title="Sealed until you fight back">???</div>';
    return '<div class="ss-side ' + key + '">' + SS.sideAvatar(s) + '<div class="who">' + name + '<div class="ss-sub">' + sub + '</div>' + score + '</div></div>';
  }
  SS.outcomeChip = function (b) {
    if (b.status !== 'done') return '';
    if (b.outcome) return '<span class="ss-out ' + b.outcome + '">' + (b.outcome === 'win' ? 'Won' : b.outcome === 'loss' ? 'Lost' : 'Draw') + '</span>';
    return '';
  };
  SS.statusText = function (b) {
    if (b.status === 'done') return esc(b.result.method_name) + ' · ' + UI.ago(b.finished);
    if (b.status === 'open') return 'Open call-out · ' + UI.ago(b.created);
    if (b.status === 'pending') {
      if (b.my_side === 'b') return 'Answer by ' + esc(UI.fmtDate(b.expires, { day: 'numeric', month: 'short' }));
      return 'Waiting for ' + esc(SS.boutName(b.b)) + ' · sent ' + UI.ago(b.created);
    }
    return { declined: 'Ducked', cancelled: 'Cancelled', expired: 'Expired, no answer' }[b.status] || esc(b.status);
  };
  /* opts: {words: true, unread: bool, cta: html} */
  SS.boutCard = function (b, opts) {
    opts = opts || {};
    var cta = opts.cta != null ? opts.cta : (b.can_answer ? '<a class="ui-btn primary sm" href="#fight/answer/' + esc(b.id) + '" data-go="fight/answer/' + esc(b.id) + '">' +
      UI.icon('glove') + (b.status === 'open' ? 'Take it' : 'Fight back') + '</a>' : '<a class="ui-btn sm" href="#bout/' + esc(b.id) + '" data-go="bout/' + esc(b.id) + '">' +
      (b.status === 'done' ? 'Scorecards' : 'Open') + '</a>');
    var words = opts.words !== false && b.a.words && b.status !== 'done' ? '<p class="ss-words">' + esc(b.a.words) + '</p>' : '';
    return '<article class="ss-bout' + (b.kind === 'house' ? ' house' : '') + (opts.unread ? ' unread' : '') + '" data-bout="' + esc(b.id) + '">' +
      sideHtml(b, 'a') + '<div class="ss-vs">VS</div>' + sideHtml(b, 'b') + words +
      '<div class="ss-bout-foot"><span class="ui-badge' + (b.kind === 'house' ? ' brass' : b.kind === 'invite' ? ' brand' : '') + '">' + esc(b.kind_label) + '</span>' +
      '<span class="ui-badge">' + UI.icon('timer') + b.secs + 's</span>' + (b.campaign && b.campaign.bonus ? '<span class="ui-badge good">+' + b.campaign.bonus + ' bonus</span>' : '') +
      SS.outcomeChip(b) + '<span class="small muted">' + SS.statusText(b) + '</span><span class="ss-spacer"></span>' + cta + '</div></article>';
  };

  SS.poster = function (b) {
    function side(k) {
      var s = b[k], sc = typeof s.score === 'number' ? '<div class="sc' + (b.result && b.result.winner === k ? ' win' : '') + '">' + s.score + '</div>'
        : (s.recorded ? '<div class="sc sealed" title="Sealed until the answer">???</div>' : '<div class="sc sealed">–</div>');
      var name = s.fighter ? '<a class="ss-ring" href="#fighter/' + esc(s.fighter.id) + '" data-go="fighter/' + esc(s.fighter.id) + '">' + esc(s.fighter.ring) + '</a>'
        : '<span class="ss-ring">' + esc(s.name) + '</span>';
      var sub = s.fighter ? SS.place(s.fighter) + ' · ' + s.fighter.rating : (s.house ? 'House fighter · ' + esc(s.level || '') : (s.guest ? 'Guest' : (b.status === 'open' ? 'Anyone' : '')));
      var delta = '';
      if (b.status === 'done' && (s.points || s.rating_delta)) {
        delta = '<div class="delta">' + (s.points ? '+' + s.points + ' pts' : '') + (s.rating_delta ? (s.points ? ' · ' : '') + (s.rating_delta > 0 ? '+' : '') + s.rating_delta + ' rating' : '') + '</div>';
      }
      return '<div>' + SS.sideAvatar(s, 'lg') + name + '<div class="ss-sub">' + sub + '</div>' + sc + delta + '</div>';
    }
    return '<div class="ss-poster">' + side('a') + '<div class="ss-vs">VS</div>' + side('b') + '</div>';
  };

  /* punch timeline: one lane per fighter, a tick per punch (taller = faster), blocks below the line */
  SS.TYPE_COLORS = { s: '#c4362b', h: '#d09b35', u: '#2a47a6', b: '#8f8578' };
  SS.timeline = function (b) {
    var W = window.innerWidth < 640 ? 480 : 1000, laneH = 70, secs = b.secs, lanes = [['a', b.a], ['b', b.b]].filter(function (l) { return l[1].events; });
    if (!lanes.length) return '';
    var H = lanes.length * (laneH + 34) + 20, out = '';
    lanes.forEach(function (l, i) {
      var y0 = 26 + i * (laneH + 34), base = y0 + laneH * 0.72, phone = l[1].device === 'phone';
      out += '<text x="0" y="' + (y0 - 8) + '" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="17" fill="currentColor" opacity=".75">' +
        esc(SS.boutName(l[1]).toUpperCase()) + ' · ' + esc((SS.DEVICE_NAMES[l[1].device] || '').toUpperCase()) + '</text>';
      out += '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" stroke="currentColor" stroke-opacity=".25" stroke-width="1.5"/>';
      if (phone) out += '<line x1="' + W / 2 + '" x2="' + W / 2 + '" y1="' + y0 + '" y2="' + (y0 + laneH) + '" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="4 4"/>' +
        '<text x="' + (W / 2 - 6) + '" y="' + (y0 + 12) + '" text-anchor="end" font-size="13" fill="currentColor" opacity=".55">RIGHT</text>' +
        '<text x="' + (W / 2 + 6) + '" y="' + (y0 + 12) + '" font-size="13" fill="currentColor" opacity=".55">LEFT</text>';
      l[1].events.forEach(function (e) {
        var x = Math.min(W - 2, Math.max(2, e[0] / (secs * 1000) * W));
        if (e[2] === 'b') out += '<rect x="' + (x - 2) + '" y="' + (base + 4) + '" width="4" height="12" rx="1" fill="' + SS.TYPE_COLORS.b + '"/>';
        else {
          var h = 8 + (Math.min(e[3], 13) / 13) * (laneH * 0.72 - 10);
          out += '<rect x="' + (x - 2.2) + '" y="' + (base - h) + '" width="4.4" height="' + h + '" rx="1.5" fill="' + SS.TYPE_COLORS[e[2]] + '" opacity=".9"/>';
        }
      });
    });
    return '<div class="ss-tl"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Punch timeline">' + out + '</svg><div class="legend">' +
      ['s', 'h', 'u', 'b'].map(function (k) { return '<span><i style="background:' + SS.TYPE_COLORS[k] + '"></i>' + SS.TYPE_NAMES[k] + 's</span>'; }).join('') +
      '<span>Taller = faster</span></div></div>';
  };

  SS.resultHtml = function (b) {
    var r = b.result, A = SS.boutName(b.a), Bn = SS.boutName(b.b);
    var mine = b.outcome, head;
    if (r.winner === 'draw') head = '<div class="ss-stamp draw">Draw</div>';
    else {
      var short = { ko: 'KO!', tko: 'TKO', ud: 'Decision', sd: 'Split decision', md: 'Majority' }[r.method] || 'Decision';
      head = '<div class="ss-stamp ' + (mine === 'win' ? 'win' : mine === 'loss' ? '' : 'win') + '">' + esc(mine === 'win' ? 'You win · ' + short : mine === 'loss' ? 'You lose · ' + short : short) + '</div>';
    }
    var winnerName = r.winner === 'a' ? A : r.winner === 'b' ? Bn : null;
    var line = winnerName ? esc(winnerName) + ' wins by ' + esc(r.method_name.toLowerCase()) : 'The judges couldn\'t split them';
    var cards = '<table class="ss-cards"><thead><tr><th class="j" style="text-align:left">Judge</th><th>' + esc(A) + '</th><th>' + esc(Bn) + '</th></tr></thead><tbody>' +
      r.cards.map(function (c) {
        var looks = { power: 'Looks at power and speed', volume: 'Counts punches and combos', craft: 'Defence, variety, both hands' }[c.looks_at];
        return '<tr><td class="j">' + esc(c.judge) + '<small>' + looks + '</small></td><td class="n' + (c.a > c.b ? ' hi' : '') + '">' + c.a + '</td><td class="n' + (c.b > c.a ? ' hi' : '') + '">' + c.b + '</td></tr>';
      }).join('') + '</tbody></table>';
    return '<div class="ss-result">' + head + '<p class="muted" style="margin:0 0 6px">' + line + '</p>' + cards + '</div>';
  };

  SS.vsBars = function (a, b) {
    function row(lbl, x, y, fmt) {
      x = x || 0; y = y || 0;
      var m = Math.max(x, y, 0.0001);
      var f = fmt || function (v) { return v; };
      return '<div class="ss-vsbar"><span class="v">' + f(x) + '</span><span class="bar a"><i style="width:' + (100 * x / m) + '%"></i></span><span class="lbl">' + lbl +
        '</span><span class="bar b"><i style="width:' + (100 * y / m) + '%"></i></span><span class="v r">' + f(y) + '</span></div>';
    }
    var sp = function (v) { return (v || 0).toFixed(1); };
    return '<div class="ss-vsbars">' + row('Punches', a.punches, b.punches) + row('Per min', a.per_min, b.per_min, sp) + row('Straights', a.straights, b.straights) +
      row('Hooks', a.hooks, b.hooks) + row('Uppercuts', a.uppercuts, b.uppercuts) + row('Blocks', a.blocks, b.blocks) + row('Combos', a.combos, b.combos) +
      row('Top m/s', a.top_speed, b.top_speed, sp) + row('Avg m/s', a.avg_speed, b.avg_speed, sp) +
      row('Left', a.hands.L.punches, b.hands.L.punches) + row('Right', a.hands.R.punches, b.hands.R.punches) + '</div>';
  };

  /* ------------------------------------------------------------------ the score (mirror of Boxing.score_round) */
  var TYPE_PTS = { s: 1.0, h: 1.2, u: 1.3 };
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  SS.clamp = clamp;
  SS.score = function (events, secs) {
    var H = { L: { s: 0, u: 0, h: 0, b: 0, top: 0, sum: 0 }, R: { s: 0, u: 0, h: 0, b: 0, top: 0, sum: 0 } };
    var total = 0, punches = [], blocks = 0;
    events.forEach(function (e) {
      var h = H[e[1]]; h[e[2]]++;
      if (e[2] === 'b') { blocks++; return; }
      punches.push(e); h.sum += e[3]; h.top = Math.max(h.top, e[3]);
      total += TYPE_PTS[e[2]] * clamp(e[3] / 5, 0.5, 2);
    });
    var blockPts = 0.6 * Math.min(blocks, Math.max(10, punches.length));
    var combos = 0, run = 0, last = null;
    punches.forEach(function (e) { run = last !== null && e[0] - last <= 700 ? run + 1 : 1; if (run === 3) combos++; last = e[0]; });
    var nl = H.L.s + H.L.u + H.L.h, nr = H.R.s + H.R.u + H.R.h, n = nl + nr;
    var balanced = n >= 8 && Math.min(nl, nr) >= 0.25 * n;
    var speeds = punches.map(function (e) { return e[3]; });
    function hand(h) { var p = h.s + h.u + h.h; return { punches: p, straights: h.s, uppercuts: h.u, hooks: h.h, blocks: h.b, top_speed: +h.top.toFixed(1), avg_speed: +(h.sum / Math.max(1, p)).toFixed(1) }; }
    return {
      score: Math.round((total + blockPts + 2 * combos) * (balanced ? 1.1 : 1) * 10),
      stats: { punches: n, blocks: blocks, combos: combos, balanced: balanced, straights: H.L.s + H.R.s, uppercuts: H.L.u + H.R.u, hooks: H.L.h + H.R.h,
        top_speed: speeds.length ? +Math.max.apply(null, speeds).toFixed(1) : 0,
        avg_speed: speeds.length ? +(speeds.reduce(function (a, b) { return a + b; }, 0) / speeds.length).toFixed(1) : 0,
        per_min: secs ? +(n * 60 / secs).toFixed(1) : 0, hands: { L: hand(H.L), R: hand(H.R) } }
    };
  };

  /* ------------------------------------------------------------------ sound: bell, thuds, beeps, corner voice */
  var actx = null;
  SS.prefs = { sound: UI.store.get('sound', true), voice: UI.store.get('voice', true) };
  SS.setPref = function (k, v) { SS.prefs[k] = v; UI.store.set(k, v); };
  function ac() {
    if (!SS.prefs.sound) return null;
    if (!actx) {
      var A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      try { actx = new A(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  SS.unlockAudio = function () { var c = ac(); if (c) { var o = c.createOscillator(), g = c.createGain(); g.gain.value = 0; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .01); } };
  function tone(c, freq, start, dur, vol, type) {
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(vol, start + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(c.destination); o.start(start); o.stop(start + dur + 0.05);
  }
  /* the ring bell: inharmonic partials with a long decay; n strikes */
  SS.bell = function (n) {
    var c = ac(); if (!c) return;
    for (var i = 0; i < (n || 1); i++) {
      var t = c.currentTime + i * 0.42;
      [[1, .5, 2.4], [2.76, .25, 1.6], [5.4, .14, 1.0], [8.93, .08, .6]].forEach(function (p) { tone(c, 540 * p[0], t, p[2], p[1]); });
    }
  };
  SS.beep = function (high) { var c = ac(); if (c) tone(c, high ? 1320 : 880, c.currentTime, .16, .3, 'square'); };
  /* a punch landing on a heavy bag: a low thump plus a slap of filtered noise; louder for faster punches */
  SS.thud = function (speed, block) {
    var c = ac(); if (!c) return;
    var t = c.currentTime, vol = clamp((speed || 4) / 9, .25, 1);
    var len = Math.floor(c.sampleRate * .12), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = block ? 'highpass' : 'lowpass'; f.frequency.value = block ? 1800 : 900;
    var g = c.createGain(); g.gain.value = vol * (block ? .25 : .7);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(t);
    if (!block) {
      var o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + .14);
      og.gain.setValueAtTime(vol * .9, t); og.gain.exponentialRampToValueAtTime(0.0001, t + .18);
      o.connect(og); og.connect(c.destination); o.start(t); o.stop(t + .2);
    }
  };
  SS.say = function (text) {
    if (!SS.prefs.voice || !window.speechSynthesis) return;
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.rate = 1.08; u.pitch = .8; speechSynthesis.speak(u); } catch (e) {}
  };
  SS.buzz = function (ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

  /* ------------------------------------------------------------------ the red dot on Mail (polled quietly) */
  SS.unread = 0;
  function decorate() {
    document.querySelectorAll('.ui-header a[href="#mail"], .ui-tabbar a[href="#mail"]').forEach(function (a) {
      var d = a.querySelector('.ss-dot'); if (d) d.remove();
      if (SS.unread > 0) a.insertAdjacentHTML('beforeend', '<span class="ss-dot" aria-label="' + SS.unread + ' new">' + (SS.unread > 9 ? '9+' : SS.unread) + '</span>');
    });
  }
  SS.setUnread = function (n) { SS.unread = n || 0; decorate(); };
  var lastPoll = 0;
  function poll(force) {
    if (!UI.me || document.hidden || (!force && Date.now() - lastPoll < 20000)) return;
    lastPoll = Date.now();
    UI.apiQuiet('unread_count').then(function (r) { SS.setUnread(r.total); }, function () {});
  }
  window.addEventListener('hashchange', function () { setTimeout(function () { decorate(); poll(); }, 0); });
  setInterval(function () { poll(true); }, 60000);
  setTimeout(function () { poll(true); }, 2500);

  SS.loading = function (text) {
    return '<div class="ss-loading"><img src="_/theme/icon.svg" alt=""><span class="ss-sub">' + esc(text || 'Taping up…') + '</span></div>';
  };
  SS.inviteUrl = function (token) { return location.origin + location.pathname + '#invite/' + encodeURIComponent(token); };
  SS.share = function (url, text) {
    if (navigator.share) return navigator.share({ title: 'Subsudo', text: text, url: url }).catch(function () {});
    return SS.copy(url);
  };
  SS.copy = function (text) {
    var done = function () { UI.toast('Link copied', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, function () { prompt('Copy this link', text); });
    prompt('Copy this link', text);
    return Promise.resolve();
  };
})();

/* ===== _ss_face.html ===== */
(function () {
  'use strict';
  var SS = window.SS = window.SS || {};
  var uid = 0;

  SS.AVATAR = {
    skin: { label: 'Skin', names: ['Porcelain', 'Fair', 'Warm', 'Olive', 'Tan', 'Brown', 'Deep', 'Ebony'],
      colors: ['#f6d9c6', '#efc4a4', '#e2ab84', '#c99063', '#ad7349', '#8c5737', '#6c4027', '#4b2b1a'] },
    face: { label: 'Face shape', names: ['Oval', 'Round', 'Square jaw', 'Long', 'Heart'] },
    hair: { label: 'Hair', names: ['Bald', 'Buzz cut', 'Crew cut', 'High fade', 'Pompadour', 'Curly top', 'Afro', 'Cornrows', 'Ponytail', 'Top bun', 'Mohawk', 'Long', 'Locs'] },
    hairColor: { label: 'Hair colour', names: ['Jet black', 'Dark brown', 'Brown', 'Auburn', 'Dirty blond', 'Blond', 'Grey', 'White', 'Fight-night red', 'Dyed blue'],
      colors: ['#1b1714', '#38241a', '#5e3b22', '#8a4426', '#a8814a', '#dcbc72', '#8b8884', '#e8e3d8', '#b5332a', '#2f5fb3'] },
    brows: { label: 'Brows', names: ['Straight', 'Angry', 'Arched', 'Thick', 'Scarred'] },
    eyes: { label: 'Eyes', names: ['Focused', 'Narrow', 'Wide', 'Dead stare', 'Sleepy'] },
    eyeColor: { label: 'Eye colour', names: ['Dark brown', 'Brown', 'Hazel', 'Green', 'Blue', 'Grey'],
      colors: ['#2a1a12', '#5a3a22', '#7b6a2e', '#3f6b3a', '#3b6aa8', '#6f7a84'] },
    nose: { label: 'Nose', names: ['Straight', 'Broad', 'Boxer\'s break', 'Button', 'Long'] },
    mouth: { label: 'Mouth', names: ['Neutral', 'Smirk', 'Mouthguard', 'Snarl', 'Grin'] },
    beard: { label: 'Facial hair', names: ['Clean', 'Stubble', 'Goatee', 'Full beard', 'Moustache', 'Chinstrap', 'Horseshoe'] },
    headgear: { label: 'Headgear', names: ['None', 'Headband', 'Sparring headgear', 'Bandana', 'Beanie'] },
    marks: { label: 'Marks', names: ['None', 'Cheek scar', 'Cauliflower ear', 'Neck tattoo', 'Gold chain', 'Earring', 'Freckles'] },
    outfit: { label: 'Top', names: ['Tank top', 'Hoodie', 'Bare chest', 'Fight robe', 'Rash guard'] },
    kit: { label: 'Kit colour', names: ['Oxblood', 'Black', 'Brass', 'Royal', 'Ivory', 'Green', 'Purple', 'Orange'],
      colors: ['#8e1b1b', '#24211e', '#c4912e', '#2a47a6', '#ece4d4', '#1f6b45', '#5b2a86', '#d9572b'] },
    pose: { label: 'Hands', names: ['Guard up', 'Lead hand up', 'Hand wraps', 'Arms down'] },
    bg: { label: 'Backdrop', names: ['Gym wall', 'The ring', 'Locker room', 'Fight poster', 'City at night', 'Oxblood'] }
  };
  SS.AVATAR_KEYS = Object.keys(SS.AVATAR);

  /* a stable "random" look from any string (fighter id or name) */
  function hash(s) { var h = 2166136261; s = String(s || 'x'); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  SS.defaultFace = function (seed) {
    var h = hash(seed), out = {};
    SS.AVATAR_KEYS.forEach(function (k, i) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = (h + i * 977) >>> 0; out[k] = h % SS.AVATAR[k].names.length; });
    if (out.headgear > 1 && h % 3) out.headgear = 0;
    if (h % 2) out.marks = 0;
    return out;
  };

  function shade(hex, f) {  // f < 0 darker, > 0 lighter
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function ell(cx, cy, rx, ry) { return 'M' + (cx - rx) + ' ' + cy + 'a' + rx + ' ' + ry + ' 0 1 0 ' + 2 * rx + ' 0a' + rx + ' ' + ry + ' 0 1 0 ' + -2 * rx + ' 0Z'; }
  var GLOVE_HEX = { oxblood: '#8e1b1b', black: '#24211e', brass: '#c4912e', royal: '#2a47a6', white: '#efe8db', green: '#1f6b45' };

  /* head shapes: [path, ear x (left), top y] */
  var HEADS = [
    [ell(100, 96, 36, 44), 64, 52],
    [ell(100, 97, 40, 41), 60, 56],
    ['M64 68Q64 52 82 52H118Q136 52 136 68V110Q136 134 114 140H86Q64 134 64 110Z', 64, 52],
    [ell(100, 94, 33, 48), 67, 46],
    ['M100 140Q73 128 66 100Q61 70 74 58Q86 50 100 50Q114 50 126 58Q139 70 134 100Q127 128 100 140Z', 65, 50]
  ];

  function backdrop(i, id) {
    var o;
    switch (i) {
      case 1: o = '<rect width="200" height="200" fill="#1d2340"/><circle cx="100" cy="40" r="110" fill="url(#' + id + 'L)"/>' +
        '<g stroke-width="6"><path d="M0 52H200" stroke="#c4362b"/><path d="M0 84H200" stroke="#ece4d4"/><path d="M0 116H200" stroke="#2a47a6"/></g>' +
        '<rect x="0" y="40" width="12" height="160" fill="#b9b1a4"/><rect x="188" y="40" width="12" height="160" fill="#b9b1a4"/>'; break;
      case 2: o = '<rect width="200" height="200" fill="#58616c"/>' + [0, 1, 2, 3, 4].map(function (k) {
          return '<rect x="' + (k * 40 + 2) + '" y="0" width="36" height="200" fill="#66707c"/><path d="M' + (k * 40 + 10) + ' 20h20M' + (k * 40 + 10) + ' 26h20M' + (k * 40 + 10) + ' 32h20" stroke="#4a525c" stroke-width="2"/>' +
            '<rect x="' + (k * 40 + 30) + '" y="70" width="3" height="16" rx="1.5" fill="#c9ced4"/>';
        }).join(''); break;
      case 3: o = '<rect width="200" height="200" fill="#efe3c8"/><rect width="200" height="34" fill="#8e1b1b"/><path d="M0 34h200" stroke="#1c1a18" stroke-width="3"/>' +
        '<g fill="#1c1a18" opacity=".08">' + (function () { var d = ''; for (var y = 44; y < 200; y += 9) for (var x = (y % 18 ? 4 : 8); x < 200; x += 9) d += '<circle cx="' + x + '" cy="' + y + '" r="2"/>'; return d; })() + '</g>'; break;
      case 4: o = '<rect width="200" height="200" fill="#141a33"/><g fill="#0b0f22"><rect x="0" y="96" width="38" height="104"/><rect x="34" y="70" width="30" height="130"/>' +
        '<rect x="138" y="80" width="30" height="120"/><rect x="164" y="104" width="36" height="96"/></g><g fill="#e3b85c" opacity=".7">' +
        '<rect x="42" y="80" width="4" height="5"/><rect x="52" y="92" width="4" height="5"/><rect x="146" y="90" width="4" height="5"/><rect x="156" y="104" width="4" height="5"/>' +
        '<rect x="10" y="108" width="4" height="5"/><rect x="176" y="116" width="4" height="5"/></g><circle cx="160" cy="34" r="12" fill="#e9e1cf" opacity=".85"/>'; break;
      case 5: o = '<rect width="200" height="200" fill="#8e1b1b"/><circle cx="100" cy="80" r="120" fill="url(#' + id + 'L)"/>'; break;
      default: o = '<rect width="200" height="200" fill="#3b2a22"/><g stroke="#2a1d17" stroke-width="2.5">' + (function () {
          var d = ''; for (var y = 22, r = 0; y < 200; y += 22, r++) { d += '<path d="M0 ' + y + 'H200"/>'; for (var x = (r % 2 ? 0 : 24); x < 200; x += 48) d += '<path d="M' + x + ' ' + (y - 22) + 'V' + y + '"/>'; } return d;
        })() + '</g><circle cx="100" cy="60" r="110" fill="url(#' + id + 'L)"/>';
    }
    return o;
  }

  function torso(sp, skin, kit) {
    var s = '<path d="M8 200Q12 164 54 156Q78 150 88 148H112Q122 150 146 156Q188 164 192 200Z" fill="' + skin + '"/>';
    var dk = shade(kit, -.28);
    switch (sp.outfit) {
      case 0: s += '<path d="M60 200Q62 172 74 158L88 152Q100 170 112 152L126 158Q138 172 140 200Z" fill="' + kit + '"/>' +
          '<path d="M74 158L88 152Q100 170 112 152L126 158" fill="none" stroke="' + dk + '" stroke-width="3"/>'; break;
      case 1: s += '<path d="M8 200Q12 164 54 156Q78 150 88 148H112Q122 150 146 156Q188 164 192 200Z" fill="' + kit + '"/>' +
          '<path d="M66 156Q100 186 134 156Q126 142 114 142Q100 160 86 142Q74 142 66 156Z" fill="' + dk + '"/>' +
          '<path d="M92 164V184M108 164V184" stroke="#ece4d4" stroke-width="2.5" stroke-linecap="round"/>'; break;
      case 2: s += '<path d="M70 178Q86 186 98 178M102 178Q114 186 130 178" fill="none" stroke="' + shade(skin, -.22) + '" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M30 200Q44 176 64 168" fill="none" stroke="' + shade(skin, -.18) + '" stroke-width="2"/>'; break;
      case 3: s += '<path d="M8 200Q12 164 54 156Q78 150 88 148H112Q122 150 146 156Q188 164 192 200Z" fill="' + kit + '"/>' +
          '<path d="M40 166Q70 154 84 150L100 200M160 166Q130 154 116 150L100 200" fill="none" stroke="#e3b85c" stroke-width="5"/>' +
          '<path d="M86 150L100 192L114 150" fill="' + shade(skin, -.08) + '"/><path d="M28 182Q60 166 76 160" stroke="#fff" stroke-opacity=".22" stroke-width="5" fill="none"/>'; break;
      case 4: s += '<path d="M8 200Q12 164 54 156Q78 150 88 148H112Q122 150 146 156Q188 164 192 200Z" fill="' + kit + '"/>' +
          '<path d="M10 188Q100 170 190 188" stroke="' + (kit === '#ece4d4' ? '#8e1b1b' : '#ece4d4') + '" stroke-width="7" fill="none"/>' +
          '<path d="M84 150Q100 162 116 150" fill="none" stroke="' + dk + '" stroke-width="4"/>'; break;
    }
    return s;
  }

  function gloveFront(cx, cy, c, s) {
    s = s || 1;
    var d = shade(c, -.3), hi = c === '#efe8db' ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.28)';
    return '<g transform="translate(' + cx + ' ' + cy + ') scale(' + s + ')"><rect x="-15" y="16" width="30" height="24" rx="4" fill="' + d + '"/>' +
      '<path d="M-15 24H15" stroke="#ece4d4" stroke-width="2" stroke-dasharray="3 3"/>' +
      '<path d="M-22 6Q-24 -24 0 -24Q24 -24 22 6Q20 22 0 22Q-20 22 -22 6Z" fill="' + c + '" stroke="rgba(0,0,0,.4)" stroke-width="2"/>' +
      '<path d="M-14 4Q-4 14 10 6" fill="none" stroke="' + d + '" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="-8" cy="-13" rx="7" ry="3.5" fill="' + hi + '" transform="rotate(-20 -8 -13)"/></g>';
  }
  function wrapFist(cx, cy, skin) {
    return '<g transform="translate(' + cx + ' ' + cy + ')"><rect x="-17" y="-12" width="34" height="30" rx="9" fill="#efe8db" stroke="rgba(0,0,0,.35)" stroke-width="2"/>' +
      '<path d="M-17 -2H17M-17 8H17" stroke="#cfc5b4" stroke-width="2"/><path d="M-13 -12Q-13 -22 -6 -22Q0 -22 0 -14Q0 -22 7 -22Q13 -22 13 -12" fill="' + skin + '" stroke="rgba(0,0,0,.3)" stroke-width="1.5"/>' +
      '<rect x="-12" y="18" width="24" height="22" fill="#efe8db"/></g>';
  }
  function hands(sp, skin, glove) {
    var c = GLOVE_HEX[glove] || glove || GLOVE_HEX.oxblood;
    switch (sp.pose) {
      case 1: return gloveFront(62, 156, c, 1.05) + gloveFront(142, 184, c, 1);
      case 2: return wrapFist(66, 176, skin) + wrapFist(134, 176, skin);
      case 3: return '';
      default: return gloveFront(62, 168, c) + gloveFront(138, 168, c);
    }
  }

  function ears(sp, skin, earX) {
    if (sp.headgear === 2) return '';
    var d = shade(skin, -.15), cauli = sp.marks === 2;
    var one = function (x, flip) {
      var r = cauli ? 11 : 9;
      var s = '<ellipse cx="' + x + '" cy="98" rx="' + (r - 2) + '" ry="' + r + '" fill="' + skin + '"/>' +
        '<path d="M' + (x + (flip ? -3 : 3)) + ' 92q' + (flip ? -4 : 4) + ' 6 0 12" fill="none" stroke="' + d + '" stroke-width="2"/>';
      if (cauli && !flip) s += '<circle cx="' + (x - 3) + '" cy="92" r="4" fill="' + shade(skin, -.08) + '"/><circle cx="' + (x - 1) + '" cy="103" r="3.5" fill="' + shade(skin, -.08) + '"/>';
      return s;
    };
    return one(earX, false) + one(200 - earX, true);
  }

  /* hair: [back layer, cap (clipped to the head), extras on top] */
  function hair(sp, hc, id, top) {
    var dk = shade(hc, -.25), back = '', cap = '', front = '';
    var capPath = function (side, hl, op) {
      return '<path d="M30 20H170V' + side + 'Q100 ' + hl + ' 30 ' + side + 'Z" fill="' + hc + '"' + (op ? ' opacity="' + op + '"' : '') + ' clip-path="url(#' + id + 'H)"/>';
    };
    switch (sp.hair) {
      case 1: cap = capPath(82, 62, .72); break;
      case 2: cap = capPath(84, 64) + '<path d="M78 60q22 -8 44 0" stroke="' + dk + '" stroke-width="2" fill="none" clip-path="url(#' + id + 'H)"/>'; break;
      case 3: cap = capPath(78, 64, .55); front = '<path d="M68 70L70 ' + (top - 12) + 'Q100 ' + (top - 18) + ' 130 ' + (top - 12) + 'L132 70Q100 62 68 70Z" fill="' + hc + '"/>'; break;
      case 4: cap = capPath(84, 66); front = '<path d="M64 74Q58 ' + (top - 18) + ' 100 ' + (top - 20) + 'Q148 ' + (top - 22) + ' 138 74Q124 56 100 62Q78 58 64 74Z" fill="' + hc + '"/>' +
        '<path d="M80 ' + (top - 8) + 'Q104 ' + (top - 18) + ' 128 ' + (top - 6) + '" stroke="' + shade(hc, .25) + '" stroke-width="3" fill="none" opacity=".6"/>'; break;
      case 5: cap = capPath(82, 66); front = [66, 78, 90, 102, 114, 126, 136].map(function (x, i) {
          return '<circle cx="' + x + '" cy="' + (top + (i % 2 ? 2 : -4) + (i === 0 || i === 6 ? 12 : 0)) + '" r="11" fill="' + hc + '"/>';
        }).join(''); break;
      case 6: back = '<circle cx="100" cy="' + (top + 30) + '" r="58" fill="' + hc + '"/>'; cap = capPath(86, 70);
        front = '<path d="M60 74Q64 ' + (top - 2) + ' 100 ' + (top - 4) + 'Q136 ' + (top - 2) + ' 140 74Q120 62 100 66Q80 62 60 74Z" fill="' + hc + '"/>'; break;
      case 7: cap = capPath(84, 64) + [84, 92, 100, 108, 116].map(function (x) { return '<path d="M' + x + ' 50L' + (x + (x - 100) * .3) + ' 70" stroke="' + shade(hc, .3) + '" stroke-width="2" clip-path="url(#' + id + 'H)"/>'; }).join(''); break;
      case 8: back = '<path d="M128 74Q166 90 156 148Q150 112 130 100Z" fill="' + hc + '"/>'; cap = capPath(84, 64); front = '<circle cx="134" cy="76" r="5" fill="' + dk + '"/>'; break;
      case 9: cap = capPath(84, 64); front = '<circle cx="100" cy="' + (top - 10) + '" r="14" fill="' + hc + '"/><path d="M90 ' + (top - 2) + 'h20" stroke="' + dk + '" stroke-width="3"/>'; break;
      case 10: cap = capPath(84, 64, .22); front = '<path d="M92 72L90 ' + (top - 24) + 'L96 ' + (top - 14) + 'L100 ' + (top - 28) + 'L104 ' + (top - 14) + 'L110 ' + (top - 24) + 'L108 72Z" fill="' + hc + '"/>'; break;
      case 11: back = '<path d="M60 70Q52 140 64 178H136Q148 140 140 70Z" fill="' + hc + '"/>'; cap = capPath(98, 64);
        front = '<path d="M64 98Q62 66 92 58Q74 74 72 104Z" fill="' + hc + '"/>'; break;
      case 12: back = [62, 72, 82, 118, 128, 138].map(function (x) { return '<rect x="' + (x - 4) + '" y="70" width="8" height="' + (x < 100 ? 92 : 86) + '" rx="4" fill="' + hc + '"/>'; }).join('');
        cap = capPath(86, 66); front = [80, 92, 104, 116].map(function (x) { return '<rect x="' + (x - 4) + '" y="58" width="8" height="26" rx="4" fill="' + hc + '" transform="rotate(' + ((x - 98) / 3) + ' ' + x + ' 58)"/>'; }).join(''); break;
      default: cap = '<ellipse cx="88" cy="' + (top + 8) + '" rx="9" ry="4" fill="#fff" opacity=".18"/>';
    }
    return [back, cap, front];
  }

  function brows(i, c) {
    var w = i === 3 ? 7 : 4.5, s = '<g stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" fill="none">';
    switch (i) {
      case 1: s += '<path d="M77 80L96 86M104 86L123 80"/>'; break;
      case 2: s += '<path d="M77 86Q86 77 96 83M104 83Q114 77 123 86"/>'; break;
      case 4: s += '<path d="M77 84H96M104 84H110M115 84H123"/>'; break;
      default: s += '<path d="M77 84H96M104 84H123"/>';
    }
    return s + '</g>';
  }

  function eyes(i, ec, skin) {
    var ry = [4.2, 2.6, 5.4, 4, 4][i], ir = [3.4, 2.6, 3.8, 3.2, 3.2][i], s = '';
    [86, 114].forEach(function (x) {
      s += '<ellipse cx="' + x + '" cy="96" rx="7" ry="' + ry + '" fill="#f4efe6"/><circle cx="' + x + '" cy="96.5" r="' + ir + '" fill="' + ec + '"/>' +
        '<circle cx="' + x + '" cy="96.5" r="' + (ir * .5) + '" fill="#0b0908"/><circle cx="' + (x - 1.2) + '" cy="95" r="1" fill="#fff"/>';
      if (i === 3) s += '<path d="M' + (x - 8) + ' 93H' + (x + 8) + '" stroke="#1b1714" stroke-width="3" stroke-linecap="round"/>';
      if (i === 4) s += '<path d="M' + (x - 8) + ' 96.5H' + (x + 8) + 'V90H' + (x - 8) + 'Z" fill="' + skin + '"/><path d="M' + (x - 7.5) + ' 96.5H' + (x + 7.5) + '" stroke="#1b1714" stroke-width="2.2" stroke-linecap="round"/>';
      if (i === 1) s += '<path d="M' + (x - 8) + ' 93.5Q' + x + ' 92 ' + (x + 8) + ' 93.5" stroke="#1b1714" stroke-width="2" fill="none"/>';
      if (i === 0 || i === 2) s += '<path d="M' + (x - 7.5) + ' ' + (96 - ry + .5) + 'Q' + x + ' ' + (96 - ry - 2) + ' ' + (x + 7.5) + ' ' + (96 - ry + .5) + '" stroke="#1b1714" stroke-width="1.8" fill="none"/>';
    });
    return s;
  }

  function nose(i, skin) {
    var c = shade(skin, -.3), g = '<g stroke="' + c + '" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round">';
    switch (i) {
      case 1: g += '<path d="M99 99L97 108"/><path d="M92 110Q100 117 108 110"/><circle cx="95" cy="111" r="1.4" fill="' + c + '"/><circle cx="105" cy="111" r="1.4" fill="' + c + '"/>'; break;
      case 2: g += '<path d="M100 96Q105 102 99 106Q96 110 103 112"/><path d="M95 112Q99 114 103 112"/>'; break;
      case 3: g += '<path d="M96 110Q100 114 104 110"/>'; break;
      case 4: g += '<path d="M100 92L96 112Q100 115 105 112"/>'; break;
      default: g += '<path d="M100 98L97 110Q100 113 104 111"/>';
    }
    return g + '</g>';
  }

  function mouth(i, kit) {
    switch (i) {
      case 1: return '<path d="M90 124Q102 126 111 119" stroke="#5a2a22" stroke-width="3" fill="none" stroke-linecap="round"/>';
      case 2: return '<rect x="87" y="117" width="26" height="11" rx="5.5" fill="' + kit + '" stroke="rgba(0,0,0,.45)" stroke-width="2"/><path d="M93 117V128M100 117V128M107 117V128" stroke="#fff" stroke-opacity=".3" stroke-width="1.5"/>';
      case 3: return '<path d="M88 121Q100 115 112 121Q100 131 88 121Z" fill="#3a1410"/><path d="M90 120.5Q100 116.5 110 120.5L109 122.5Q100 119 91 122.5Z" fill="#f4efe6"/>';
      case 4: return '<path d="M87 119Q100 135 113 119Z" fill="#3a1410"/><path d="M88.5 119.5H111.5L110 123H90Z" fill="#f4efe6"/>';
      default: return '<path d="M90 123Q100 125 110 123" stroke="#5a2a22" stroke-width="3" fill="none" stroke-linecap="round"/>';
    }
  }

  function beard(i, hc, id, headPath) {
    var jaw = '<path d="M40 104Q60 114 76 114Q100 108 124 114Q140 114 160 104V200H40Z" fill="' + hc + '"';
    switch (i) {
      case 1: return [jaw + ' opacity=".32" clip-path="url(#' + id + 'H0)"/>', ''];
      case 2: return ['<path d="M89 128Q100 150 111 128Q100 133 89 128Z" fill="' + hc + '"/>', moustache(hc, .8)];
      case 3: return [jaw + ' clip-path="url(#' + id + 'H0)"/>', moustache(hc, 1)];
      case 4: return ['', moustache(hc, 1.1)];
      case 5: return ['<path d="' + headPath + '" fill="none" stroke="' + hc + '" stroke-width="8" clip-path="url(#' + id + 'J)"/>', ''];
      case 6: return ['<path d="M86 118V140M114 118V140" stroke="' + hc + '" stroke-width="6" stroke-linecap="round"/>', moustache(hc, 1)];
      default: return ['', ''];
    }
  }
  function moustache(hc, s) {
    return '<path d="M84 120Q92 ' + (113 - 2 * s) + ' 100 115Q108 ' + (113 - 2 * s) + ' 116 120Q108 117 100 118Q92 117 84 120Z" fill="' + hc + '"/>';
  }

  function headgear(i, kit, top, id) {
    var dk = shade(kit, -.3);
    switch (i) {
      case 1: return ['', '<path d="M58 76Q100 62 142 76V84Q100 70 58 84Z" fill="' + kit + '" clip-path="url(#' + id + 'H)"/>' +
        '<path d="M140 78L156 72L152 86Z" fill="' + kit + '"/><path d="M140 80L158 90L148 94Z" fill="' + dk + '"/>'];
      case 2: return ['<ellipse cx="100" cy="94" rx="48" ry="54" fill="' + kit + '"/>',
        '<path d="M56 80Q58 ' + (top - 8) + ' 100 ' + (top - 10) + 'Q142 ' + (top - 8) + ' 144 80Q124 64 100 64Q76 64 56 80Z" fill="' + kit + '" stroke="' + dk + '" stroke-width="2"/>' +
        '<path d="M56 82Q52 114 70 130L78 120Q66 106 68 86Z" fill="' + kit + '" stroke="' + dk + '" stroke-width="2"/><path d="M144 82Q148 114 130 130L122 120Q134 106 132 86Z" fill="' + kit + '" stroke="' + dk + '" stroke-width="2"/>' +
        '<path d="M74 132Q100 150 126 132" fill="none" stroke="' + dk + '" stroke-width="4"/><path d="M84 ' + (top - 4) + 'H116" stroke="#ece4d4" stroke-width="3" stroke-opacity=".5"/>'];
      case 3: return ['', '<path d="M30 20H170V78Q100 66 30 78Z" fill="' + kit + '" clip-path="url(#' + id + 'H)"/>' +
        '<g fill="#ece4d4" opacity=".55" clip-path="url(#' + id + 'H)"><circle cx="84" cy="62" r="2"/><circle cx="100" cy="56" r="2"/><circle cx="116" cy="62" r="2"/><circle cx="92" cy="70" r="1.6"/><circle cx="108" cy="70" r="1.6"/></g>' +
        '<path d="M136 72L156 66L150 82Z" fill="' + dk + '"/>'];
      case 4: return ['', '<path d="M60 80Q56 ' + (top - 14) + ' 100 ' + (top - 16) + 'Q144 ' + (top - 14) + ' 140 80Z" fill="' + kit + '"/>' +
        '<rect x="56" y="70" width="88" height="14" rx="6" fill="' + dk + '"/><circle cx="100" cy="' + (top - 18) + '" r="9" fill="' + shade(kit, .2) + '"/>'];
      default: return ['', ''];
    }
  }

  function marks(i, skin, earX) {
    switch (i) {
      case 1: return '<path d="M118 104L127 117" stroke="' + shade(skin, .35) + '" stroke-width="2.5" stroke-linecap="round"/><path d="M119 108l4 -2M121 111l4 -2M123 114l4 -2" stroke="' + shade(skin, -.25) + '" stroke-width="1.2"/>';
      case 3: return '<g stroke="#1f2a3a" stroke-width="1.8" fill="none" opacity=".85"><path d="M106 140l3 7h7l-6 4 3 7-7 -4 -6 4 2 -7 -6 -4h7z"/></g>';
      case 4: return '<path d="M76 154Q100 178 124 154" fill="none" stroke="#d7a640" stroke-width="3" stroke-dasharray="3 2"/><circle cx="100" cy="170" r="4.5" fill="#d7a640"/>';
      case 5: return '<circle cx="' + (200 - earX + 1) + '" cy="108" r="3" fill="#e3b85c" stroke="#8a5f12" stroke-width="1"/>';
      case 6: return '<g fill="' + shade(skin, -.3) + '" opacity=".55"><circle cx="80" cy="106" r="1.3"/><circle cx="85" cy="109" r="1.3"/><circle cx="78" cy="111" r="1.3"/><circle cx="120" cy="106" r="1.3"/><circle cx="115" cy="109" r="1.3"/><circle cx="122" cy="111" r="1.3"/></g>';
      default: return '';
    }
  }

  /* bout damage: colour by age (fresh purple-red -> blue -> yellow-green), amount by level */
  function injuries(h, id, skin) {
    if (!h || !(h.level > 0.05)) return ['', ''];
    var lv = h.level, age = h.age || 0;
    var col = age < 6 ? '#5e1846' : age < 14 ? '#3d3a7a' : '#7d8a2e';
    var a = Math.min(1, 0.45 + lv / 4);
    var defs = '<radialGradient id="' + id + 'B"><stop offset="0" stop-color="' + col + '" stop-opacity="' + (.9 * a) + '"/><stop offset=".6" stop-color="' + col + '" stop-opacity="' + (.5 * a) + '"/>' +
      '<stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient>';
    var o = '';
    if (lv >= .3) o += '<ellipse cx="121" cy="110" rx="10" ry="7" fill="#d2453a" opacity="' + (.18 + lv * .05) + '"/><ellipse cx="79" cy="110" rx="9" ry="6" fill="#d2453a" opacity="' + (.12 + lv * .04) + '"/>';
    if (lv >= 1) o += '<ellipse cx="86" cy="97" rx="15" ry="12" fill="url(#' + id + 'B)"/>';
    if (lv >= 2.8) o += '<ellipse cx="114" cy="97" rx="14" ry="11" fill="url(#' + id + 'B)"/>';
    if (lv >= 2.2) o += '<path d="M64 104Q58 114 68 122" fill="' + shade(skin, -.06) + '" stroke="' + col + '" stroke-opacity=".5" stroke-width="2"/>' +
      '<ellipse cx="76" cy="112" rx="10" ry="8" fill="' + col + '" opacity=".35"/>' +
      '<rect x="91" y="101" width="18" height="6" rx="2" fill="#f3e6cf" stroke="#c9b48e" stroke-width="1" transform="rotate(-12 100 104)"/>';
    var top = '';
    if (lv >= 1.6) top += '<path d="M109 78L121 85" stroke="#a0201a" stroke-width="2.6" stroke-linecap="round"/>' +
      '<rect x="110" y="77" width="3.5" height="10" rx="1" fill="#f6f1e6" stroke="#cfc5b4" stroke-width=".8" transform="rotate(28 112 82)"/>' +
      '<rect x="116" y="80" width="3.5" height="10" rx="1" fill="#f6f1e6" stroke="#cfc5b4" stroke-width=".8" transform="rotate(28 118 85)"/>';
    if (lv >= 2.8) top += '<path d="M58 72Q100 54 142 66L143 78Q100 66 57 84Z" fill="#f6f1e6" stroke="#cfc5b4" stroke-width="1.2"/>' +
      '<path d="M70 70l8 -3M88 64l8 -2M106 62l8 0" stroke="#d8cfbe" stroke-width="1.5"/><circle cx="72" cy="74" r="3" fill="#b3261e" opacity=".7"/>';
    if (h.ko) top += '<g fill="#f2c94c" stroke="#7d540f" stroke-width="1">' + [[58, 46, 0], [100, 30, 20], [142, 46, -15]].map(function (p) {
        return '<path transform="translate(' + p[0] + ' ' + p[1] + ') rotate(' + p[2] + ')" d="M0 -8L2.4 -2.4L8 -2.4L3.6 1.2L5 7L0 3.6L-5 7L-3.6 1.2L-8 -2.4L-2.4 -2.4Z"/>';
      }).join('') + '<ellipse cx="100" cy="42" rx="48" ry="10" fill="none" stroke="#f2c94c" stroke-opacity=".5" stroke-dasharray="4 5"/></g>';
    return [defs, o, top];
  }

  SS.face = function (spec, opts) {
    opts = opts || {};
    var sp = {};
    SS.AVATAR_KEYS.forEach(function (k) { var v = spec && spec[k]; sp[k] = typeof v === 'number' && v >= 0 && v < SS.AVATAR[k].names.length ? v : 0; });
    var id = 'sf' + (++uid);
    var skin = SS.AVATAR.skin.colors[sp.skin], hc = SS.AVATAR.hairColor.colors[sp.hairColor], kit = SS.AVATAR.kit.colors[sp.kit];
    var ec = SS.AVATAR.eyeColor.colors[sp.eyeColor];
    var H = HEADS[sp.face], hp = H[0], earX = H[1], top = H[2];
    var hr = hair(sp, hc, id, top), bd = beard(sp.beard, hc, id, hp), hg = headgear(sp.headgear, kit, top, id), inj = injuries(opts.hurt, id, skin);
    var browC = sp.hair === 0 && sp.hairColor > 5 ? shade(skin, -.45) : shade(hc, -.1);
    return '<svg viewBox="' + (opts.full ? '0 0 200 200' : '20 18 160 160') + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>' +
      '<radialGradient id="' + id + 'L"><stop offset="0" stop-color="#fff3d6" stop-opacity=".28"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0"/></radialGradient>' +
      '<clipPath id="' + id + 'H"><path d="' + hp + '" transform="translate(100 96) scale(1.06) translate(-100 -96)"/></clipPath>' +
      '<clipPath id="' + id + 'H0"><path d="' + hp + '"/></clipPath>' +
      '<clipPath id="' + id + 'J"><rect x="0" y="106" width="200" height="94"/></clipPath>' + (inj[0] || '') + '</defs>' +
      backdrop(sp.bg, id) + hg[0] + hr[0] + torso(sp, skin, kit) +
      '<path d="M86 124V158Q100 166 114 158V124Z" fill="' + shade(skin, -.12) + '"/>' +
      ears(sp, skin, earX) + '<path d="' + hp + '" fill="' + skin + '"/>' +
      '<path d="' + hp + '" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2"/>' +
      '<ellipse cx="100" cy="112" rx="26" ry="20" fill="' + shade(skin, .06) + '" opacity=".35"/>' +
      bd[0] + eyes(sp.eyes, ec, skin) + brows(sp.brows, browC) + nose(sp.nose, skin) + mouth(sp.mouth, kit) + bd[1] +
      marks(sp.marks, skin, earX) + (inj[1] || '') + hr[1] + hr[2] + hg[1] + (inj[2] || '') + hands(sp, skin, opts.glove) + '</svg>';
  };

  SS.hurtBadge = function (h) {
    if (!h) return '';
    var heal = h.age >= 14;
    return '<span class="ss-hurt' + (heal ? ' heal' : '') + '" title="From a bout ' + Math.round(h.age) + 'h ago">' + UI.icon(heal ? 'heart' : 'bolt') +
      UI.esc(h.ko ? 'Seeing stars' : heal ? 'Healing' : h.label) + ' · ' + h.hours_left + 'h to heal</span>';
  };
})();

/* ===== _ss_motion.html ===== */
(function () {
  'use strict';
  var esc = UI.esc, SS = window.SS;
  SS.timeScale = 1;          // tests: run the clock faster
  SS.forceMotion = false;    // tests: allow phone mode without a motion sensor
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ================================================================== phone: devicemotion -> events */
  function PhoneDetector(onEvent) {
    this.onEvent = onEvent;
    this.g = null;            // gravity estimate (points up, from accelerationIncludingGravity)
    this.win = null;          // samples of the movement being measured
    this.until = 0;           // ignore everything until then (the fist coming back)
    this.samples = 0;
    this.hand = 'R';
  }
  PhoneDetector.TRIGGER = 11;   // m/s2 of linear acceleration that starts a movement
  PhoneDetector.WINDOW = 150;   // ms looked at after the start
  PhoneDetector.REFRACTORY = 330;
  PhoneDetector.prototype.feed = function (s) {
    this.samples++;
    var inc = s.gx != null ? [s.gx, s.gy, s.gz] : null;
    if (inc && !this.win) {
      if (!this.g) this.g = inc.slice();
      else for (var i = 0; i < 3; i++) this.g[i] = this.g[i] * 0.92 + inc[i] * 0.08;
    }
    var g = this.g || [0, 0, 9.81], gl = Math.hypot(g[0], g[1], g[2]) || 1, gn = [g[0] / gl, g[1] / gl, g[2] / gl];
    var lin = s.ax != null ? [s.ax, s.ay, s.az] : (inc ? [inc[0] - g[0], inc[1] - g[1], inc[2] - g[2]] : [0, 0, 0]);
    var up = lin[0] * gn[0] + lin[1] * gn[1] + lin[2] * gn[2];
    var h = [lin[0] - up * gn[0], lin[1] - up * gn[1], lin[2] - up * gn[2]];
    var horiz = Math.hypot(h[0], h[1], h[2]), mag = Math.hypot(lin[0], lin[1], lin[2]);
    if (!this.win) {
      if (s.t < this.until || mag < PhoneDetector.TRIGGER) return;
      this.win = { start: s.t, pts: [] };
    }
    this.win.pts.push({ t: s.t, up: up, horiz: horiz, lin: lin, mag: mag, rot: s.rot || 0 });
    if (s.t - this.win.start >= PhoneDetector.WINDOW) {
      var w = this.win; this.win = null;
      this.until = w.start + PhoneDetector.REFRACTORY;
      var ev = PhoneDetector.classify(w.pts);
      if (ev) { ev.hand = this.hand; this.onEvent(ev); }
    }
  };
  PhoneDetector.classify = function (pts) {
    var pH = 0, pUp = 0, pDown = 0, pRot = 0, peak = pts[0];
    pts.forEach(function (p) {
      pH = Math.max(pH, p.horiz); pUp = Math.max(pUp, p.up); pDown = Math.max(pDown, -p.up); pRot = Math.max(pRot, p.rot);
      if (p.mag > peak.mag) peak = p;
    });
    var pV = Math.max(pUp, pDown), type = null;
    if (pV > 9 && pH < 0.75 * pV) type = (pUp >= pDown && pH > 0.45 * pV) ? 'u' : 'b';
    else if (pH > 11) type = pUp > 0.55 * pH ? 'u' : (pRot > 380 ? 'h' : 's');
    if (!type) return null;
    // speed: add up the acceleration along the punch's direction while it speeds up
    var d = peak.lin, dl = Math.hypot(d[0], d[1], d[2]) || 1, v = 0;
    for (var i = 1; i < pts.length; i++) {
      var dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt <= 0 || dt > 0.08) continue;
      var a = (pts[i].lin[0] * d[0] + pts[i].lin[1] * d[1] + pts[i].lin[2] * d[2]) / dl;
      if (a > 0) v += a * dt;
    }
    if (v < 0.3) v = peak.mag * 0.12;
    return { type: type, speed: +clamp(v * 1.6, 0.8, 13).toFixed(2) };
  };
  SS.PhoneDetector = PhoneDetector;

  /* ================================================================== camera: hand landmarks -> events */
  var MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  SS.loadHands = function () {
    if (SS._hands) return SS._hands;
    SS._hands = import(MP + '/vision_bundle.mjs').then(function (vision) {
      return vision.FilesetResolver.forVisionTasks(MP + '/wasm').then(function (files) {
        var make = function (delegate) {
          return vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: delegate }, runningMode: 'VIDEO', numHands: 2,
            minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        };
        return make('GPU').catch(function () { return make('CPU'); });
      });
    });
    SS._hands.catch(function () { SS._hands = null; });
    return SS._hands;
  };

  function CameraDetector(onEvent) {
    this.onEvent = onEvent;
    this.hist = { L: [], R: [] };
    this.until = { L: 0, R: 0 };
    this.seen = { L: 0, R: 0 };
  }
  CameraDetector.HAND_M = 0.085;   // wrist to middle knuckle, metres
  /* hands: [{hand: 'L'|'R', lm: [{x, y}, ... 21]}], aspect = width / height of the picture */
  CameraDetector.prototype.feed = function (t, hands, aspect) {
    var self = this;
    aspect = aspect || 4 / 3;
    hands.forEach(function (hd) {
      var lm = hd.lm, k = hd.hand;
      if (!lm || lm.length < 18) return;
      self.seen[k] = t;
      var X = function (p) { return p.x * aspect; };
      var s = Math.hypot(X(lm[0]) - X(lm[9]), lm[0].y - lm[9].y);
      if (s < 0.01) return;
      var ids = [0, 5, 9, 13, 17], cx = 0, cy = 0;
      ids.forEach(function (i) { cx += X(lm[i]); cy += lm[i].y; });
      var cur = { t: t, x: cx / 5, y: cy / 5, s: s }, H = self.hist[k];
      H.push(cur);
      while (H.length && t - H[0].t > 400) H.shift();
      if (t < self.until[k]) return;
      var old = null;
      for (var i = H.length - 1; i >= 0; i--) { if (t - H[i].t >= 90) { old = H[i]; break; } }
      if (!old || t - old.t > 220) return;
      var dt = (t - old.t) / 1000;
      var growth = (cur.s / old.s - 1) / dt, vx = (cur.x - old.x) / old.s / dt, vy = (cur.y - old.y) / old.s / dt;
      var mov = Math.hypot(vx, vy), type = null;
      if (growth > 2.2 || (mov > 9 && growth > 0.6)) {
        type = (-vy > 5 && -vy > 1.2 * Math.abs(vx)) ? 'u' : (Math.abs(vx) > 6 && Math.abs(vx) > 1.3 * Math.abs(vy) ? 'h' : 's');
      } else if (Math.abs(vy) > 7 && Math.abs(vy) > 1.5 * Math.abs(vx) && growth < 1.0) {
        type = 'b';
      }
      if (!type) return;
      var Z = CameraDetector.HAND_M / (0.83 * cur.s);
      var speed = Math.hypot(mov * CameraDetector.HAND_M, Math.max(0, growth) * Z) * 1.3;
      self.until[k] = t + 320;
      self.onEvent({ hand: k, type: type, speed: +clamp(speed, 0.8, 13).toFixed(2) });
    });
  };
  SS.CameraDetector = CameraDetector;

  /* ================================================================== the recorder */
  var live = null;  // the running round, for SS.injectMotion
  SS.injectMotion = function (s) { if (live && live.onMotion) live.onMotion(s); };
  function coarse() { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  function hasMotion() { return 'DeviceMotionEvent' in window && (coarse() || SS.forceMotion); }
  function hasCamera() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function fmt(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

  var GEAR = {
    phone: { icon: 'phone', title: 'Phone in fist', text: 'Hold your phone tight in your fist. Right hand first, the bell rings, then left. Counts punches, speed, uppercuts, hooks and blocks.' },
    camera: { icon: 'camera', title: 'Laptop camera', text: 'Stand about 1.5 m back with both fists in view. The camera tracks both hands at once.' },
    pads: { icon: 'target', title: 'Tap the pads', text: 'Practice on the screen: tap or use the keys F J D K U and Space. Training only.' }
  };

  SS.recorder = function (host, opts) {
    opts = opts || {};
    var devices = opts.devices || ['phone', 'camera'];
    var secs = opts.secs || UI.store.get('secs', 60);
    var device = UI.store.get('device', coarse() ? 'phone' : 'camera');
    if (devices.indexOf(device) < 0) device = devices[0];
    var resolve, cleanups = [], timers = [];
    var promise = new Promise(function (r) { resolve = r; });

    function stopAll() {
      timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); timers = [];
      cleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } });
      live = null;
    }

    function pick(msg) {
      stopAll();
      var avail = { phone: hasMotion(), camera: hasCamera(), pads: true };
      host.innerHTML = '<div class="rc">' + (opts.title ? '<div class="ss-h"><h2>' + esc(opts.title) + '</h2><span class="tape"></span></div>' : '') +
        (msg ? '<div class="ui-error" style="margin-bottom:14px">' + esc(msg) + '</div>' : '') +
        '<div class="rc-gear" role="radiogroup" aria-label="How you\'ll throw punches">' + devices.map(function (d) {
          var g = GEAR[d];
          return '<button type="button" role="radio" aria-checked="' + (d === device) + '" data-dev="' + d + '" class="' + (d === device ? 'on' : '') + '">' +
            '<span class="ic">' + UI.icon(g.icon) + '</span><b>' + g.title + '</b><span>' + g.text + '</span>' +
            (avail[d] ? '' : '<em>' + (d === 'phone' ? 'Open Subsudo on your phone for this' : 'No camera found here') + '</em>') + '</button>';
        }).join('') + '</div>' +
        '<div class="rc-opts">' + (opts.allowSecs ? '<div><div class="ss-sub" style="margin-bottom:6px">Round length</div><div class="ui-seg" data-secs>' +
          [30, 60, 90].map(function (s) { return '<button type="button" data-s="' + s + '" class="' + (s === secs ? 'on' : '') + '">' + s + ' sec</button>'; }).join('') + '</div></div>'
          : '<span class="ui-badge">' + UI.icon('timer') + secs + '-second round</span>') +
        '<label class="ui-check"><input type="checkbox" data-pref="sound"' + (SS.prefs.sound ? ' checked' : '') + '> Bell and punch sounds</label>' +
        '<label class="ui-check"><input type="checkbox" data-pref="voice"' + (SS.prefs.voice ? ' checked' : '') + '> Corner voice</label></div>' +
        brief() + '<div class="rc-start"><button class="ui-btn primary lg" data-start>' + UI.icon('glove') + 'Glove up</button>' +
        (opts.cancel ? '<button class="ui-btn ghost" data-cancel>Not now</button>' : '') + '</div></div>';
    }
    function brief() {
      var steps = {
        phone: ['Put your phone in your <b>right</b> fist, screen facing in. Grip it hard (a wrist strap helps).', 'Tap "Glove up", 3-2-1, the bell rings: punch for ' + (secs / 2) + ' seconds.',
          'Forward = punch. Up and forward = uppercut. A fast turn = hook. Straight up or down = block.', 'Two bells: switch the phone to your <b>left</b> fist. 5 seconds to switch, then go again.'],
        camera: ['Put the laptop at chest height and step back until both fists are in the picture.', 'Allow the camera. The hand tracker loads (a few seconds, the first time).',
          'Punch towards the screen. Up and forward = uppercut, swing across = hook, fists up/down = block.', 'Video stays on your device: only the punch counts are sent.'],
        pads: ['Tap the pads, or use the keys: F jab, J cross, D left hook, K right hook, U uppercut, Space block.', 'It\'s practice: pad rounds can\'t be used in bouts.']
      }[device];
      return '<div class="rc-brief"><h3>' + esc(GEAR[device].title) + '</h3><ol>' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>' +
        (device === 'pads' ? '' : '<p class="warn">Clear space around you, nothing breakable in reach. Don\'t punch people, walls or screens. You train at your own risk.</p>') + '</div>';
    }

    host.addEventListener('click', function (e) {
      var d = e.target.closest('[data-dev]');
      if (d && !live) { device = d.getAttribute('data-dev'); UI.store.set('device', device); pick(); return; }
      var s = e.target.closest('[data-s]');
      if (s && !live) { secs = +s.getAttribute('data-s'); UI.store.set('secs', secs); pick(); return; }
      if (e.target.closest('[data-start]')) { start(); return; }
      if (e.target.closest('[data-cancel]')) { stopAll(); if (opts.cancel) opts.cancel(); return; }
      if (e.target.closest('[data-stop]')) { pick(); return; }
      if (e.target.closest('[data-redo]')) { pick(); return; }
      var keep = e.target.closest('[data-keep]');
      if (keep && host._round && !keep.disabled) {
        var r = host._round;
        if (opts.onKeep) UI.busy(keep, Promise.resolve().then(function () { return opts.onKeep(r); })).catch(function (err) { UI.toast(err.message || 'That did not go through.', 'error'); });
        else { host._round = null; resolve(r); }
      }
    });
    host.addEventListener('change', function (e) {
      var p = e.target.getAttribute && e.target.getAttribute('data-pref');
      if (p) SS.setPref(p, e.target.checked);
    });

    /* ---------------------------------------------------------------- running a round */
    function start() {
      SS.unlockAudio();
      var btn = host.querySelector('[data-start]');
      if (device === 'phone') {
        if (!hasMotion()) return pick('This device has no motion sensor. Open Subsudo on your phone, or pick the camera.');
        var ask = (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') ? DeviceMotionEvent.requestPermission() : Promise.resolve('granted');
        UI.busy(btn, Promise.resolve(ask)).then(function (res) {
          if (res !== 'granted') return pick('Motion access was refused. Allow "Motion & Orientation" for this site, then try again.');
          runPhone();
        }, function () { pick('Motion access was refused. Allow "Motion & Orientation" for this site, then try again.'); });
      } else if (device === 'camera') {
        if (!hasCamera()) return pick('No camera found. Try the phone instead.');
        UI.busy(btn, navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }))
          .then(runCamera, function () { pick('The camera didn\'t start. Allow camera access for this site (or close other apps using it).'); });
      } else runPads();
    }

    function liveView(extra) {
      host.innerHTML = '<div class="rc"><div class="rc-live" data-live><div class="rc-top"><span class="rc-phase" data-phase>Get ready</span><span class="rc-time" data-time>' + fmt(secs) + '</span></div>' +
        '<div class="rc-big"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/>' +
        '<circle data-arc cx="50" cy="50" r="45" fill="none" stroke="#c4362b" stroke-width="7" stroke-linecap="round" stroke-dasharray="282.7" stroke-dashoffset="0"/></svg>' +
        '<div class="n"><b data-count>0</b><span>punches</span></div></div><div class="rc-last" data-last>&nbsp;</div>' +
        '<div class="rc-hands"><div><b data-n="L">0</b><span>Left</span></div><div><b data-n="B">0</b><span>Blocks</span></div><div><b data-n="R">0</b><span>Right</span></div></div>' +
        (extra || '') + '<p class="rc-msg" data-msg></p><button class="ui-btn ghost sm" data-stop>' + UI.icon('x') + 'Stop</button></div></div>';
      return host.querySelector('[data-live]');
    }

    /* steps: [{kind: 'count'|'fight'|'break', dur, hand, label}] run on a clock that tests can speed up */
    function run(steps, hooks) {
      var events = [], el = host.querySelector('[data-live]'), stepI = -1, stepStart = 0, offset = 0, lastBeep = -1, noSignal = false;
      var counts = { L: 0, R: 0, B: 0 };
      var cur = null;
      var now = function () { return performance.now() * SS.timeScale; };
      function q(s) { return host.querySelector(s); }
      function overlay(html) {
        var o = el.querySelector('.rc-count');
        if (!html) { if (o) o.remove(); return; }
        if (!o) { o = document.createElement('div'); o.className = 'rc-count'; el.appendChild(o); }
        o.innerHTML = html;
      }
      function next() {
        if (cur && cur.kind === 'fight') offset += cur.dur * 1000;
        stepI++;
        cur = steps[stepI];
        stepStart = now(); lastBeep = -1;
        if (!cur) return finish();
        if (cur.kind === 'fight') {
          overlay(null);
          SS.bell(1); SS.buzz(250);
          q('[data-phase]').textContent = cur.label;
          if (hooks.onFight) hooks.onFight(cur);
        } else if (cur.kind === 'break') {
          SS.bell(2); SS.buzz([120, 80, 120]);
          SS.say(cur.say || cur.label);
          overlay('<b>' + Math.ceil(cur.dur) + '</b><p>' + esc(cur.label) + '</p>');
        } else {
          overlay('<b>' + Math.ceil(cur.dur) + '</b><p>' + esc(cur.label) + '</p>');
          if (cur.say) SS.say(cur.say);
        }
      }
      function tick() {
        if (!cur) return;
        var el2 = (now() - stepStart) / 1000, left = cur.dur - el2;
        if (cur.kind !== 'fight') {
          var n = Math.ceil(left);
          if (n !== lastBeep && n > 0) { lastBeep = n; if (n <= 3) SS.beep(false); var b = el.querySelector('.rc-count b'); if (b) b.textContent = n; }
        } else {
          var total = steps.filter(function (s) { return s.kind === 'fight'; }).reduce(function (a, s) { return a + s.dur; }, 0);
          var done = offset / 1000 + el2;
          q('[data-time]').textContent = fmt(total - done);
          q('[data-arc]').setAttribute('stroke-dashoffset', String(282.7 * clamp(done / total, 0, 1)));
          if (hooks.check) { var m = hooks.check(el2); if (m && !noSignal) { noSignal = true; q('[data-msg]').textContent = m; } }
          if (left <= 10 && !cur.said10 && cur.dur >= 20 && stepI === steps.length - 1) { cur.said10 = true; SS.say('Ten seconds'); }
        }
        if (left <= 0) next();
      }
      function hit(ev) {
        if (!cur || cur.kind !== 'fight') return;
        var t = Math.round(offset + (now() - stepStart));
        var hand = ev.hand || cur.hand || 'R';
        events.push([t, hand, ev.type, ev.speed]);
        if (ev.type === 'b') counts.B++; else counts[hand]++;
        q('[data-count]').textContent = counts.L + counts.R;
        q('[data-n="L"]').textContent = counts.L; q('[data-n="R"]').textContent = counts.R; q('[data-n="B"]').textContent = counts.B;
        var last = q('[data-last]');
        last.textContent = SS.TYPE_NAMES[ev.type] + (ev.type === 'b' ? '' : ' · ' + ev.speed.toFixed(1) + ' m/s');
        last.classList.remove('pop'); void last.offsetWidth; last.classList.add('pop');
        el.classList.remove('flash', 'flash-b'); void el.offsetWidth; el.classList.add(ev.type === 'b' ? 'flash-b' : 'flash');
        SS.thud(ev.speed, ev.type === 'b');
        SS.buzz(ev.type === 'b' ? 15 : 35);
      }
      function finish() {
        overlay(null);
        SS.bell(3);
        SS.say('Time!');
        var t = timers.slice(); t.forEach(function (x) { clearInterval(x); }); timers = [];
        if (hooks.stop) hooks.stop();
        summary(events);
      }
      timers.push(setInterval(tick, 40));
      next();
      return hit;
    }

    function summary(events) {
      stopAll();
      var sc = SS.score(events, secs), s = sc.stats;
      host._round = { device: device, secs: secs, events: events, score: sc.score, stats: s };
      host.innerHTML = '<div class="rc"><div class="ui-card rc-sum"><div class="ss-sub">Your round</div><div class="big">' + sc.score + '</div>' +
        '<div class="rc-grid"><div><b>' + s.punches + '</b><span>Punches</span></div><div><b>' + s.blocks + '</b><span>Blocks</span></div>' +
        '<div><b>' + s.top_speed.toFixed(1) + '</b><span>Top m/s</span></div><div><b>' + s.combos + '</b><span>Combos</span></div>' +
        '<div><b>' + s.hands.L.punches + '</b><span>Left</span></div><div><b>' + s.hands.R.punches + '</b><span>Right</span></div>' +
        '<div><b>' + s.uppercuts + '</b><span>Uppercuts</span></div><div><b>' + s.hooks + '</b><span>Hooks</span></div></div>' +
        (s.punches === 0 ? '<div class="ui-error" style="margin-bottom:14px">No punches counted. Grip the phone tighter and punch harder, or try the camera.</div>' : '') +
        '<div class="ui-row" style="justify-content:center"><button class="ui-btn primary lg" data-keep>' + UI.icon('check') + esc(opts.keepLabel || 'Use this round') + '</button>' +
        '<button class="ui-btn lg" data-redo>' + UI.icon('refresh') + 'Redo</button></div>' +
        '<p class="small muted" style="margin:12px 0 0">Speeds are estimates from your ' + esc(device === 'pads' ? 'taps' : device) + '. The server scores the punch log again; that\'s the score that counts.</p></div></div>';
    }

    function wakeLock() {
      try {
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { cleanups.push(function () { l.release(); }); }, function () {});
      } catch (e) {}
    }

    function runPhone() {
      liveView();
      wakeLock();
      var hit = null;
      var det = new PhoneDetector(function (ev) { if (hit) hit(ev); });
      var onMotion = function (s) { det.feed(s); };
      var listener = function (e) {
        var a = e.acceleration, g = e.accelerationIncludingGravity, r = e.rotationRate;
        onMotion({ t: performance.now(), ax: a && a.x != null ? a.x : null, ay: a && a.y, az: a && a.z,
          gx: g && g.x != null ? g.x : null, gy: g && g.y, gz: g && g.z, rot: r ? Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) : 0 });
      };
      window.addEventListener('devicemotion', listener);
      cleanups.push(function () { window.removeEventListener('devicemotion', listener); });
      live = { onMotion: onMotion };
      var half = secs / 2;
      hit = run([{ kind: 'count', dur: 3, label: 'Right fist. Get ready', say: 'Right hand' },
        { kind: 'fight', dur: half, hand: 'R', label: 'Right hand' },
        { kind: 'break', dur: 5, label: 'Switch to your left fist', say: 'Switch! Left hand' },
        { kind: 'fight', dur: half, hand: 'L', label: 'Left hand' }], {
        onFight: function (step) { det.hand = step.hand; det.until = 0; det.win = null; },
        check: function (el2) { return el2 > 2 && det.samples === 0 ? 'No movement data from this device. Use your phone, or switch to the camera.' : null; }
      });
    }

    function runCamera(stream) {
      cleanups.push(function () { stream.getTracks().forEach(function (t) { t.stop(); }); });
      var el = liveView('<div class="rc-cam"><span class="tag" data-camtag>Loading the hand tracker…</span><video playsinline muted autoplay></video><canvas></canvas></div>');
      var video = el.querySelector('video'), canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
      video.srcObject = stream;
      var det = new CameraDetector(function (ev) { if (hit) hit(ev); });
      var hit = null, raf = 0, stopped = false, model = null, lastT = 0, both = 0, started = 0;
      cleanups.push(function () { stopped = true; cancelAnimationFrame(raf); });
      function draw(res) {
        if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480; }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        (res.landmarks || []).forEach(function (lm, i) {
          var x = 0, y = 0; [0, 5, 9, 13, 17].forEach(function (k) { x += lm[k].x; y += lm[k].y; });
          x = x / 5 * canvas.width; y = y / 5 * canvas.height;
          var r = Math.hypot((lm[0].x - lm[9].x) * canvas.width, (lm[0].y - lm[9].y) * canvas.height) * 1.1;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? 'rgba(196,54,43,.55)' : 'rgba(208,155,53,.55)'; ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.stroke();
        });
      }
      function loop() {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (!model || video.readyState < 2) return;
        var t = performance.now();
        if (t - lastT < 30) return;
        lastT = t;
        var res;
        try { res = model.detectForVideo(video, t); } catch (e) { return; }
        draw(res);
        var hands = (res.landmarks || []).map(function (lm, i) {
          var hd = (res.handedness || res.handednesses || [])[i];
          var label = hd && hd[0] ? hd[0].categoryName : (lm[0].x > 0.5 ? 'Left' : 'Right');
          // the camera picture isn't mirrored, so MediaPipe's "Left" is the fighter's right hand
          return { hand: label === 'Left' ? 'R' : 'L', lm: lm };
        });
        if (!hit) {
          both = hands.length >= 2 ? both + 1 : 0;
          if (both > 12 || (started && t - started > 9000 && hands.length)) begin();
          return;
        }
        det.feed(t, hands, (video.videoWidth || 4) / (video.videoHeight || 3));
      }
      function begin() {
        el.querySelector('[data-camtag]').textContent = 'Tracking';
        hit = run([{ kind: 'count', dur: 3, label: 'Both fists. Get ready', say: 'Fight!' }, { kind: 'fight', dur: secs, label: 'Both hands' }], {
          check: function (el2) {
            var t = performance.now();
            return el2 > 3 && t - det.seen.L > 2500 && t - det.seen.R > 2500 ? 'We can\'t see your fists. Step back and turn on a light.' : null;
          }, stop: function () { stopped = true; }
        });
      }
      video.play().catch(function () {});
      el.querySelector('[data-phase]').textContent = 'Fists up';
      raf = requestAnimationFrame(loop);
      SS.loadHands().then(function (m) {
        if (stopped) return;
        model = m; started = performance.now();
        el.querySelector('[data-camtag]').textContent = 'Show both fists';
        el.querySelector('[data-msg]').textContent = 'Raise both fists so the camera can see them.';
      }, function (e) {
        console.warn(e);
        if (!stopped) pick('The hand tracker didn\'t load (it needs an internet connection and a recent browser). Try the phone instead.');
      });
    }

    function runPads() {
      var keys = [['F', 'L', 's', 'Jab'], ['J', 'R', 's', 'Cross'], ['U', 'R', 'u', 'Uppercut'], ['D', 'L', 'h', 'L hook'], ['K', 'R', 'h', 'R hook'], [' ', 'L', 'b', 'Block']];
      var el = liveView('<div class="rc-pads">' + keys.map(function (k, i) {
        return '<button type="button" data-pad="' + i + '" class="' + (k[2] === 'b' ? 'blk' : '') + '">' + k[3] + '<small>' + (k[0] === ' ' ? 'Space' : k[0]) + '</small></button>';
      }).join('') + '</div>');
      var hit = run([{ kind: 'count', dur: 3, label: 'Hit the pads', say: 'Fight!' }, { kind: 'fight', dur: secs, label: 'Pad work' }], {});
      function pad(i) {
        var k = keys[i];
        var b = el.querySelector('[data-pad="' + i + '"]'); if (b) { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); }
        hit({ hand: k[1], type: k[2], speed: +(3.2 + Math.random() * 2.6).toFixed(2) });
      }
      el.addEventListener('pointerdown', function (e) { var b = e.target.closest('[data-pad]'); if (b) { e.preventDefault(); pad(+b.getAttribute('data-pad')); } });
      var onKey = function (e) {
        var i = keys.findIndex(function (k) { return k[0] === e.key.toUpperCase() || (k[0] === ' ' && e.key === ' '); });
        if (i >= 0) { e.preventDefault(); pad(i); }
      };
      document.addEventListener('keydown', onKey);
      cleanups.push(function () { document.removeEventListener('keydown', onKey); });
      live = { pad: pad };
    }
    SS.tapPad = function (i) { if (live && live.pad) live.pad(i); };

    pick();
    return { promise: promise, destroy: stopAll };
  };
})();

/* ===== admin.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['overview', 'Overview', 'grid'], ['challenges', 'Challenges', 'house'], ['log', 'Fight log', 'ranks'], ['feedback', 'Feedback', 'inbox'], ['users', 'Users', 'users'], ['demo', 'Demo data', 'database']];

  UI.page('admin', { title: 'Admin', auth: 'admin' }, function (view, ctx) {
    var tab = TABS.some(function (t) { return t[0] === ctx.args[0]; }) ? ctx.args[0] : 'overview';
    var fbFilter = 'new';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Admin</h1><p class="muted">Only admins see this page.</p></div></div>' +
      '<nav class="ui-tabs">' + TABS.map(function (t) {
        return '<a href="#admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>';
      }).join('') + '</nav><div data-body><div class="ui-skel"></div></div></div>';
    var body = view.querySelector('[data-body]');

    function overview() {
      return UI.api('admin_overview').then(function (d) {
        var stat = function (n, label, go) { return '<a class="ui-card ui-stat" href="#admin/' + go + '" style="text-decoration:none;color:inherit"><b>' + n + '</b><span>' + label + '</span></a>'; };
        body.innerHTML = '<div class="ad-stats">' + stat(d.users, 'people signed up', 'users') + stat(d.admins, UI.plural(d.admins, 'admin').replace(/^\d+ /, ''), 'users') +
          stat(d.feedback_new, 'new feedback', 'feedback') + stat(d.fights, 'bouts fought', 'log') + stat(d.waiting, 'bouts waiting', 'log') +
          stat(d.rounds, 'rounds recorded', 'log') + stat(d.flagged, 'rounds flagged', 'log') + stat(d.campaigns, 'active challenges', 'challenges') + '</div>' +
          '<p class="muted small" style="margin-top:18px">Demo data is <b>' + esc(d.demo.state) + '</b> (' + d.demo.counts.users + ' demo people). Manage it in the Demo data tab.</p>';
      });
    }

    function feedback() {
      return UI.api('list_feedback', null).then(function (d) {
        var items = d.items.filter(function (i) { return fbFilter === 'all' || i.status === fbFilter; });
        body.innerHTML = '<div class="ui-row" style="margin-bottom:16px"><div class="ui-seg">' + [['new', 'New'], ['read', 'Read'], ['done', 'Done'], ['all', 'All']].map(function (f) {
          var n = f[0] === 'all' ? d.items.length : d.counts[f[0]];
          return '<button data-filter="' + f[0] + '" class="' + (fbFilter === f[0] ? 'on' : '') + '">' + f[1] + ' (' + n + ')</button>';
        }).join('') + '</div></div>' +
          (items.length ? '<div class="ad-fb">' + items.map(function (i) {
            var c = i.context || {};
            return '<div class="ui-item" data-id="' + esc(i.id) + '"><div class="meta"><span class="ui-badge ' + (i.kind === 'bug' ? 'bad' : i.kind === 'idea' ? 'brand' : '') + '">' + esc(i.kind_label) + '</span>' +
              '<b>' + esc(i.name) + '</b>' + (i.email ? '<a href="mailto:' + esc(i.email) + '">' + esc(i.email) + '</a>' : '') + '<span>' + esc(UI.fmtDateTime(i.created)) + '</span></div>' +
              '<p class="msg">' + esc(i.message) + '</p>' +
              '<div class="ctx">' + esc([c.page, c.screen, c.theme, c.browser].filter(Boolean).join(' · ')) + '</div>' +
              '<textarea data-note placeholder="Private note (only admins see it)">' + esc(i.note) + '</textarea>' +
              '<div class="ui-row" style="margin-top:10px">' + ['new', 'read', 'done'].map(function (s) {
                return '<button class="ui-btn sm' + (i.status === s ? ' primary' : '') + '" data-status="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>';
              }).join('') + '<span class="ui-spacer"></span><button class="ui-btn sm danger" data-del-fb>' + UI.icon('trash') + 'Delete</button></div></div>';
          }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('inbox') + '<h3>No ' + (fbFilter === 'all' ? '' : fbFilter + ' ') + 'messages</h3><p>New feedback goes to Prepsto (prepsto.com). Older messages and requests from the app show up here.</p></div>');
      });
    }

    function users(query) {
      return UI.api('list_users', query || null).then(function (d) {
        body.innerHTML = '<form class="ui-row" data-search style="margin-bottom:14px"><input type="search" name="q" placeholder="Search by name or email" value="' + esc(query || '') + '" style="max-width:360px">' +
          '<button class="ui-btn" type="submit">' + UI.icon('search') + 'Search</button><span class="muted small">' + UI.plural(d.total, 'person', 'people') + '</span></form>' +
          '<table class="ad-users"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Admin</th><th>Active</th></tr></thead><tbody>' +
          d.users.map(function (u) {
            return '<tr data-id="' + esc(u.id) + '"><td><b>' + esc(u.name) + '</b></td><td class="email">' + esc(u.email) + '</td><td class="joined muted">' + esc(UI.fmtDate(u.joined)) + '</td>' +
              '<td><label class="ui-check"><input type="checkbox" data-admin' + (u.is_admin ? ' checked' : '') + '> Admin</label></td>' +
              '<td><label class="ui-check"><input type="checkbox" data-enabled' + (u.enabled ? ' checked' : '') + '> Active</label></td></tr>';
          }).join('') + '</tbody></table>';
      });
    }

    function demo() {
      return UI.api('admin_overview').then(function (d) {
        var c = d.demo.counts;
        body.innerHTML = '<div class="ui-card ui-narrow" style="margin:0"><h3>Demo data</h3>' +
          '<p class="muted">Example people and content, so the app never looks empty for the first visitors. Demo rows are flagged, so removing them never touches real data. Once removed, it stays removed until you load it again.</p>' +
          '<p>Status: <b>' + esc(d.demo.state) + '</b> · ' + Object.keys(c).map(function (k) { return c[k] + ' ' + esc(k); }).join(', ') + '</p>' +
          '<div class="ui-row"><button class="ui-btn primary" data-demo="load">' + UI.icon('refresh') + (d.demo.state === 'loaded' ? 'Reload demo data' : 'Load demo data') + '</button>' +
          '<button class="ui-btn danger" data-demo="remove">' + UI.icon('trash') + 'Remove demo data</button></div></div>';
      });
    }

    /* ---------------------------------------------------------------- house challenges */
    var camp = { picked: [], aud: 'all' };
    function audience() {
      var f = body.querySelector('[data-camp]');
      if (!f) return { type: 'all' };
      var a = { type: camp.aud };
      if (camp.aud === 'idle') a.days = +f.querySelector('[name=idle_days]').value || 14;
      if (camp.aud === 'city') a.city_key = (f.querySelector('[name=city_key]') || {}).value;
      if (camp.aud === 'picked') a.ids = camp.picked.map(function (p) { return p.id; });
      return a;
    }
    var audTimer = null;
    function countAudience() {
      clearTimeout(audTimer);
      audTimer = setTimeout(function () {
        var el = body.querySelector('[data-aud-count]');
        if (!el) return;
        UI.apiQuiet('admin_audience', audience()).then(function (r) {
          el.innerHTML = '<span class="ad-count">' + UI.plural(r.count, 'fighter') + '</span>' + (r.sample.length ? '<div class="small muted">' + r.sample.map(esc).join(', ') + (r.count > r.sample.length ? '…' : '') + '</div>' : '');
          var b = body.querySelector('[data-camp] [type=submit]');
          if (b) { b.disabled = !r.count; b.querySelector('span').textContent = 'Send to ' + UI.plural(r.count, 'fighter'); }
        }, function () {});
      }, 200);
    }
    function chips() {
      var el = body.querySelector('[data-chips]');
      if (el) el.innerHTML = camp.picked.map(function (p, i) { return '<button type="button" data-unpick="' + i + '">' + esc(p.ring) + ' ' + UI.icon('x') + '</button>'; }).join('');
    }
    function challenges() {
      return UI.api('admin_campaigns').then(function (d) {
        var aud = [['all', 'Everyone'], ['idle', 'No bout in the last'], ['never', 'Never fought'], ['city', 'Fighters in'], ['picked', 'Picked fighters']];
        body.innerHTML = '<div class="ad-cols"><form class="ui-card ad-form" data-camp><div class="full"><h3 style="margin:0">Send a house challenge</h3>' +
          '<p class="muted small" style="margin:4px 0 0">For members who have nobody to fight. A house fighter throws one round (the same for everyone); each member gets a bout in their Mail.</p></div>' +
          '<label class="ui-field full"><span>Title</span><input type="text" name="title" maxlength="80" required placeholder="Friday Fight Night"></label>' +
          '<label class="ui-field"><span>House fighter</span><input type="text" name="house_name" list="ad-house" maxlength="40" required value="' + esc(d.house_fighters[0]) + '">' +
          '<datalist id="ad-house">' + d.house_fighters.map(function (h) { return '<option value="' + esc(h) + '">'; }).join('') + '</datalist></label>' +
          '<label class="ui-field"><span>How hard they hit</span><select name="level">' + d.levels.map(function (l) {
            return '<option value="' + l.key + '"' + (l.key === 'club' ? ' selected' : '') + '>' + esc(l.name) + ' · ~' + l.ppm + '/min, ' + l.speed + ' m/s</option>';
          }).join('') + '</select></label>' +
          '<label class="ui-field"><span>Round</span><select name="secs"><option value="30">30 seconds</option><option value="60" selected>60 seconds</option><option value="90">90 seconds</option></select></label>' +
          '<label class="ui-field"><span>Bonus for a win</span><input type="number" name="bonus" min="0" max="200" value="10"></label>' +
          '<label class="ui-field"><span>Days to answer</span><input type="number" name="days" min="1" max="30" value="7"></label>' +
          '<label class="ui-field full"><span>Message <em>(optional)</em></span><textarea name="message" maxlength="400" placeholder="Big Dee is in the building. 60 seconds, no excuses."></textarea></label>' +
          '<div class="ui-field full"><span>Who gets it</span><div class="ad-aud">' + aud.map(function (a) {
            var extra = a[0] === 'idle' ? ' <input type="number" name="idle_days" min="1" max="365" value="14"> days'
              : a[0] === 'city' ? ' <select name="city_key">' + d.cities.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.city) + ' (' + c.fighters + ')</option>'; }).join('') + '</select>' : '';
            return '<label class="ui-check"><input type="radio" name="aud" value="' + a[0] + '"' + (camp.aud === a[0] ? ' checked' : '') + '> ' + a[1] + extra + '</label>';
          }).join('') + '<div data-pick ' + (camp.aud === 'picked' ? '' : 'hidden') + '><input type="search" data-member placeholder="Find by ring name, name or email"><div class="ad-chips" data-found style="margin-top:6px"></div>' +
          '<div class="ad-chips" data-chips style="margin-top:6px"></div></div></div></div>' +
          '<div class="full" data-aud-count></div><div class="full"><button class="ui-btn primary" type="submit">' + UI.icon('send') + '<span>Send</span></button></div></form>' +
          '<div><h3>Sent challenges</h3>' + (d.campaigns.length ? '<div class="ui-list">' + d.campaigns.map(function (c) {
            return '<div class="ui-card tight ad-camp"><div class="ui-row between"><b>' + esc(c.title) + '</b><span class="ui-badge' + (c.status === 'active' ? ' good' : '') + '">' + esc(c.status) + '</span></div>' +
              '<div class="small muted">' + esc(c.house_name) + ' · ' + esc(c.level) + ' · ' + c.secs + 's' + (c.bonus ? ' · +' + c.bonus + ' bonus' : '') + ' · ' + esc(UI.fmtDate(c.created)) + (c.demo ? ' · demo' : '') + '</div>' +
              '<div class="nums"><div><b>' + c.sent + '</b><span>Sent</span></div><div><b>' + c.answered + '</b><span>Fought</span></div><div><b>' + c.house_wins + '</b><span>House won</span></div>' +
              '<div><b>' + (c.answered ? Math.round(100 * (c.answered - c.house_wins) / c.answered) + '%' : '–') + '</b><span>Members won</span></div></div>' +
              (c.status === 'active' ? '<div><button class="ui-btn sm danger" data-cancel-camp="' + esc(c.id) + '">' + UI.icon('x') + 'Cancel unanswered</button></div>' : '') + '</div>';
          }).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('house') + '<h3>None yet</h3></div>') + '</div></div>';
        chips();
        countAudience();
      });
    }

    /* ---------------------------------------------------------------- fight log */
    var logF = { q: '', status: '', kind: '' }, logRows = [];
    function log() {
      return UI.api('admin_fight_log', logF.q || null, logF.status || null, logF.kind || null).then(function (d) {
        logRows = d.fights;
        var opt = function (name, vals) {
          return '<select name="' + name + '"><option value="">' + (name === 'status' ? 'Any status' : 'Any kind') + '</option>' + vals.map(function (v) {
            return '<option' + (logF[name] === v ? ' selected' : '') + '>' + v + '</option>';
          }).join('') + '</select>';
        };
        body.innerHTML = '<form class="ui-row" data-logf style="margin-bottom:14px"><input type="search" name="q" value="' + esc(logF.q) + '" placeholder="Fighter name" style="max-width:220px">' +
          opt('status', ['done', 'pending', 'open', 'declined', 'cancelled', 'expired']) + opt('kind', ['ranked', 'open', 'invite', 'house']) +
          '<button class="ui-btn" type="submit">' + UI.icon('filter') + 'Filter</button><span class="muted small">' + UI.plural(d.total, 'bout') + ' · ' + d.rounds + ' rounds in all</span>' +
          '<span class="ui-spacer"></span><button class="ui-btn" type="button" data-csv>' + UI.icon('download') + 'CSV</button></form>' +
          '<div class="ad-logwrap"><table class="ad-log"><thead><tr><th>When</th><th>Kind</th><th>A</th><th>B</th><th class="opt">Devices</th><th>Score</th><th>Result</th><th class="opt">Flags</th></tr></thead><tbody>' +
          d.fights.map(function (f) {
            return '<tr data-bout="' + esc(f.id) + '"><td>' + esc(UI.fmtDate(f.created, { day: 'numeric', month: 'short' })) + '</td><td>' + esc(f.kind) + (f.demo ? ' <span class="faint">demo</span>' : '') + '</td>' +
              '<td>' + esc(f.a) + '</td><td>' + esc(f.b) + '</td><td class="opt">' + esc(f.a_device) + (f.b_device ? ' / ' + esc(f.b_device) : '') + '</td>' +
              '<td>' + (f.a_score != null ? f.a_score : '–') + (f.b_score != null ? ' : ' + f.b_score : '') + '</td><td>' +
              esc(f.status === 'done' ? (f.winner === 'draw' ? 'draw' : f.winner.toUpperCase() + ' · ' + f.method) : f.status) + '</td>' +
              '<td class="opt fl">' + esc(f.flags.join(', ')) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      });
    }
    function csv() {
      var cols = ['id', 'created', 'finished', 'kind', 'status', 'a', 'b', 'a_device', 'b_device', 'a_score', 'b_score', 'a_punches', 'b_punches', 'winner', 'method', 'city', 'flags', 'demo'];
      var q = function (v) { v = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var text = cols.join(',') + '\n' + logRows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); }).join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      a.download = 'subsudo-fights-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    }

    var DRAW = { overview: overview, challenges: challenges, log: log, feedback: feedback, users: users, demo: demo };

    view.addEventListener('click', function (e) {
      var unp = e.target.closest('[data-unpick]');
      if (unp) { camp.picked.splice(+unp.getAttribute('data-unpick'), 1); chips(); countAudience(); return; }
      var pk = e.target.closest('[data-pickid]');
      if (pk) {
        if (!camp.picked.some(function (p) { return p.id === pk.getAttribute('data-pickid'); })) camp.picked.push({ id: pk.getAttribute('data-pickid'), ring: pk.getAttribute('data-ring') });
        chips(); countAudience(); return;
      }
      var cc = e.target.closest('[data-cancel-camp]');
      if (cc) {
        UI.confirm({ title: 'Cancel this challenge?', text: 'Bouts nobody answered yet are cancelled. Finished ones stay.', ok: 'Cancel them', cancel: 'Keep', danger: true }).then(function (yes) {
          if (yes) UI.api('admin_cancel_campaign', cc.getAttribute('data-cancel-camp')).then(function (r) { UI.toast(UI.plural(r.cancelled, 'bout') + ' cancelled', 'ok'); challenges(); });
        });
        return;
      }
      var tr = e.target.closest('tr[data-bout]');
      if (tr) { UI.go('bout', tr.getAttribute('data-bout')); return; }
      if (e.target.closest('[data-csv]')) { csv(); }
    });
    var memberTimer = null;
    view.addEventListener('input', function (e) {
      if (e.target.matches('[data-member]')) {
        clearTimeout(memberTimer);
        var qv = e.target.value;
        memberTimer = setTimeout(function () {
          UI.apiQuiet('admin_find_members', qv).then(function (r) {
            var el = body.querySelector('[data-found]');
            if (el) el.innerHTML = r.members.map(function (m) {
              return '<button type="button" data-pickid="' + esc(m.id) + '" data-ring="' + esc(m.ring) + '">' + UI.icon('plus') + esc(m.ring) + ' <span class="faint">' + esc(m.email) + '</span></button>';
            }).join('');
          }, function () {});
        }, 250);
      } else if (e.target.closest('[data-camp]') && e.target.name === 'idle_days') countAudience();
    });
    view.addEventListener('change', function (e) {
      var f = e.target.closest('[data-camp]');
      if (f && e.target.name === 'aud') { camp.aud = e.target.value; f.querySelector('[data-pick]').hidden = camp.aud !== 'picked'; countAudience(); }
      else if (f && (e.target.name === 'city_key' || e.target.name === 'idle_days')) countAudience();
    });
    view.addEventListener('submit', function (e) {
      if (e.target.matches('[data-camp]')) {
        e.preventDefault();
        var form = e.target, v = UI.formData(form);
        v.audience = audience();
        UI.confirm({ title: 'Send "' + (v.title || '') + '"?', text: 'Each fighter in the audience gets a bout from ' + v.house_name + ' in their Mail.', ok: 'Send it' }).then(function (yes) {
          if (!yes) return;
          UI.busy(form.querySelector('[type=submit]'), UI.api('admin_send_campaign', v)).then(function (r) { UI.toast('Sent to ' + UI.plural(r.sent, 'fighter'), 'ok'); camp.picked = []; challenges(); });
        });
      } else if (e.target.matches('[data-logf]')) {
        e.preventDefault();
        var lv = UI.formData(e.target);
        logF = { q: lv.q, status: lv.status, kind: lv.kind };
        log();
      }
    });
    view.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { fbFilter = f.getAttribute('data-filter'); feedback(); return; }
      var st = e.target.closest('[data-status]');
      if (st) {
        var card = st.closest('[data-id]');
        UI.api('set_feedback_status', card.getAttribute('data-id'), st.getAttribute('data-status'), card.querySelector('[data-note]').value).then(function () { UI.toast('Saved', 'ok'); feedback(); });
        return;
      }
      var del = e.target.closest('[data-del-fb]');
      if (del) {
        UI.confirm({ title: 'Delete this message?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_feedback', del.closest('[data-id]').getAttribute('data-id')).then(feedback);
        });
        return;
      }
      var dm = e.target.closest('[data-demo]');
      if (dm) {
        var load = dm.getAttribute('data-demo') === 'load';
        UI.confirm({ title: load ? 'Load the demo data?' : 'Remove the demo data?', text: load ? 'Demo people and content are added (any old demo rows are replaced).' : 'Every demo row is deleted. Real data stays.', ok: load ? 'Load' : 'Remove', danger: !load })
          .then(function (yes) { if (yes) UI.busy(dm, UI.api(load ? 'demo_load' : 'demo_remove')).then(function () { UI.toast('Done', 'ok'); demo(); }); });
      }
    });
    view.addEventListener('change', function (e) {
      var row = e.target.closest('tr[data-id]');
      if (!row) return;
      var id = row.getAttribute('data-id'), box = e.target;
      var fn = box.hasAttribute('data-admin') ? 'set_admin' : box.hasAttribute('data-enabled') ? 'set_enabled' : null;
      if (fn) UI.api(fn, id, box.checked).then(function () { UI.toast('Saved', 'ok'); }, function (err) { box.checked = !box.checked; UI.toast(err.message, 'error'); });
    });
    view.addEventListener('submit', function (e) {
      if (e.target.matches('[data-search]')) { e.preventDefault(); users(UI.formData(e.target).q); }
    });
    return DRAW[tab]();
  });
})();

/* ===== auth.html ===== */
(function () {
  var esc = UI.esc;
  var GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  function pw(name, auto) {
    return '<div class="au-pw"><input type="password" name="' + name + '" autocomplete="' + auto + '" required minlength="8">' +
      '<button type="button" data-show>Show</button></div>';
  }
  UI.page('auth', { title: 'Sign in', auth: 'guest' }, function (view, ctx) {
    var mode = ['signup', 'reset'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'login';
    function draw(msg, isErr) {
      var heading = { login: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' }[mode];
      var sub = { login: 'Sign in to continue to ' + esc(UI.config.name) + '.', signup: 'It\'s free and takes a few seconds.',
        reset: 'We\'ll email you a link to choose a new password.' }[mode];
      view.innerHTML = '<div class="au-wrap"><div class="ui-card au-card">' +
        '<h1>' + heading + '</h1><p class="muted">' + sub + '</p>' +
        (mode !== 'reset' ? '<div class="ui-seg" role="tablist"><button type="button" data-mode="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button>' +
          '<button type="button" data-mode="signup" class="' + (mode === 'signup' ? 'on' : '') + '">Create account</button></div>' : '<div style="height:14px"></div>') +
        '<form class="ui-stack" data-form="' + mode + '" novalidate>' +
        (mode === 'signup' ? '<label class="ui-field"><span>Your name</span><input type="text" name="name" autocomplete="name" required maxlength="60"></label>' : '') +
        '<label class="ui-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>' +
        (mode === 'login' ? '<label class="ui-field"><span>Password</span>' + pw('password', 'current-password') + '</label>' : '') +
        (mode === 'signup' ? '<label class="ui-field"><span>Password <em>(at least 8 characters)</em></span>' + pw('password', 'new-password') + '</label>' +
          (window.LegalKit ? '<div>' + LegalKit.consentField() + '</div>' : '') : '') +
        '<div data-msg role="alert"' + (msg ? ' class="' + (isErr ? 'ui-error' : 'ui-note') + '">' + esc(msg) : ' hidden>') + '</div>' +
        '<button class="ui-btn primary block" type="submit">' + { login: 'Sign in', signup: 'Create account', reset: 'Send the link' }[mode] + '</button></form>' +
        (mode !== 'reset' ? '<div class="au-or">or</div><button type="button" class="ui-btn block au-google" data-google>' + GOOGLE_G + 'Continue with Google</button>' : '') +
        '<div class="au-links">' + (mode === 'login' ? '<a data-mode="reset">Forgot your password?</a>' : '<a data-mode="login">' + UI.icon('back') + ' Back to sign in</a>') +
        '<a href="#landing" data-go="landing">About ' + esc(UI.config.name) + '</a></div></div></div>';
      var first = view.querySelector('input');
      if (first && !msg) first.focus();
    }
    view.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) { e.preventDefault(); mode = m.getAttribute('data-mode'); history.replaceState(null, '', '#auth' + (mode === 'login' ? '' : '/' + mode)); draw(); return; }
      var g = e.target.closest('[data-google]');
      if (g) { google(g); return; }
      var s = e.target.closest('[data-show]');
      if (s) { var i = s.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; s.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target, v = UI.formData(form);
      var problem = !/^\S+@\S+\.\S+$/.test(v.email || '') ? 'Please enter a valid email address.'
        : mode !== 'reset' && (v.password || '').length < (mode === 'signup' ? 8 : 1) ? (mode === 'signup' ? 'Please choose a password of at least 8 characters.' : 'Please enter your password.')
        : mode === 'signup' && (v.name || '').trim().length < 2 ? 'Please tell us your name.' : null;
      if (problem) { say(problem, true); return; }
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;  // the kit shows its own message
      UI.busy(form.querySelector('[type=submit]'), UI.auth(mode, v)).then(function (r) {
        if (mode === 'reset' || (r && !r.me)) { mode = 'login'; draw(r && r.message, false); restore({ email: v.email }); }
        else UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    });
    // Sign-up asks for the Privacy & Terms tick here too (ticking it is remembered for the new account).
    function google(btn) {
      var form = view.querySelector('form'), v = mode === 'signup' ? UI.formData(form) : {};
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;
      UI.busy(btn, UI.auth('google', { name: (v.name || '').trim() })).then(function () {
        UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    }
    function say(msg, isErr) {
      var box = view.querySelector('[data-msg]');
      box.className = isErr ? 'ui-error' : 'ui-note'; box.textContent = msg; box.hidden = false;
    }
    function restore(v) {
      ['name', 'email'].forEach(function (k) { var i = view.querySelector('[name=' + k + ']'); if (i && v[k]) i.value = v[k]; });
    }
    draw();
  });
})();

/* ===== bout.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('bout', { title: 'Bout', auth: 'user' }, function (view, ctx) {
    var id = ctx.args[0];
    view.innerHTML = '<div class="ui-wrap">' + SS.loading() + '</div>';
    function draw(b) {
      var me = b.my_side, other = me === 'a' ? b.b : me === 'b' ? b.a : null;
      var head = '<div class="bt-meta"><a class="ui-btn ghost sm" href="#mail" data-go="mail">' + UI.icon('back') + 'Mail</a><span class="ui-badge' + (b.kind === 'house' ? ' brass' : '') + '">' +
        esc(b.kind_label) + '</span><span class="ui-badge">' + UI.icon('timer') + b.secs + 's round</span>' + (b.campaign ? '<span class="ui-badge brass">' + esc(b.campaign.title) + '</span>' : '') +
        SS.outcomeChip(b) + '<span class="small muted">' + SS.statusText(b) + '</span>' + (b.demo ? '<span class="ui-badge">Demo</span>' : '') + '</div>';
      var body = '';
      if (b.status === 'done') {
        var words = '<div class="bt-words">' + ['a', 'b'].map(function (k) {
          return b[k].words ? '<div class="bt-quote ' + k + '"><span>' + esc(SS.boutName(b[k])) + (k === 'a' ? ' · before' : '') + '</span><p>' + esc(b[k].words) + '</p></div>' : '';
        }).join('') + (b.can_words ? '<form class="ui-row" data-words style="flex-wrap:nowrap"><input type="text" name="words" maxlength="280" placeholder="Respect, or a rematch call…" value="' +
          esc(b[me].words && me === 'b' ? b[me].words : '') + '"><button class="ui-btn primary" type="submit">' + UI.icon('send') + 'Say it</button></form>' : '') + '</div>';
        if (!b.a.words && !b.b.words && !b.can_words) words = '<p class="muted small">No words were exchanged.</p>';
        body = '<div class="bt-cta">' + (other && other.fighter && !other.fighter.me ? '<a class="ui-btn primary" href="#fight/call/' + esc(other.fighter.id) + '" data-go="fight/call/' + esc(other.fighter.id) + '">' +
          UI.icon('refresh') + 'Rematch</a>' : '') + '<a class="ui-btn" href="#find" data-go="find">' + UI.icon('megaphone') + 'Find another fight</a></div>' +
          '<div class="bt-grid"><div class="ui-card">' + SS.resultHtml(b) + '</div><div class="ui-card"><h3>Tale of the tape</h3>' +
          '<div class="ss-vsbar" style="margin-bottom:10px"><span></span><span class="ss-sub">' + esc(SS.boutName(b.a)) + '</span><span></span><span class="ss-sub" style="text-align:right">' +
          esc(SS.boutName(b.b)) + '</span><span></span></div>' + SS.vsBars(b.a.stats, b.b.stats) + '</div></div>' +
          '<div class="ui-card" style="margin-top:16px"><h3>Punch log</h3>' + SS.timeline(b) + '</div>' +
          '<div class="ui-card" style="margin-top:16px"><h3>Words</h3>' + words + '</div>';
      } else if (b.can_answer) {
        body = (b.a.words ? '<p class="fg-words">“' + esc(b.a.words) + '” — ' + esc(SS.boutName(b.a)) + '</p>' : '') +
          '<div class="bt-cta"><a class="ui-btn primary lg" href="#fight/answer/' + esc(b.id) + '" data-go="fight/answer/' + esc(b.id) + '">' + UI.icon('glove') +
          (b.status === 'open' ? 'Take this call-out' : 'Fight back') + '</a>' + (b.can_decline ? '<button class="ui-btn lg ghost" data-decline>Duck it</button>' : '') + '</div>' +
          '<p class="muted small" style="text-align:center">' + (b.status === 'open' ? 'The first fighter to answer takes it. ' : 'Answer by ' + esc(UI.fmtDate(b.expires)) + '. ') +
          'The score stays sealed until you fight. Ducking counts on your record.</p>';
      } else if (b.can_cancel) {
        body = '<div class="ui-card" style="text-align:center"><h3>' + (b.status === 'open' ? 'Pinned to the board' : 'Waiting for ' + esc(SS.boutName(b.b))) + '</h3>' +
          '<p class="muted">Your score: <b>' + (b.a.score != null ? b.a.score : '–') + '</b>. ' + (b.status === 'open' ? 'Open until ' : 'They have until ') + esc(UI.fmtDate(b.expires)) + '.</p>' +
          '<div class="ui-row" style="justify-content:center">' + (b.invite_token ? '<button class="ui-btn primary" data-share>' + UI.icon('send') + 'Share the link again</button>' : '') +
          '<button class="ui-btn danger" data-cancel>' + UI.icon('x') + 'Cancel the bout</button></div></div>';
      } else {
        body = '<div class="ui-empty">' + UI.icon('info') + '<h3>' + SS.statusText(b) + '</h3><p>This bout is over without a result.</p></div>';
      }
      view.innerHTML = '<div class="ui-wrap">' + head + SS.poster(b) + body + '</div>';
      ctx.bout = b;
    }
    view.addEventListener('click', function (e) {
      var b = ctx.bout;
      if (!b) return;
      if (e.target.closest('[data-decline]')) {
        UI.confirm({ title: 'Duck this bout?', text: 'It counts as a duck on your fighter card, and ' + SS.boutName(b.a) + ' hears about it.', ok: 'Duck it', danger: true })
          .then(function (yes) { if (yes) UI.api('decline_bout', b.id).then(function (r) { UI.toast('Ducked.'); draw(r.bout); }); });
      }
      if (e.target.closest('[data-cancel]')) {
        UI.confirm({ title: 'Cancel this bout?', text: 'Your round is thrown out and nobody can answer it.', ok: 'Cancel it', cancel: 'Keep it', danger: true })
          .then(function (yes) { if (yes) UI.api('cancel_bout', b.id).then(function (r) { UI.toast('Cancelled'); draw(r.bout); }); });
      }
      if (e.target.closest('[data-share]')) SS.share(SS.inviteUrl(b.invite_token), 'You\'ve been called out on Subsudo. One round, your phone or your camera.');
    });
    view.addEventListener('submit', function (e) {
      if (!e.target.matches('[data-words]')) return;
      e.preventDefault();
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('post_words', ctx.bout.id, UI.formData(e.target).words)).then(function (r) { UI.toast('Said.', 'ok'); draw(r.bout); });
    });
    return UI.api('get_bout', id).then(function (r) { draw(r.bout); });
  });
})();

/* ===== fight.html ===== */
(function () {
  var esc = UI.esc;

  var poster = function (b) { return SS.poster(b); };

  function reveal(view, b) {
    var other = b.my_side === 'a' ? b.b : b.a;
    view.innerHTML = '<div class="ui-wrap ui-narrow">' + poster(b) + '<div class="ui-card">' + SS.resultHtml(b) + '</div>' +
      '<div class="ui-card" style="margin-top:14px"><div class="ss-vsbar" style="margin-bottom:10px"><span></span><span class="ss-sub">' + esc(SS.boutName(b.a)) + '</span><span></span>' +
      '<span class="ss-sub" style="text-align:right">' + esc(SS.boutName(b.b)) + '</span><span></span></div>' + SS.vsBars(b.a.stats, b.b.stats) + '</div>' +
      '<div class="ui-row" style="justify-content:center;margin-top:18px">' +
      '<a class="ui-btn primary" href="#bout/' + esc(b.id) + '" data-go="bout/' + esc(b.id) + '">' + UI.icon('ranks') + 'Punch log &amp; words</a>' +
      (other.fighter && !other.fighter.me ? '<a class="ui-btn" href="#fight/call/' + esc(other.fighter.id) + '" data-go="fight/call/' + esc(other.fighter.id) + '">' + UI.icon('refresh') + 'Rematch</a>' : '') +
      '<a class="ui-btn ghost" href="#home" data-go="home">Back to the gym</a></div></div>';
    if (b.outcome === 'win') { SS.bell(3); SS.say(b.result.method === 'ko' ? 'Knockout!' : 'Winner!'); }
    window.scrollTo(0, 0);
  }

  function sent(view, title, text, extra) {
    view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="ui-card fg-done">' + UI.icon('send') + '<h1 style="margin-top:10px">' + esc(title) + '</h1>' +
      '<p class="muted">' + text + '</p>' + (extra || '') + '<div class="ui-row" style="justify-content:center;margin-top:16px">' +
      '<a class="ui-btn primary" href="#home" data-go="home">Back to the gym</a><a class="ui-btn" href="#find" data-go="find">Call out someone else</a></div></div></div>';
    window.scrollTo(0, 0);
  }

  UI.page('fight', { title: 'Fight', auth: 'user' }, function (view, ctx) {
    var mode = ctx.args[0] || 'train', arg = ctx.args[1], rec = null;
    view.innerHTML = '<div class="ui-wrap">' + SS.loading() + '</div>';

    function layout(head, setup) {
      view.innerHTML = '<div class="ui-wrap">' + head + (setup ? '<form class="ui-card fg-setup" data-setup onsubmit="return false">' + setup + '</form>' : '') + '<div data-rec></div></div>';
      return view.querySelector('[data-rec]');
    }
    function setupVal(name) { var el = view.querySelector('[data-setup] [name=' + name + ']'); return !el ? '' : el.type === 'checkbox' ? el.checked : el.value; }
    function record(host, o, onKeep) {
      o.onKeep = onKeep;
      rec = SS.recorder(host, o);
    }
    function wordsField(ph) {
      return '<label class="ui-field"><span>Words for your opponent <em>(optional)</em></span><input type="text" name="words" maxlength="280" placeholder="' + esc(ph) + '"></label>';
    }
    var modes = {
      answer: function () {
        return UI.api('get_bout', arg).then(function (r) {
          var b = r.bout;
          if (!b.can_answer) {
            view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="ui-empty">' + UI.icon('lock') + '<h3>This bout is closed</h3><p>' + SS.statusText(b) + '</p>' +
              '<a class="ui-btn" href="#bout/' + esc(b.id) + '" data-go="bout/' + esc(b.id) + '">Open the bout</a></div></div>';
            return;
          }
          var who = SS.boutName(b.a);
          var host = layout('<div class="ss-sub" style="margin-bottom:8px">' + esc(b.kind_label) + ' · ' + b.secs + '-second round</div>' + poster(b) +
            (b.a.words ? '<p class="fg-words">“' + esc(b.a.words) + '” — ' + esc(who) + '</p>' : '') +
            '<p class="muted" style="text-align:center">' + esc(who) + '\'s score is sealed until you fight back. Give it everything.</p>', '');
          record(host, { secs: b.secs, devices: ['phone', 'camera'], keepLabel: 'Send my answer' }, function (round) {
            return UI.api('answer_bout', b.id, round).then(function (res) { reveal(view, res.bout); });
          });
        });
      },
      call: function () {
        return UI.api('get_fighter', arg).then(function (r) {
          var f = r.fighter;
          if (f.me) { UI.go('fight', 'train'); return; }
          var host = layout('<div class="fg-head">' + SS.avatar(f, 'lg') + '<div><div class="ss-sub">Calling out · ' + SS.place(f) + '</div><h1>' + esc(f.ring) + '</h1>' +
            '<p class="muted">' + SS.tier(f.tier) + ' ' + f.rating + ' · ' + SS.record(f.record) + '</p></div></div>',
            wordsField('Your city or mine. One round.'));
          record(host, { allowSecs: true, devices: ['phone', 'camera'], keepLabel: 'Send the call-out' }, function (round) {
            return UI.api('create_challenge', f.id, round, setupVal('words')).then(function (res) {
              if (res.bout.status === 'done') return reveal(view, res.bout);
              sent(view, 'Call-out sent', 'Your round is sealed in <b>' + esc(f.ring) + '</b>\'s Mail. They have 7 days to fight back; the result lands in your Mail.');
            });
          });
        });
      },
      open: function () {
        var host = layout('<div class="ss-h" style="margin-top:0"><h1 style="margin:0">Open call-out</h1><span class="tape"></span></div>' +
          '<p class="muted">Record a round and pin it to the board. The first fighter who takes it fights your round. Ranked, like any bout.</p>',
          wordsField('Anyone. Any city.') + '<label class="ui-check"><input type="checkbox" name="city_only"> Only fighters from ' + esc(ctx.me && ctx.me.city || 'my city') + '</label>');
        record(host, { allowSecs: true, devices: ['phone', 'camera'], keepLabel: 'Post the call-out' }, function (round) {
          return UI.api('create_open_call', round, setupVal('words'), !!setupVal('city_only')).then(function () {
            sent(view, 'Call-out posted', 'It\'s on the board under <b>Find → Open call-outs</b> for 7 days. You\'ll get the result in your Mail.');
          });
        });
        return Promise.resolve();
      },
      invite: function () {
        var host = layout('<div class="ss-h" style="margin-top:0"><h1 style="margin:0">Invite a friend</h1><span class="tape"></span></div>' +
          '<p class="muted">Record your round, get a link, send it. Your friend fights back from their own phone or laptop, no account needed. You get points; it doesn\'t touch your rating.</p>',
          '<label class="ui-field"><span>Friend\'s name <em>(optional, just for you)</em></span><input type="text" name="friend" maxlength="40" placeholder="Sam"></label>' +
          wordsField('Loser buys the protein shakes.'));
        record(host, { allowSecs: true, devices: ['phone', 'camera'], keepLabel: 'Make the link' }, function (round) {
          var words = setupVal('words'), friend = setupVal('friend');
          return UI.api('create_invite', round, words, friend).then(function (res) {
            var url = SS.inviteUrl(res.token), msg = 'I just threw ' + round.stats.punches + ' punches on Subsudo. Your turn: one round, your phone or your camera.';
            sent(view, 'Your link is ready', 'Send it to ' + esc(friend || 'your friend') + '. When they fight back, the result lands in your Mail.',
              '<div class="fg-share"><div class="link"><input type="text" readonly value="' + esc(url) + '" data-link><button class="ui-btn primary" data-copy>' + UI.icon('copy') + 'Copy</button></div>' +
              '<div class="ui-row" style="justify-content:center"><button class="ui-btn" data-native>' + UI.icon('send') + 'Share</button>' +
              '<a class="ui-btn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg + ' ' + url) + '">WhatsApp</a>' +
              '<a class="ui-btn" href="sms:?&body=' + encodeURIComponent(msg + ' ' + url) + '">SMS</a>' +
              '<a class="ui-btn" href="mailto:?subject=' + encodeURIComponent('You\'ve been called out') + '&body=' + encodeURIComponent(msg + '\n\n' + url) + '">Email</a></div></div>');
            view.querySelector('[data-copy]').onclick = function () { SS.copy(url); };
            view.querySelector('[data-native]').onclick = function () { SS.share(url, msg); };
          });
        });
        return Promise.resolve();
      },
      train: function () {
        var host = layout('<div class="ss-h" style="margin-top:0"><h1 style="margin:0">Bag work</h1><span class="tape"></span></div>' +
          '<p class="muted">A round just for you. Learn how the counting feels before a real bout. 1 point per round, up to 5 a day.</p>', '');
        function go() {
          record(host, { allowSecs: true, devices: ['phone', 'camera', 'pads'], keepLabel: 'Save the round' }, function (round) {
            return UI.api('save_training', round).then(function (res) {
              host.innerHTML = '<div class="ui-card fg-done">' + UI.icon(res.personal_best ? 'trophy' : 'bag') + '<h2 style="margin-top:10px">' +
                (res.personal_best ? 'Personal best!' : 'Round saved') + '</h2><div class="ss-num" style="font-size:3.4rem;color:var(--c-brand)">' + res.score + '</div>' +
                '<p class="muted">' + res.stats.punches + ' punches · ' + res.stats.blocks + ' blocks · top ' + res.stats.top_speed.toFixed(1) + ' m/s · best ever ' + res.best +
                (res.points ? ' · <b>+' + res.points + ' point</b>' : ' · no more training points today') + '</p>' +
                '<div class="ui-row" style="justify-content:center"><button class="ui-btn primary" data-again>' + UI.icon('refresh') + 'Another round</button>' +
                '<a class="ui-btn" href="#find" data-go="find">Find a real fight</a></div></div>';
              if (res.personal_best) SS.bell(2);
              host.querySelector('[data-again]').onclick = go;
            });
          });
        }
        go();
        return Promise.resolve();
      }
    };
    var ready = (modes[mode] || modes.train)();
    return { ready: ready, destroy: function () { if (rec) rec.destroy(); } };
  });
})();

/* ===== fighter.html ===== */
(function () {
  var esc = UI.esc;
  var BADGE_ICONS = { first: 'glove', ko: 'bolt', speed: 'bolt', volume: 'grid', guard: 'shield', globe: 'globe', house: 'house', road: 'map', belt: 'trophy' };
  function line(hist) {
    if (hist.length < 2) return '<p class="muted small">The rating line appears after two ranked bouts.</p>';
    var W = 600, H = 160, pad = 24, vals = hist.map(function (h) { return h.rating; });
    var lo = Math.min.apply(null, vals) - 20, hi = Math.max.apply(null, vals) + 20;
    var x = function (i) { return pad + i * (W - 2 * pad) / (hist.length - 1); }, y = function (v) { return H - pad - (v - lo) / (hi - lo) * (H - 2 * pad); };
    var pts = hist.map(function (h, i) { return x(i).toFixed(1) + ',' + y(h.rating).toFixed(1); }).join(' ');
    return '<div class="fp-line"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rating over time">' +
      '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(1000) + '" y2="' + y(1000) + '" stroke="currentColor" stroke-opacity=".2" stroke-dasharray="4 4"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--c-brand)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
      hist.map(function (h, i) { return '<circle cx="' + x(i) + '" cy="' + y(h.rating) + '" r="4" fill="' + (h.delta >= 0 ? 'var(--c-good)' : 'var(--c-bad)') + '"/>'; }).join('') +
      '<text x="' + (W - pad) + '" y="' + (y(vals[vals.length - 1]) - 10) + '" text-anchor="end" font-family="Anton, sans-serif" font-size="20" fill="currentColor">' + vals[vals.length - 1] + '</text>' +
      '</svg></div>';
  }
  UI.page('fighter', { title: 'Fighter' }, function (view, ctx) {
    view.innerHTML = '<div class="ui-wrap">' + SS.loading() + '</div>';
    return UI.api('get_fighter', ctx.args[0]).then(function (d) {
      var f = d.fighter, b = d.best;
      document.title = f.ring + ' · Subsudo';
      view.innerHTML = '<div class="ui-wrap"><section class="fp-hero">' + SS.avatar(f, 'xl') + '<div style="min-width:0"><div class="ss-sub">' + esc(f.name) + (f.city ? ' · ' + SS.place(f) : '') +
        ' · ' + esc(f.stance) + '</div><h1>' + esc(f.ring) + '</h1><div class="ui-row" style="gap:6px">' + SS.tier(f.tier) + SS.belts(f.belts) +
        SS.hurtBadge(f.hurt) + (f.provisional ? '<span class="ui-badge">Unranked</span>' : '') + (f.open ? '<span class="ui-badge good">Open to fights</span>' : '') + (f.demo ? '<span class="ui-badge">Demo</span>' : '') + '</div>' +
        (f.bio ? '<p class="bio">“' + esc(f.bio) + '”</p>' : '') + '</div>' +
        '<div class="cta">' + (d.can_challenge && ctx.me ? '<a class="ui-btn primary lg" href="#fight/call/' + esc(f.id) + '" data-go="fight/call/' + esc(f.id) + '">' + UI.icon('megaphone') + 'Call out</a>'
          : (f.me ? '<a class="ui-btn lg" href="#profile" data-go="profile">' + UI.icon('edit') + 'Edit card</a>' : (!ctx.me ? '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">Join to fight</a>' : ''))) + '</div></section>' +
        '<div class="fp-nums"><div><b>' + f.rating + '</b><span>Rating</span></div><div><b>' + (d.rank.global ? '#' + d.rank.global : '–') + '</b><span>World</span></div>' +
        '<div><b>' + f.record.w + '-' + f.record.l + '-' + f.record.d + '</b><span>W-L-D</span></div><div><b>' + f.record.ko + '</b><span>KOs</span></div>' +
        '<div><b>' + f.points + '</b><span>Points</span></div><div><b>' + f.ducks + '</b><span>Ducked</span></div></div>' +
        '<div class="fp-cols"><div><div class="ss-h" style="margin-top:6px"><h2>Recent bouts</h2><span class="tape"></span></div>' +
        (d.bouts.length ? '<div class="ui-list">' + d.bouts.map(function (x) { return SS.boutCard(x, { words: false }); }).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('glove') + '<h3>No bouts yet</h3></div>') +
        '</div><aside><div class="ss-h" style="margin-top:6px"><h2>Rating</h2><span class="tape"></span></div><div class="ui-card tight">' + line(d.history) + '</div>' +
        '<div class="ss-h"><h2>Best round</h2><span class="tape"></span></div><div class="fp-nums" style="grid-template-columns:repeat(2,1fr);margin:0">' +
        '<div><b>' + b.score + '</b><span>Score</span></div><div><b>' + (b.speed ? b.speed.toFixed(1) : '–') + '</b><span>Top m/s</span></div><div><b>' + b.punches + '</b><span>Punches</span></div>' +
        '<div><b>' + b.blocks + '</b><span>Blocks</span></div></div>' +
        '<div class="ss-h"><h2>Badges</h2><span class="tape"></span></div><div class="fp-badges">' + d.badges.map(function (x) {
          return '<div class="fp-badge' + (x.got ? ' got' : '') + '" title="' + esc(x.how) + '"><div class="md">' + UI.icon(BADGE_ICONS[x.key] || 'star') + '</div><b>' + esc(x.name) + '</b><span>' + esc(x.how) + '</span></div>';
        }).join('') + '</div></aside></div></div>';
    });
  });
})();

/* ===== find.html ===== */
(function () {
  var esc = UI.esc;
  function card(f) {
    return '<article class="ui-card fd-card">' + SS.avatar(f, 'lg') + '<div style="min-width:0"><a class="ss-ring" href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '">' + esc(f.ring) + '</a>' +
      '<div class="ss-sub" style="margin:4px 0 6px">' + (SS.place(f) || 'Somewhere') + ' · ' + esc(f.stance) + '</div>' + SS.tier(f.tier) + ' ' + SS.belts(f.belts) + ' ' + SS.hurtBadge(f.hurt) + '</div>' +
      '<p class="bio">' + esc(f.bio || '') + '</p>' +
      '<div class="nums"><div><b>' + f.rating + '</b><span>Rating</span></div><div><b>' + f.record.w + '-' + f.record.l + '-' + f.record.d + '</b><span>Record</span></div>' +
      '<div><b>' + f.record.ko + '</b><span>KOs</span></div><div><b>' + (f.best_speed ? f.best_speed.toFixed(1) : '–') + '</b><span>Top m/s</span></div></div>' +
      '<div class="acts"><a class="ui-btn primary sm" href="#fight/call/' + esc(f.id) + '" data-go="fight/call/' + esc(f.id) + '">' + UI.icon('megaphone') + 'Call out</a>' +
      '<a class="ui-btn sm" href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '">Record</a></div>' +
      (f.demo ? '<span class="ui-badge rk">Demo</span>' : '') + '</article>';
  }
  UI.page('find', { title: 'Find a fight', nav: 'Find', icon: 'megaphone', auth: 'user', order: 20 }, function (view, ctx) {
    var tab = ctx.args[0] === 'calls' ? 'calls' : 'fighters';
    var st = UI.store.get('find', { scope: 'world', q: '', open: true });
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Find a fight</h1><p class="muted">Enemies everywhere. Pick one, record a round, it lands in their Mail.</p></div>' +
      '<a class="ui-btn" href="#fight/open" data-go="fight/open">' + UI.icon('flag') + 'Post an open call-out</a></div>' +
      '<nav class="ui-tabs"><a href="#find" class="' + (tab === 'fighters' ? 'on' : '') + '">' + UI.icon('users') + 'Fighters</a><a href="#find/calls" class="' + (tab === 'calls' ? 'on' : '') + '">' +
      UI.icon('flag') + 'Open call-outs <span class="count" data-ncalls>·</span></a></nav><div data-body>' + SS.loading('Looking around the gym…') + '</div></div>';
    var body = view.querySelector('[data-body]');
    function load() {
      return UI.api('find_fighters', st.q || null, st.scope, st.open).then(function (d) {
        view.querySelector('[data-ncalls]').textContent = d.calls.length;
        if (tab === 'calls') {
          body.innerHTML = d.calls.length ? '<div class="fd-calls">' + d.calls.map(function (b) { return SS.boutCard(b); }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('flag') + '<h3>No open call-outs</h3><p>Be the first: post a round and see who takes it.</p>' +
              '<a class="ui-btn primary" href="#fight/open" data-go="fight/open">Post an open call-out</a></div>';
          return;
        }
        body.innerHTML = '<form class="fd-bar" data-filter><input type="search" name="q" value="' + esc(st.q) + '" placeholder="Ring name or city">' +
          '<div class="ui-seg">' + [['world', 'World'], ['city', d.my_city || 'My city'], ['near', 'Near my rating']].map(function (s) {
            return '<button type="button" data-scope="' + s[0] + '" class="' + (st.scope === s[0] ? 'on' : '') + '">' + esc(s[1]) + '</button>';
          }).join('') + '</div><label class="ui-check"><input type="checkbox" name="open"' + (st.open ? ' checked' : '') + '> Open to fights</label>' +
          '<span class="muted small">' + UI.plural(d.total, 'fighter') + '</span></form>' +
          (st.scope === 'city' && !d.has_city ? '<div class="ui-note" style="margin-bottom:14px">Add your city to your <a href="#profile" data-go="profile">fighter card</a> to see who fights near you.</div>' : '') +
          (d.fighters.length ? '<div class="fd-grid">' + d.fighters.map(card).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('search') + '<h3>Nobody here yet</h3><p>Try the whole world, or invite a friend with a link.</p>' +
              '<a class="ui-btn" href="#fight/invite" data-go="fight/invite">Invite a friend</a></div>');
      });
    }
    function save() { UI.store.set('find', st); }
    view.addEventListener('click', function (e) {
      var s = e.target.closest('[data-scope]');
      if (s) { st.scope = s.getAttribute('data-scope'); save(); load(); }
    });
    view.addEventListener('change', function (e) {
      if (e.target.name === 'open') { st.open = e.target.checked; save(); load(); }
    });
    view.addEventListener('submit', function (e) {
      if (!e.target.matches('[data-filter]')) return;
      e.preventDefault(); st.q = UI.formData(e.target).q; save(); load();
    });
    var timer = null;
    view.addEventListener('input', function (e) {
      if (e.target.name !== 'q') return;
      clearTimeout(timer);
      timer = setTimeout(function () { st.q = e.target.value; save(); load().then(function () { var i = view.querySelector('[name=q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 350);
    });
    return { ready: load(), destroy: function () { clearTimeout(timer); } };
  });
})();

/* ===== home.html ===== */
(function () {
  var esc = UI.esc;
  var WAYS = [
    ['find', 'Call someone out', 'Pick a fighter anywhere in the world.', 'megaphone', '#8e1b1b'],
    ['fight/open', 'Open call-out', 'Post a round. First taker fights it.', 'flag', '#2b2622'],
    ['fight/invite', 'Invite a friend', 'A link. No account needed.', 'send', '#7a5a1b'],
    ['fight/train', 'Bag work', 'Train a round. 1 point, 5 a day.', 'bag', '#24443a']
  ];
  UI.page('home', { title: 'The gym', nav: 'Gym', icon: 'glove', auth: 'user', order: 10 }, function (view, ctx) {
    view.innerHTML = '<div class="ui-wrap">' + SS.loading('Opening the gym…') + '</div>';
    function claim() {
      var c = UI.store.get('claim', null);
      if (!c || !c.token) return Promise.resolve();
      UI.store.set('claim', null);
      return UI.apiQuiet('claim_invite', c.token, c.key).then(function (r) {
        if (!r.already) UI.toast('Your invite bout is on your record (+' + r.points + ' points)', 'ok');
      }, function () {});
    }
    function draw(d) {
      var me = d.me, r = d.rank;
      var rank = '<div class="gy-rank"><div><b>' + (r.global ? '#' + r.global : '–') + '</b><span>World</span></div>' +
        (me.city ? '<div class="city"><b>' + (r.city ? '#' + r.city : '–') + '</b><span>' + esc(me.city) + '</span></div>' : '') + '</div>';
      view.innerHTML = '<div class="ui-wrap">' +
        '<section class="gy-card"><a class="gy-face" href="#locker" data-go="locker" title="Locker room">' + SS.avatar(me, 'xl') + '<span class="tag">Locker</span></a>' + '<div style="min-width:0;position:relative;z-index:1"><div class="ss-sub">' + esc(me.name) + (me.city ? ' · ' + SS.place(me) : '') + '</div>' +
        '<h1>' + esc(me.ring) + '</h1><div class="ui-row" style="gap:6px">' + SS.tier(me.tier) + SS.belts(me.belts) + SS.hurtBadge(me.hurt) +
        (me.provisional ? '<span class="ui-badge">' + (3 - me.fights) + ' ranked bout' + (3 - me.fights === 1 ? '' : 's') + ' to get ranked</span>' : '') + '</div>' +
        '<div class="gy-nums"><div class="rate"><b>' + me.rating + '</b><span>Rating</span></div><div><b>' + me.record.w + '-' + me.record.l + '-' + me.record.d + '</b><span>W-L-D</span></div>' +
        '<div><b>' + me.record.ko + '</b><span>KOs</span></div><div><b>' + me.points + '</b><span>Points</span></div>' +
        '<div><b>' + (me.best_speed ? me.best_speed.toFixed(1) : '–') + '</b><span>Top m/s</span></div></div></div>' + rank + '</section>' +
        (d.needs_card ? '<div class="gy-nudge">' + UI.icon('glove') + '<p><b>Set up your fighter card.</b> A ring name and your city put you on the city board and let you call people out.</p>' +
          '<a class="ui-btn primary" href="#profile" data-go="profile">Fighter card</a></div>' : '') +
        (!d.needs_card && !me.avatar ? '<div class="gy-nudge">' + SS.avatar(me) + '<p><b>Build your fighter in the locker room.</b> Pick the face, hair, kit and gloves opponents will see, and watch it take the hits.</p>' +
          '<a class="ui-btn primary" href="#locker" data-go="locker">Locker room</a></div>' : '') +
        (d.to_answer.length ? '<div class="ss-h"><h2>In your corner</h2><span class="tape"></span><span class="ui-badge brand">' + d.to_answer.length + ' to answer</span></div>' +
          '<div class="gy-list">' + d.to_answer.map(function (b) { return SS.boutCard(b); }).join('') + '</div>' : '') +
        '<div class="ss-h"><h2>Pick a fight</h2><span class="tape"></span></div><div class="gy-ways">' + WAYS.map(function (w) {
          return '<button type="button" class="gy-way" style="--bg:' + w[4] + '" data-go="' + w[0] + '">' + UI.icon(w[3]) + '<b>' + esc(w[1]) + '</b><span>' + esc(w[2]) + '</span></button>';
        }).join('') + '</div>' +
        '<div class="gy-cols"><div>' +
        (d.waiting.length ? '<div class="ss-h"><h2>Waiting on</h2><span class="tape"></span></div><div class="gy-list">' + d.waiting.map(function (b) {
          var cta = b.invite_token ? '<button class="ui-btn sm" data-share="' + esc(b.invite_token) + '">' + UI.icon('send') + 'Share link</button>' : null;
          return SS.boutCard(b, cta ? { cta: cta } : {});
        }).join('') + '</div>' : '') +
        '<div class="ss-h"><h2>Recent bouts</h2><span class="tape"></span><a class="ui-btn ghost sm" href="#fighter/' + esc(me.id) + '" data-go="fighter/' + esc(me.id) + '">Your record</a></div>' +
        (d.recent.length ? '<div class="gy-list">' + d.recent.map(function (b) { return SS.boutCard(b, { words: false }); }).join('') + '</div>'
          : '<div class="ui-empty">' + UI.icon('glove') + '<h3>No bouts yet</h3><p>Answer Coach Bruno in your corner, or call someone out.</p></div>') +
        '</div><aside>' +
        '<div class="ss-h"><h2>' + esc(me.city || 'Your city') + '</h2><span class="tape"></span></div><div class="ui-card tight">' +
        (d.city_top.length ? '<div class="gy-board">' + d.city_top.map(function (f, i) {
          return '<a href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '"><span class="pos">' + (i + 1) + '</span>' + SS.avatar(f, 'sm') +
            '<span class="nm">' + esc(f.ring) + '</span><span class="rt">' + f.rating + '</span></a>';
        }).join('') + '</div><a class="ui-btn ghost sm block" href="#rankings/city" data-go="rankings/city" style="margin-top:8px">Full city board</a>'
          : '<p class="muted small" style="margin:0">' + (me.city ? 'Nobody ranked in ' + esc(me.city) + ' yet. Three ranked bouts and that belt could be yours.' : 'Add your city to your fighter card to see your city\'s board.') + '</p>') +
        '</div>' +
        '<div class="ss-h"><h2>Fair fights</h2><span class="tape"></span></div><div class="gy-list">' + d.suggested.map(function (f) {
          return '<div class="ui-card tight ui-row" style="flex-wrap:nowrap">' + SS.avatar(f) + '<div style="flex:1;min-width:0"><a class="ss-ring" href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '">' + esc(f.ring) + '</a>' +
            '<div class="ss-sub">' + SS.place(f) + ' · ' + f.rating + '</div></div><a class="ui-btn sm primary" href="#fight/call/' + esc(f.id) + '" data-go="fight/call/' + esc(f.id) + '">Call out</a></div>';
        }).join('') + '</div>' +
        '<div class="ss-h"><h2>Bag work</h2><span class="tape"></span></div><div class="ui-card tight gy-train">' + UI.icon('bag') +
        '<div style="flex:1"><b>' + d.training.best_score + '</b> <span class="ss-sub">best round · ' + UI.plural(d.training.rounds, 'round') + '</span></div>' +
        '<a class="ui-btn sm" href="#fight/train" data-go="fight/train">Train</a></div>' +
        '</aside></div></div>';
    }
    view.addEventListener('click', function (e) {
      var s = e.target.closest('[data-share]');
      if (s) SS.share(SS.inviteUrl(s.getAttribute('data-share')), ctx.me.name + ' called you out on Subsudo. One round, your phone or your camera.');
    });
    return claim().then(function () { return UI.api('get_gym'); }).then(draw);
  });
})();

/* ===== invite.html ===== */
(function () {
  var esc = UI.esc;
  function guestKey() {
    var k = UI.store.get('guest_key', null);
    if (!k) { k = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); UI.store.set('guest_key', k); }
    return k;
  }
  UI.page('invite', { title: 'You\'ve been called out' }, function (view, ctx) {
    var token = ctx.args[0], rec = null;
    view.innerHTML = '<div class="ui-wrap">' + SS.loading() + '</div>';
    function result(b, ch) {
      var guestWon = b.result.winner === 'b';
      if (!ctx.me) UI.store.set('claim', { token: token, key: guestKey() });
      view.innerHTML = '<div class="ui-wrap ui-narrow">' + SS.poster(b) + '<div class="ui-card">' + SS.resultHtml(b) + '</div>' +
        '<div class="ui-card" style="margin-top:14px">' + SS.vsBars(b.a.stats, b.b.stats) + '</div>' +
        '<div class="ui-card iv-after" style="margin-top:14px"><h2>' + (guestWon ? 'You beat ' + esc(ch.ring) + '. Make it official.' : b.result.winner === 'draw' ? 'Too close to call.' : 'Want a rematch?') + '</h2>' +
        '<p class="muted">' + (ctx.me ? 'This bout was fought as a guest.' : 'Create a free account and this bout goes on your record, with points. Then call out ' + esc(ch.ring) + ' properly, or anyone in the world.') + '</p>' +
        (ctx.me ? '<a class="ui-btn primary lg" href="#home" data-go="home">Open the gym</a>' : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">' + UI.icon('glove') + 'Join Subsudo, it\'s free</a>') + '</div></div>';
      if (guestWon) SS.bell(3);
      window.scrollTo(0, 0);
    }
    function draw(d) {
      var b = d.bout, ch = d.challenger;
      if (b.status === 'done') return result(b, ch);
      if (d.mine) {
        view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="ui-empty">' + UI.icon('send') + '<h3>This is your own invite</h3><p>Send this link to a friend. When they fight back, the result lands in your Mail.</p>' +
          '<button class="ui-btn primary" data-copy>' + UI.icon('copy') + 'Copy the link</button></div></div>';
        view.querySelector('[data-copy]').onclick = function () { SS.copy(location.href); };
        return;
      }
      view.innerHTML = '<div class="ui-wrap"><div class="iv-hero"><div class="eyebrow">You\'ve been called out</div><h1><em>' + esc(ch.ring) + '</em> wants a round with you</h1>' +
        '<p class="muted">' + (ch.city ? 'From ' + SS.place(ch) + '. ' : '') + 'One ' + b.secs + '-second round. Their score is sealed until you fight back. No account needed.</p></div>' +
        SS.poster(b) + (b.a.words ? '<p class="fg-words">“' + esc(b.a.words) + '” — ' + esc(ch.ring) + '</p>' : '') +
        '<div class="ui-card iv-name"><label class="ui-field"><span>Your fighting name</span><input type="text" name="guest" maxlength="40" placeholder="What should ' + esc(ch.ring) + ' call you?" value="' +
        esc(UI.store.get('guest_name', b.b.name !== 'Your friend' ? b.b.name : '')) + '"></label></div><div data-rec></div></div>';
      rec = SS.recorder(view.querySelector('[data-rec]'), { secs: b.secs, devices: ['phone', 'camera'], keepLabel: 'Send my answer', onKeep: function (round) {
        var name = (view.querySelector('[name=guest]').value || '').trim();
        if (name.length < 2) { view.querySelector('[name=guest]').focus(); return Promise.reject(new Error('Type your fighting name at the top first.')); }
        UI.store.set('guest_name', name);
        return UI.api('answer_invite', token, name, round, guestKey()).then(function (r) {
          result(r.bout, ch);
          if (ctx.me) UI.apiQuiet('claim_invite', token, guestKey()).then(function (c) { if (!c.already) UI.toast('On your record: +' + c.points + ' points', 'ok'); }, function () {});
        });
      } });
    }
    var ready = UI.api('get_invite', token).then(draw, function (err) {
      view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="ui-empty">' + UI.icon('lock') + '<h3>This link is closed</h3><p>' + esc(err.message) + '</p>' +
        '<a class="ui-btn primary" href="#landing" data-go="landing">What is Subsudo?</a></div></div>';
    });
    return { ready: ready, destroy: function () { if (rec) rec.destroy(); } };
  });
})();

/* ===== landing.html ===== */
(function () {
  var COPY = {
    eyebrow: 'The virtual fight club',
    title: 'Find an enemy. <em>Throw the first round.</em>',
    lead: 'Subsudo turns your phone or your laptop camera into a punch counter. Record a round, send it to anyone in the world, and let three judges decide. Own your city\'s board, then go after the world.',
    cta: 'Join the club, it\'s free',
    proof: ['Phone or laptop camera', 'Bouts by mail, no scheduling', 'Ranked by city and worldwide'],
    stepsTitle: 'Three rounds to the board',
    stepsLead: 'No sparring partner in the room. No timezone to match. Just your round against theirs.',
    steps: [['Glove up', 'Hold your phone in your fist (right hand, the bell, then left) or stand back from your laptop camera. Every jab, hook, uppercut and block is counted, with its speed.'],
            ['Send the round', 'Call out a fighter from any city, pin an open call-out to the board, or send a friend a link. Your score stays sealed in their Mail.'],
            ['Let the judges talk', 'They fight back on their own time. Three judges score power, volume and ring craft. KO, decision or draw: your rating and the city board move.']],
    featuresTitle: 'What\'s in the gym bag',
    features: [['phone', 'Phone in fist', 'The motion sensor tells punches from blocks: forward is a punch, up or down is a block, up and forward is an uppercut, a fast turn is a hook. The phone rings the bell and calls the hand switch.'],
               ['camera', 'Laptop camera', 'A hand tracker running in your browser follows both fists. The video never leaves your device; only the punch log is sent.'],
               ['mail', 'Bouts by mail', 'No scheduling. A call-out waits 7 days in their Mail. Duck it, and it shows on your fighter card.'],
               ['ranks', 'City and world boards', 'A rating like chess: beat stronger fighters, climb faster. #1 in your city holds the city belt; #1 overall holds the World belt.'],
               ['send', 'Fight friends without accounts', 'Send a link. They fight back from their own phone. If they join later, the bout moves onto their record.'],
               ['house', 'House fighters', 'Nobody to fight tonight? Coach Bruno, Big Dee and the gym crew send challenges, with bonus points for beating them.']],
    faq: [['Is it safe?', 'It\'s shadow boxing. Clear space around you, grip the phone hard (a wrist strap helps), and never punch people, walls or screens. You train at your own risk; stop if anything hurts.'],
          ['How accurate is the punch counting?', 'Good, not lab-grade. Speeds are estimates from your phone\'s motion sensor or the camera, and everyone is measured the same way. The server scores every round again from its punch log.'],
          ['Can people cheat by shaking the phone?', 'Shaking isn\'t boxing: the judges reward both hands, variety, blocks and combos, not just noise. Odd-looking rounds are flagged for the admins.'],
          ['Is my camera video uploaded?', 'No. The picture stays in your browser. Only the punch log is sent: when, which hand, which punch, how fast.'],
          ['Who sees my data?', 'Other members see your ring name, city, record and bouts. Never your email. The Privacy & Terms page has the details.'],
          ['What does it cost?', 'Nothing. Subsudo is free.']],
    bandTitle: 'The bell\'s about to ring.',
    bandLead: 'Pick a ring name and take Coach Bruno\'s welcome bout. Thirty seconds.'
  };

  // The main event: you in the red corner, a fighter from across the world in the blue, counting punches
  function fightCard() {
    return '<div class="lp-card" aria-hidden="true">' +
      '<div class="lp-corner red"><span class="glove">🥊</span><div class="tag">Red corner</div><div class="nm">You</div><div class="pl">Your city</div>' +
        '<div class="cnt"></div><div class="cl">punches landed</div></div>' +
      '<div class="lp-mid"><div class="lp-vs">VS</div><div class="lp-clock"><b>RD 1</b> · 0:60</div><div class="lp-bell">Fight by mail</div></div>' +
      '<div class="lp-corner blue"><span class="glove">🥊</span><div class="tag">Blue corner</div><div class="nm">Lagos Lightning</div><div class="pl">Lagos · NG</div>' +
        '<div class="cnt"></div><div class="cl">punches landed</div></div></div>';
  }

  // The world board as a TV ticker (the list is doubled so the loop has no gap)
  function tickerRow(rows) {
    var esc = UI.esc;
    var items = rows.map(function (r) { return '<span><b>#' + r.rank + '</b>' + esc(r.fighter.ring) + '<i>' + esc(r.value) + '</i></span>'; });
    if (!items.length) items = ['<span><b>World belt</b>up for grabs</span>', '<span><b>City belts</b>waiting in every city</span>'];
    items.push('<span><b>Three judges</b>power · volume · ring craft</span>');
    var run = items.join('');
    return '<span class="lbl">WORLD</span><div class="run">' + run + run + '</div>';
  }

  UI.page('landing', { title: 'Welcome' }, function (view, ctx) {
    var me = ctx.me, C = COPY, esc = UI.esc;
    var primary = me ? '<a class="ui-btn primary lg" href="#home" data-go="home">' + UI.icon('glove') + 'Open the gym</a>'
      : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">' + UI.icon('glove') + esc(C.cta) + '</a>' +
        '<a class="ui-btn lg" href="#auth" data-go="auth">I have an account</a>';
    view.innerHTML =
      '<section class="lp-hero"><div class="ui-wrap">' +
        '<div class="eyebrow">' + esc(C.eyebrow) + '</div><h1>' + C.title + '</h1><p class="lp-lead">' + esc(C.lead) + '</p>' +
        '<div class="lp-cta">' + primary + '</div>' +
        '<div class="lp-proof">' + C.proof.map(function (p) { return '<span>' + UI.icon('check') + esc(p) + '</span>'; }).join('') + '</div>' +
        fightCard() + '</div><div class="lp-ticker" aria-hidden="true" data-ticker>' + tickerRow([]) + '</div></section>' +
      '<section class="lp-section" id="how"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.stepsTitle) + '</h2><p>' + esc(C.stepsLead) + '</p></div>' +
        '<div class="lp-steps">' + C.steps.map(function (s) { return '<div class="ui-card lp-step"><h3>' + esc(s[0]) + '</h3><p class="muted">' + esc(s[1]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section" style="padding-top:0"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.featuresTitle) + '</h2></div>' +
        '<div class="ui-grid">' + C.features.map(function (f) { return '<div class="ui-card lp-feature"><span class="ic">' + UI.icon(f[0]) + '</span><h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section" style="padding-top:0"><div class="ui-wrap"><div class="lp-head"><h2>Top of the world</h2><p>Right now, on the board.</p></div><div class="lp-board" data-board>' + SS.loading('Reading the board…') + '</div>' +
        '<p style="text-align:center;margin-top:14px"><a class="ui-btn" href="#rankings" data-go="rankings">' + UI.icon('ranks') + 'All rankings</a></p></div></section>' +
      '<section class="lp-section" style="padding-top:0"><div class="ui-wrap"><div class="lp-head"><h2>Questions from the locker room</h2></div><div class="lp-faq">' +
        C.faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section" style="padding-top:0"><div class="ui-wrap"><div class="lp-band"><div><h2>' + esc(C.bandTitle) + '</h2><p>' + esc(C.bandLead) + '</p></div>' +
        (me ? '<a class="ui-btn lg" href="#home" data-go="home">Open the gym</a>' : '<a class="ui-btn lg" href="#auth/signup" data-go="auth/signup">' + esc(C.cta) + '</a>') +
      '</div></div></section>';
    return UI.apiQuiet('get_rankings', 'world').then(function (d) {
      var tk = view.querySelector('[data-ticker]');
      if (tk && d.rows.length) tk.innerHTML = tickerRow(d.rows.slice(0, 8));
      var el = view.querySelector('[data-board]');
      if (!el) return;
      el.innerHTML = d.rows.slice(0, 5).map(function (r) {
        var f = r.fighter;
        return '<a href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '"><span class="pos">' + r.rank + '</span>' + SS.avatar(f) +
          '<div style="min-width:0"><span class="ss-ring">' + esc(f.ring) + '</span><div class="ss-sub">' + SS.place(f) + ' ' + SS.belts(f.belts) + '</div></div><span class="v">' + r.value + '</span></a>';
      }).join('') || '<div class="ui-empty"><h3>The board is empty</h3><p>The World belt is up for grabs.</p></div>';
    }, function () { var el = view.querySelector('[data-board]'); if (el) el.innerHTML = ''; });
  });
})();

/* ===== locker.html ===== */
(function () {
  var esc = UI.esc;
  var GROUPS = [['Head', ['skin', 'face', 'marks']], ['Hair', ['hair', 'hairColor', 'brows', 'beard']], ['Face', ['eyes', 'eyeColor', 'nose', 'mouth']],
                ['Kit', ['headgear', 'outfit', 'kit', 'gloves', 'pose', 'bg']]];
  var PREVIEWS = [['now', 'Now'], ['none', 'Fresh'], ['fresh', 'Bout today'], ['war', 'After a war'], ['ko', 'Knocked out'], ['heal', 'Healing']];
  var HURTS = { none: null, fresh: { level: 1.7, age: 1, hours_left: 23, label: 'Bruised' }, war: { level: 3.3, age: 2, hours_left: 22, label: 'Battered' },
    ko: { level: 3.8, age: .5, hours_left: 24, ko: true, label: 'Battered' }, heal: { level: 1.2, age: 17, hours_left: 7, label: 'Bruised' } };

  UI.page('locker', { title: 'Locker room', auth: 'user' }, function (view, ctx) {
    var f = null, spec = null, glove = 'oxblood', prev = 'now', dirty = false;
    var gloveKeys = Object.keys(SS.GLOVES);
    view.innerHTML = '<div class="ui-wrap">' + SS.loading('Opening your locker…') + '</div>';

    function part(key) {
      if (key === 'gloves') return { label: 'Gloves', names: gloveKeys.map(function (g) { return SS.GLOVE_NAMES[g]; }), colors: gloveKeys.map(function (g) { return SS.GLOVES[g]; }) };
      return SS.AVATAR[key];
    }
    function value(key) { return key === 'gloves' ? Math.max(0, gloveKeys.indexOf(glove)) : spec[key]; }
    function setValue(key, v) {
      var n = part(key).names.length;
      v = (v + n) % n;
      if (key === 'gloves') glove = gloveKeys[v]; else spec[key] = v;
      dirty = true;
    }
    function hurt() { return prev === 'now' ? f.hurt : HURTS[prev]; }
    function mirror() {
      view.querySelector('[data-mirror]').innerHTML = SS.avatar({ id: f.id, avatar: spec, glove: glove, hurt: hurt() }, 'xl');
      var h = hurt();
      view.querySelector('[data-hurtnote]').innerHTML = prev === 'now'
        ? (f.hurt ? SS.hurtBadge(f.hurt) + ' Bruises fade over 24 hours after a bout.' : 'No marks right now. Every bout leaves some for 24 hours.')
        : (h ? 'Preview: ' + esc(h.ko ? 'knocked out minutes ago' : h.age > 12 ? 'a bout ' + h.age + ' hours ago, healing' : 'just after a bout') + '.' : 'Preview: no marks.');
      view.querySelector('[data-save]').disabled = !dirty;
    }
    function rowHtml(key) {
      var p = part(key), v = value(key);
      return '<div class="lk-row" tabindex="0" data-key="' + key + '" role="group" aria-label="' + esc(p.label) + '"><span class="lbl">' + esc(p.label) + '</span>' +
        '<button type="button" class="lk-arrow" data-step="-1" aria-label="Previous ' + esc(p.label) + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<span class="val" aria-live="polite">' + (p.colors ? '<i class="sw" style="background:' + p.colors[v] + '"></i>' : '') + '<span>' + esc(p.names[v]) + '</span><small>' + (v + 1) + '/' + p.names.length + '</small></span>' +
        '<button type="button" class="lk-arrow" data-step="1" aria-label="Next ' + esc(p.label) + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button></div>';
    }
    function refreshRow(key) {
      var el = view.querySelector('.lk-row[data-key="' + key + '"]');
      var tmp = document.createElement('div'); tmp.innerHTML = rowHtml(key);
      el.querySelector('.val').innerHTML = tmp.querySelector('.val').innerHTML;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
    function draw() {
      view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Locker room</h1><p class="muted">Build your fighter. Every bout leaves its marks for 24 hours.</p></div>' +
        '<a class="ui-btn ghost" href="#profile" data-go="profile">' + UI.icon('back') + 'Fighter card</a></div>' +
        '<div class="lk-grid"><aside class="lk-stage"><div class="lk-mirror" data-mirror></div>' +
        '<div class="lk-plate"><b>' + esc(f.ring) + '</b><span>' + (SS.place(f) || 'Somewhere') + ' · ' + f.rating + '</span></div>' +
        '<div class="lk-prev"><div class="ss-sub" style="margin-bottom:6px">Preview the damage</div><div class="ui-seg" data-prevs>' + PREVIEWS.map(function (p) {
          return '<button type="button" data-prev="' + p[0] + '" class="' + (prev === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
        }).join('') + '</div><p class="lk-note" data-hurtnote style="margin-top:8px"></p></div>' +
        '<div class="lk-acts"><button class="ui-btn" data-random>' + UI.icon('refresh') + 'Random</button><button class="ui-btn primary" data-save>' + UI.icon('check') + 'Save</button></div></aside>' +
        '<div class="lk-groups">' + GROUPS.map(function (g) {
          return '<section class="lk-group"><h3>' + g[0] + '</h3><div class="lk-rows">' + g[1].map(rowHtml).join('') + '</div></section>';
        }).join('') + '<p class="lk-note">Tip: click a row and use the ← → keys. Your portrait shows next to your name everywhere: the gym, bouts, Find and the rankings.</p></div></div></div>';
      mirror();
    }
    function step(key, d) { setValue(key, value(key) + d); refreshRow(key); mirror(); }
    view.addEventListener('click', function (e) {
      var a = e.target.closest('[data-step]');
      if (a) { step(a.closest('[data-key]').getAttribute('data-key'), +a.getAttribute('data-step')); return; }
      var p = e.target.closest('[data-prev]');
      if (p) { prev = p.getAttribute('data-prev'); view.querySelectorAll('[data-prev]').forEach(function (b) { b.classList.toggle('on', b === p); }); mirror(); return; }
      if (e.target.closest('[data-random]')) {
        spec = SS.defaultFace(Math.random().toString(36));
        glove = gloveKeys[Math.floor(Math.random() * gloveKeys.length)];
        dirty = true;
        SS.AVATAR_KEYS.concat(['gloves']).forEach(refreshRow); mirror(); return;
      }
      var s = e.target.closest('[data-save]');
      if (s) {
        UI.busy(s, UI.api('update_avatar', spec, glove)).then(function (r) {
          f = Object.assign(f, r.fighter); dirty = false; mirror();
          UI.toast('Looking sharp. Saved.', 'ok');
        });
      }
    });
    view.addEventListener('keydown', function (e) {
      var row = e.target.closest && e.target.closest('.lk-row');
      if (!row || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      step(row.getAttribute('data-key'), e.key === 'ArrowLeft' ? -1 : 1);
    });
    return UI.api('get_fighter', ctx.me.id).then(function (r) {
      f = r.fighter;
      spec = Object.assign({}, f.avatar || SS.defaultFace(f.id));
      glove = f.glove || 'oxblood';
      draw();
    });
  });
})();

/* ===== mail.html ===== */
(function () {
  var esc = UI.esc;
  var ICON = { challenge: 'megaphone', house: 'house', result: 'trophy', words: 'chat', declined: 'x', expired: 'clock', system: 'bell' };
  UI.page('mail', { title: 'Mail', nav: 'Mail', icon: 'mail', auth: 'user', order: 40 }, function (view) {
    view.innerHTML = '<div class="ui-wrap">' + SS.loading('Checking the mail…') + '</div>';
    function draw(d) {
      var n = d.unread;
      view.innerHTML = '<div class="ui-wrap ui-narrow" style="max-width:860px"><div class="ui-page-head"><div><h1>Mail</h1><p class="muted">' +
        (n.to_answer ? '<b>' + UI.plural(n.to_answer, 'bout') + ' waiting for your answer.</b> ' : '') + 'Call-outs, results and words from your opponents.</p></div>' +
        (n.messages ? '<button class="ui-btn sm" data-all>' + UI.icon('check') + 'Mark all read</button>' : '') + '</div>' +
        (d.messages.length ? '<div class="ml-list">' + d.messages.map(function (m) {
          return '<section class="ml-msg' + (m.read ? '' : ' unread') + '" data-msg="' + esc(m.id) + '"><div class="ml-head"><span class="ml-ic ' + esc(m.kind) + '">' + UI.icon(ICON[m.kind] || 'bell') + '</span>' +
            '<div style="min-width:0"><h3>' + esc(m.title) + '</h3>' + (m.body ? '<p>' + esc(m.body) + '</p>' : '') + '</div><time>' + esc(UI.ago(m.created)) + '</time></div>' +
            (m.bout ? SS.boutCard(m.bout, { unread: !m.read, words: m.kind !== 'words' }) : '') + '</section>';
        }).join('') + '</div>'
          : '<div class="ui-empty">' + UI.icon('mail') + '<h3>Nothing in the mailbox</h3><p>Call someone out and the replies land here.</p><a class="ui-btn primary" href="#find" data-go="find">Find a fight</a></div>') + '</div>';
      SS.setUnread(n.total);
    }
    view.addEventListener('click', function (e) {
      if (e.target.closest('[data-all]')) { UI.api('mark_all_read').then(load); return; }
      var m = e.target.closest('[data-msg]');
      if (m && m.classList.contains('unread') && e.target.closest('a,button')) {
        UI.apiQuiet('mark_read', m.getAttribute('data-msg')).then(function (r) { SS.setUnread(r.unread.total); }, function () {});
      }
    });
    function load() { return UI.api('get_inbox').then(draw); }
    return load();
  });
})();

/* ===== profile.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('profile', { title: 'Your fighter card', auth: 'user' }, function (view, ctx) {
    var me = ctx.me;
    view.innerHTML = '<div class="ui-wrap">' + SS.loading() + '</div>';
    function preview(v) {
      var f = { ring: v.ring_name || me.name, glove: v.glove, city: v.city, country: v.country, id: card.id, avatar: card.avatar, hurt: card.hurt };
      view.querySelector('[data-prev]').innerHTML = SS.avatar(f, 'xl') + '<span class="ss-ring">' + esc(f.ring) + '</span>' +
        '<div class="ss-sub">' + (SS.place(f) || 'Somewhere') + ' · ' + esc(v.stance || 'orthodox') + '</div>' + (v.bio ? '<p>“' + esc(v.bio) + '”</p>' : '');
    }
    var card = {};
    function draw(f) {
      card = f;
      var hasCard = f.city || f.ring !== f.name;
      view.innerHTML = '<div class="ui-wrap"><div class="pf-head">' + SS.avatar(f, 'lg') + '<div><h1>' + esc(f.ring) + '</h1><div class="muted">' + esc(me.email) +
        (me.joined ? ' · member since ' + esc(UI.fmtDate(me.joined, { month: 'long', year: 'numeric' })) : '') + '</div></div>' +
        '<span class="ui-spacer"></span><a class="ui-btn sm" href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '">Your public page</a></div>' +
        '<section class="ui-card pf-card"><form class="pf-form" data-card><div class="full"><h3 style="margin:0">Fighter card</h3><p class="muted small" style="margin:4px 0 0">What opponents see. Your email never shows.</p></div>' +
        '<label class="ui-field full"><span>Ring name</span><input type="text" name="ring_name" maxlength="30" required value="' + esc(hasCard ? f.ring : '') + '" placeholder="The Hammer"></label>' +
        '<label class="ui-field"><span>City</span><input type="text" name="city" maxlength="40" value="' + esc(f.city) + '" placeholder="Montréal" autocomplete="address-level2"></label>' +
        '<label class="ui-field"><span>Country</span><select name="country">' + SS.countryOptions(f.country) + '</select></label>' +
        '<div class="ui-field"><span>Stance</span><div class="ui-seg" data-stance>' + [['orthodox', 'Orthodox'], ['southpaw', 'Southpaw']].map(function (s) {
          return '<button type="button" data-st="' + s[0] + '" class="' + (f.stance === s[0] ? 'on' : '') + '">' + s[1] + '</button>';
        }).join('') + '</div><input type="hidden" name="stance" value="' + esc(f.stance) + '"></div>' +
        '<div class="ui-field"><span>Gloves</span><div class="pf-gloves">' + Object.keys(SS.GLOVES).map(function (g) {
          return '<label title="' + esc(SS.GLOVE_NAMES[g]) + '"><input type="radio" name="glove" value="' + g + '"' + (f.glove === g ? ' checked' : '') + ' aria-label="' + esc(SS.GLOVE_NAMES[g]) + '">' +
            SS.avatar({ glove: g, bare: true }) + '</label>';
        }).join('') + '</div></div>' +
        '<label class="ui-field full"><span>A line for your opponents <em>(optional)</em></span><input type="text" name="bio" maxlength="160" value="' + esc(f.bio) + '" placeholder="Desk job by day. Heavy bag by night."></label>' +
        '<label class="ui-check full"><input type="checkbox" name="open"' + (f.open ? ' checked' : '') + '> Open to fights: show me on Find and in suggestions</label>' +
        '<div class="full ui-row"><button class="ui-btn primary" type="submit">' + UI.icon('check') + 'Save fighter card</button>' +
        '<a class="ui-btn" href="#locker" data-go="locker">' + UI.icon('user') + 'Locker room: build your face</a></div></form><div class="pf-prev" data-prev></div></section>' +
        '<div class="pf-grid"><form class="ui-card ui-stack" data-name><h3>Your name</h3><label class="ui-field"><span>Shown under your ring name</span>' +
        '<input type="text" name="name" value="' + esc(me.name) + '" maxlength="60" required></label><button class="ui-btn" type="submit">Save</button></form>' +
        '<div class="ui-card ui-stack"><h3>Appearance &amp; sound</h3><div data-theme-box></div>' +
        '<label class="ui-check"><input type="checkbox" data-pref="sound"' + (SS.prefs.sound ? ' checked' : '') + '> Bell and punch sounds</label>' +
        '<label class="ui-check"><input type="checkbox" data-pref="voice"' + (SS.prefs.voice ? ' checked' : '') + '> Corner voice ("Switch! Left hand")</label>' +
        '<h3 style="margin-top:18px">Password</h3><button class="ui-btn" data-reset>' + UI.icon('mail') + 'Email me a reset link</button></div></div>' +
        '<div class="ui-card" style="margin-top:16px"><div class="pf-links">' +
        (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
        '<a href="#fight/train" data-go="fight/train">' + UI.icon('bag') + 'Bag work (test the punch counting)</a>' +
        '<button data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
        '<button data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms, and your data</button>' +
        '<button data-signout-here>' + UI.icon('logout') + 'Sign out</button></div></div></div>';
      themeBox();
      preview(UI.formData(view.querySelector('[data-card]')));
    }
    function themeBox() {
      var t = UI.theme();
      view.querySelector('[data-theme-box]').innerHTML = '<div class="ui-seg">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
        return '<button type="button" data-theme-pick="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-pick]');
      if (t) { UI.setTheme(t.getAttribute('data-theme-pick')); themeBox(); UI.renderChrome(); return; }
      var st = e.target.closest('[data-st]');
      if (st) {
        view.querySelectorAll('[data-st]').forEach(function (b) { b.classList.toggle('on', b === st); });
        view.querySelector('[name=stance]').value = st.getAttribute('data-st');
        preview(UI.formData(view.querySelector('[data-card]')));
        return;
      }
      if (e.target.closest('[data-reset]')) {
        UI.busy(e.target.closest('[data-reset]'), UI.auth('reset', { email: me.email })).then(function (r) { UI.toast(r.message, 'ok'); });
      }
      if (e.target.closest('[data-signout-here]')) UI.auth('logout');
    });
    view.addEventListener('input', function (e) { var f = e.target.closest('[data-card]'); if (f) preview(UI.formData(f)); });
    view.addEventListener('change', function (e) {
      var p = e.target.getAttribute('data-pref');
      if (p) { SS.setPref(p, e.target.checked); return; }
      var f = e.target.closest('[data-card]'); if (f) preview(UI.formData(f));
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target, v = UI.formData(form);
      if (form.matches('[data-card]')) {
        UI.busy(form.querySelector('[type=submit]'), UI.api('update_fighter', v)).then(function (r) {
          UI.toast('Fighter card saved', 'ok');
          view.querySelector('.pf-head h1').textContent = r.fighter.ring;
        });
      } else if (form.matches('[data-name]')) {
        UI.busy(form.querySelector('[type=submit]'), UI.api('update_profile', v.name)).then(function (r) { UI.setMe(r.me); ctx.me = me = r.me; UI.toast('Saved', 'ok'); });
      }
    });
    return UI.api('get_fighter', me.id).then(function (r) { draw(r.fighter); });
  });
})();

/* ===== rankings.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('rankings', { title: 'Rankings', nav: 'Ranks', icon: 'ranks', order: 30 }, function (view, ctx) {
    var scope = ['city', 'week'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'world';
    var cityKey = ctx.args[1] || null;
    view.innerHTML = '<div class="ui-wrap">' + SS.loading('Reading the board…') + '</div>';
    function unit(d) { return d.scope === 'week' ? 'pts' : 'rating'; }
    function row(r, d) {
      var f = r.fighter;
      return '<a class="rk-row' + (f.me ? ' me' : '') + '" href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '"><span class="pos">' + r.rank + '</span>' + SS.avatar(f) +
        '<div style="min-width:0"><span class="ss-ring">' + esc(f.ring) + '</span><div class="ss-sub">' + (SS.place(f) || '&nbsp;') + ' ' + (d.scope === 'week' ? '' : SS.tier(f.tier)) + ' ' + SS.belts(f.belts) + '</div></div>' +
        '<span class="rec">' + f.record.w + '-' + f.record.l + '-' + f.record.d + (f.record.ko ? ' · ' + f.record.ko + ' KO' : '') + '</span>' +
        '<span class="v">' + r.value + '<small>' + unit(d) + '</small></span></a>';
    }
    function pod(r, i, d) {
      var f = r.fighter;
      return '<a class="rk-pod p' + (i + 1) + '" href="#fighter/' + esc(f.id) + '" data-go="fighter/' + esc(f.id) + '"><span class="pl">' + (i + 1) + '</span>' + SS.avatar(f, i === 0 ? 'lg' : '') +
        '<span class="ss-ring">' + esc(f.ring) + '</span><div class="ss-sub">' + (SS.place(f) || '&nbsp;') + '</div><div class="v">' + r.value + '</div></a>';
    }
    function draw(d) {
      var tabs = '<nav class="ui-tabs">' + [['world', 'World', 'globe'], ['city', 'City', 'pin'], ['week', 'This week', 'bolt']].map(function (t) {
        return '<a href="#rankings' + (t[0] === 'world' ? '' : '/' + t[0]) + '" class="' + (scope === t[0] ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>';
      }).join('') + '</nav>';
      var bar = scope === 'city' ? '<div class="rk-bar"><select data-city aria-label="City"><option value="">Pick a city…</option>' + d.cities.map(function (c) {
        return '<option value="' + esc(c.key) + '"' + (d.city && d.city.key === c.key ? ' selected' : '') + '>' + esc(c.city) + (c.country ? ', ' + esc(SS.country(c.country)) : '') + ' (' + c.fighters + ')</option>';
      }).join('') + '</select>' + (d.city && d.city.name ? '<span class="ss-belt">' + esc(d.city.name) + ' belt</span>' : '') + '</div>' : '';
      var rows = d.rows;
      var list = '';
      if (scope === 'city' && d.need_city) list = '<div class="ui-empty">' + UI.icon('pin') + '<h3>Which city?</h3><p>Pick one above' + (ctx.me ? ', or add yours to your <a href="#profile" data-go="profile">fighter card</a>' : '') + '.</p></div>';
      else if (!rows.length) list = '<div class="ui-empty">' + UI.icon('ranks') + '<h3>The board is empty</h3><p>' + (scope === 'week' ? 'No points earned this week yet.' : 'Nobody here has ' + d.min_fights + ' ranked bouts yet. The belt is up for grabs.') + '</p></div>';
      else {
        list = (rows.length >= 3 ? '<div class="rk-top">' + [rows[1], rows[0], rows[2]].map(function (r) { return pod(r, r.rank - 1, d); }).join('') + '</div>' : '') +
          '<div class="rk-list">' + rows.slice(rows.length >= 3 ? 3 : 0).map(function (r) { return row(r, d); }).join('') + '</div>';
      }
      var mine = '';
      if (d.me && d.me.rank > 3) mine = '';
      if (ctx.me && !d.me && d.my_status) mine = '<div class="ui-note" style="margin-bottom:14px">' + UI.icon('info') + ' You\'re not on this board yet: ' + esc(d.my_status) + '. <a href="#find" data-go="find">Find a fight</a></div>';
      view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Rankings</h1><p class="muted">' +
        (scope === 'week' ? 'Points earned in the last 7 days: bouts, house challenges and bag work.' : 'By rating. Win against stronger fighters to climb faster.') + '</p></div></div>' +
        tabs + bar + mine + list +
        '<details class="ui-card rk-how"><summary><b>How the rankings work</b></summary><ul style="margin-top:12px">' +
        '<li>Everyone starts at <b>1000</b>. Ranked bouts move your rating up or down, more when the result is a surprise (Elo, like chess).</li>' +
        '<li>Knockouts move it 25% more, split decisions 20% less. Bouts against guests and the house give points but don\'t touch your rating.</li>' +
        '<li>You appear on the boards after <b>' + d.min_fights + ' ranked bouts</b>, and stay while you fought in the last <b>' + (d.active_days || 120) + ' days</b>.</li>' +
        '<li>#1 in the world holds the <b>World belt</b>; #1 in each city holds that city\'s belt.</li>' +
        '<li>Points: win 25, KO win 35, draw 12, loss 5; house win 15 (+ bonus); bag work 1 (5 a day).</li></ul>' +
        '<div class="rk-tiers">' + (d.tiers || []).slice().reverse().map(function (t) { return SS.tier(t.name) + '<span class="small muted">' + t.from + '+</span>'; }).join(' ') + '</div></details></div>';
      view.querySelector('[data-city]') && view.querySelector('[data-city]').addEventListener('change', function (e) {
        if (e.target.value) UI.go('rankings', 'city', e.target.value);
      });
    }
    return UI.api('get_rankings', scope, cityKey).then(draw);
  });
})();
