/* ss-core.js (was web/pages/_ss_core.html): the Subsudo drawing + sound engine, used from Python through
   client_code/ss.py and the Components (Avatar, Timeline, VsBars, RatingLine, Recorder).
   window.SS: glove avatars and fighter portraits (SS.avatar), countries, the punch timeline, the rating line, the
   tale-of-the-tape bars, the live score (same formula as server_code/Boxing.py score_round), the gym's sounds
   (bell, punch thuds, the corner voice), music, share/copy. Pages, lists and cards are Forms. */
(function () {
  'use strict';
  var esc = UI.esc;
  var SS = window.SS = window.SS || {};

  /* ------------------------------------------------------------------ helpers the engines use (the old core.js had them)
     UI.toast goes to Python (state.toast) through window.SS_HOST, which startup.py fills in. */
  UI.initials = UI.initials || function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.busy = UI.busy || function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };
  UI.toast = UI.toast || function (msg, kind) {
    if (window.SS_HOST && window.SS_HOST.toast) window.SS_HOST.toast(String(msg), kind || '');
  };
  /* the guest key a friend's browser keeps for invite bouts (client_code/ss.py guest_key) */
  window.SS_RANDOM_KEY = function () {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  };

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
  /* ------------------------------------------------------------------ bouts */
  SS.TYPE_NAMES = { s: 'Straight', u: 'Uppercut', h: 'Hook', b: 'Block' };
  SS.DEVICE_NAMES = { phone: 'Phone', camera: 'Camera', house: 'House', pads: 'Pads' };
  SS.boutName = function (side) { return side.fighter ? side.fighter.ring : side.name; };
  SS.sideAvatar = function (side, size) {
    return side.fighter ? SS.avatar(side.fighter, size) : SS.avatar({ name: side.name, house: side.house, guest: side.guest || !side.house }, size);
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

  /* the rating line on a fighter's page: hist = [{rating, delta}] oldest first */
  SS.ratingLine = function (hist) {
    if (!hist || hist.length < 2) return '';
    var W = 600, H = 160, pad = 24, vals = hist.map(function (h) { return h.rating; });
    var lo = Math.min.apply(null, vals) - 20, hi = Math.max.apply(null, vals) + 20;
    var x = function (i) { return pad + i * (W - 2 * pad) / (hist.length - 1); }, y = function (v) { return H - pad - (v - lo) / (hi - lo) * (H - 2 * pad); };
    var pts = hist.map(function (h, i) { return x(i).toFixed(1) + ',' + y(h.rating).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rating over time, now ' + vals[vals.length - 1] + '">' +
      '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(1000) + '" y2="' + y(1000) + '" stroke="currentColor" stroke-opacity=".2" stroke-dasharray="4 4"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--c-brand)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
      hist.map(function (h, i) { return '<circle cx="' + x(i) + '" cy="' + y(h.rating) + '" r="4" fill="' + (h.delta >= 0 ? 'var(--c-good)' : 'var(--c-bad)') + '"/>'; }).join('') +
      '<text x="' + (W - pad) + '" y="' + (y(vals[vals.length - 1]) - 10) + '" text-anchor="end" font-family="Anton, sans-serif" font-size="20" fill="currentColor">' + vals[vals.length - 1] + '</text>' +
      '</svg>';
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
  SS.prefs = { sound: UI.store.get('sound', true), voice: UI.store.get('voice', true), music: UI.store.get('music', true) };
  SS.setPref = function (k, v) { SS.prefs[k] = v; UI.store.set(k, v); if (k === 'music' && !v) SS.music(null); };
  /* Music: real tracks streamed by ArkMusic (web/pages/_arkmusic.html). Walk-out while you pick your gear,
     a gym beat during rounds (it dips while the corner voice talks), silence at "Time!". */
  SS.MUSIC = { walkout: 'own-it', round: 'detroit' };
  SS.music = function (what) {
    if (!window.ArkMusic) return;
    if (!what || !SS.prefs.music) { ArkMusic.stop(what ? 0.6 : 1.2); return; }
    ArkMusic.play(SS.MUSIC[what], { volume: what === 'round' ? 0.38 : 0.5, fade: 1.2 });
  };
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
    try {
      speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.rate = 1.08; u.pitch = .8;
      if (window.ArkMusic) { ArkMusic.duck(0.35, 0.15); var up = function () { ArkMusic.duck(1, 0.6); }; u.onend = up; setTimeout(up, 3000); }
      speechSynthesis.speak(u);
    } catch (e) {}
  };
  SS.buzz = function (ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

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
