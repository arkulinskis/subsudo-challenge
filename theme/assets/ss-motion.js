/* ss-motion.js: _ss_motion: turning movement into punches, and the round recorder every fight page uses.

  SS.PhoneDetector   devicemotion samples -> events. The phone is held in the fist. Forward thrust = punch,
                     up or down = block, up and forward together = uppercut, a fast wrist turn
                     (gyroscope) = hook. One hand at a time: right hand first, a bell, then left.
  SS.CameraDetector  MediaPipe hand landmarks (two hands, laptop camera) -> events. A fist that grows fast
                     in the picture is coming at the camera = punch; fast up-and-forward = uppercut; fast
                     sideways = hook; fast up/down without coming closer = block.
  SS.recorder(host, {secs, devices, allowSecs, title, keepLabel, onKeep}) draws the whole flow (pick gear, briefing,
                     countdown, live round, summary) and returns {promise, destroy}. Keeping the round calls
                     onKeep({device, secs, events, score, stats}) (a Promise; if it fails the summary stays
                     for another try), or without onKeep resolves the promise with the round.
  Speeds are estimates (m/s). Tests: SS.timeScale speeds the clock up, SS.forceMotion lets a desktop use
  phone mode, SS.injectMotion(sample) feeds the live phone detector. */
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
            '<span class="rc-ic">' + UI.icon(g.icon) + '</span><b>' + g.title + '</b><span>' + g.text + '</span>' +
            (avail[d] ? '' : '<em>' + (d === 'phone' ? 'Open Subsudo on your phone for this' : 'No camera found here') + '</em>') + '</button>';
        }).join('') + '</div>' +
        '<div class="rc-opts">' + (opts.allowSecs ? '<div><div class="ss-sub" style="margin-bottom:6px">Round length</div><div class="ui-seg" data-secs>' +
          [30, 60, 90].map(function (s) { return '<button type="button" data-s="' + s + '" class="' + (s === secs ? 'on' : '') + '">' + s + ' sec</button>'; }).join('') + '</div></div>'
          : '<span class="ui-badge">' + UI.icon('timer') + secs + '-second round</span>') +
        '<label class="ui-check"><input type="checkbox" data-pref="sound"' + (SS.prefs.sound ? ' checked' : '') + '> Bell and punch sounds</label>' +
        '<label class="ui-check"><input type="checkbox" data-pref="voice"' + (SS.prefs.voice ? ' checked' : '') + '> Corner voice</label>' +
        '<label class="ui-check"><input type="checkbox" data-pref="music"' + (SS.prefs.music ? ' checked' : '') + '> Music</label></div>' +
        brief() + '<div class="rc-start"><button class="ui-btn primary lg" data-start>' + UI.icon('glove') + 'Glove up</button>' +
        (opts.cancel ? '<button class="ui-btn ghost" data-cancel>Not now</button>' : '') + '</div></div>';
      SS.music('walkout');
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
      if (p === 'music' && e.target.checked) SS.music('walkout');
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
          SS.music('round');
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
        SS.music(null);
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
    return { promise: promise, destroy: function () { stopAll(); SS.music(null); } };
  };
})();
