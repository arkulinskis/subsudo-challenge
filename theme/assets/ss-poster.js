/* ss-poster.js: the fight poster to share (a 1080x1350 PNG drawn on a canvas) and the bout's public link.

  SS.posterPng(bout)            -> Promise<Blob>: the gym wall, both portraits (today's bruises included), names and
                                   cities, the scores, an oxblood stamp (KO / decision / draw), the judges' cards,
                                   punches, and subsudo.com. Portraits are SS.face(spec, {full: true}) SVGs turned into
                                   images (data URLs, literal colours, so the canvas stays readable); text waits for
                                   the page's own fonts (Anton, Barlow, Barlow Condensed).
  SS.posterPrepare(bout, img)   draws it once per bout (cached) and shows it in an <img>; resolves to the PNG's size.
  SS.sharePoster(bout, text)    phones: the share sheet with the PNG + the link. Elsewhere: downloads the PNG and
                                copies the link. Resolves to 'shared' | 'downloaded' | 'cancelled'.
  SS.boutUrl(id)                https://<site>/b/<a-b>: server_code/SharePages.py gives it a link preview
                                ("Kofi beat Ana by knockout | Subsudo") and opens #bout/<id>.
  Used from Python through client_code/ss.py (Components/ShareBout). */
(function () {
  'use strict';
  var SS = window.SS = window.SS || {};
  var W = 1080, H = 1350;
  var C = { wall: '#1a1816', deep: '#0b0a09', ink: '#f3ece0', muted: 'rgba(243,236,224,.72)', faint: 'rgba(243,236,224,.5)',
    oxblood: '#8e1b1b', red: '#c4362b', brass: '#dba84a', blue: '#2a47a6', win: '#7fd48d' };
  var METHOD = { ko: 'Knockout', tko: 'TKO', ud: 'Decision', sd: 'Split decision', md: 'Majority decision', draw: 'Draw' };
  var cache = {};

  SS.boutCode = function (id) {
    var m = /^\[(\d+),(\d+)\]$/.exec(String(id || ''));
    return m ? m[1] + '-' + m[2] : '';
  };
  SS.boutUrl = function (id) {
    var code = SS.boutCode(id);
    return code ? location.origin + '/b/' + code : location.origin + location.pathname + '#bout/' + encodeURIComponent(id);
  };

  function fonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var all = Promise.all(['64px Anton', '600 30px "Barlow Condensed"', '700 30px "Barlow Condensed"', '500 30px Barlow']
      .map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 2500); })]);
  }
  function svgImage(svg, px) {
    svg = svg.replace('<svg ', '<svg width="' + px + '" height="' + px + '" ');
    if (svg.indexOf('xmlns=') < 0) svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  function name(side) { return side.fighter ? side.fighter.ring : (side.name || ''); }
  function sub(side) {
    if (side.fighter) return [side.fighter.city, side.fighter.country].filter(Boolean).join(' · ') || 'Subsudo fighter';
    if (side.house) return 'House fighter' + (side.level ? ' · ' + side.level : '');
    if (side.guest) return 'Guest';
    return '';
  }
  function portrait(side) {
    var f = side.fighter;
    if (f && !side.house && !side.guest && SS.face) {
      return svgImage(SS.face(f.avatar || SS.defaultFace(f.id || f.ring), { full: true, glove: f.glove, hurt: f.hurt }), 840)
        .then(function (img) { return { img: img, glove: false }; });
    }
    return svgImage(SS.gloveSvg(side.guest ? 'white' : side.house ? 'brass' : 'oxblood'), 560)
      .then(function (img) { return { img: img, glove: true }; });
  }
  function fit(ctx, text, max, weight, size, family) {
    var s = size;
    do { ctx.font = weight + ' ' + s + 'px ' + family; s -= 2; } while (ctx.measureText(text).width > max && s > 18);
    return text;
  }
  function round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wall(ctx) {
    ctx.fillStyle = C.wall; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 2;
    for (var row = 0, y = 0; y < H; row++, y += 56) {
      for (var x = (row % 2) * -66; x < W; x += 132) ctx.strokeRect(x + 3, y + 3, 126, 50);
    }
    var g = ctx.createRadialGradient(W / 2, H * 0.42, 200, W / 2, H * 0.45, 900);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function corner(ctx, x, y, s, color, pic, side, lost) {
    round(ctx, x, y, s, s, 14);
    ctx.fillStyle = color; ctx.fill();
    ctx.save(); round(ctx, x, y, s, s, 14); ctx.clip();
    if (pic.img) {
      if (pic.glove) {
        ctx.drawImage(pic.img, x + s * 0.18, y + s * 0.14, s * 0.64, s * 0.64);
        ctx.fillStyle = side.guest ? '#3a2d14' : C.deep; ctx.textAlign = 'center';
        ctx.font = '400 ' + Math.round(s * 0.16) + 'px Anton';
        ctx.fillText((UI.initials ? UI.initials(name(side)) : name(side).slice(0, 2)).toUpperCase(), x + s / 2, y + s * 0.62);
      } else {
        ctx.drawImage(pic.img, x, y, s, s);
      }
    }
    if (lost) { ctx.fillStyle = 'rgba(11,10,9,.32)'; ctx.fillRect(x, y, s, s); }
    ctx.restore();
    ctx.lineWidth = 8; ctx.strokeStyle = '#000'; round(ctx, x, y, s, s, 14); ctx.stroke();
  }
  function stamp(ctx, title, line, color) {
    ctx.save();
    ctx.translate(W / 2, 1000); ctx.rotate(-6 * Math.PI / 180);
    fit(ctx, title, 640, '400', 104, 'Anton');
    var tw = Math.max(ctx.measureText(title).width, 300) + 80;
    round(ctx, -tw / 2, -92, tw, 168, 12);
    ctx.fillStyle = 'rgba(11,10,9,.55)'; ctx.fill();
    ctx.lineWidth = 10; ctx.strokeStyle = color; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.fillText(title, 0, 18);
    fit(ctx, line, tw - 60, '700', 34, '"Barlow Condensed"');
    ctx.fillText(line, 0, 60);
    ctx.restore();
  }

  SS.posterPng = function (b) {
    return Promise.all([fonts(), portrait(b.a), portrait(b.b)]).then(function (res) {
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      var r = b.result || {}, win = r.winner;
      wall(ctx);
      // top band: the club and the bout
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.brass;
      ctx.font = '400 66px Anton'; ctx.fillText('SUBSUDO', 72, 112);
      ctx.textAlign = 'right'; ctx.fillStyle = C.muted;
      fit(ctx, ((b.kind_label || 'Bout') + ' · ' + (b.secs || 60) + '-second round').toUpperCase(), 560, '600', 32, '"Barlow Condensed"');
      ctx.fillText(((b.kind_label || 'Bout') + ' · ' + (b.secs || 60) + '-second round').toUpperCase(), W - 72, 104);
      ctx.fillStyle = C.oxblood; ctx.fillRect(72, 138, W - 144, 10);
      ctx.fillStyle = 'rgba(219,168,74,.8)'; ctx.fillRect(72, 148, W - 144, 4);
      // the two corners
      var S = 420, top = 196;
      corner(ctx, 72, top, S, 'rgba(142,27,27,.55)', res[1], b.a, win === 'b');
      corner(ctx, W - 72 - S, top, S, 'rgba(42,71,166,.5)', res[2], b.b, win === 'a');
      ctx.beginPath(); ctx.arc(W / 2, top + S / 2, 58, 0, Math.PI * 2);
      ctx.fillStyle = C.deep; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = C.brass; ctx.stroke();
      ctx.fillStyle = C.brass; ctx.textAlign = 'center'; ctx.font = '400 46px Anton'; ctx.fillText('VS', W / 2, top + S / 2 + 17);
      // names, places, scores, punches
      [['a', 72 + S / 2], ['b', W - 72 - S / 2]].forEach(function (p) {
        var side = b[p[0]], x = p[1], st = side.stats || {}, won = win === p[0];
        ctx.textAlign = 'center'; ctx.fillStyle = C.ink;
        var nm = name(side).toUpperCase();
        fit(ctx, nm, S + 20, '400', 62, 'Anton'); ctx.fillText(nm, x, top + S + 78);
        ctx.fillStyle = C.muted; var pl = sub(side).toUpperCase();
        fit(ctx, pl, S, '600', 30, '"Barlow Condensed"'); ctx.fillText(pl, x, top + S + 118);
        ctx.fillStyle = won ? C.win : 'rgba(243,236,224,.8)'; ctx.font = '400 128px Anton';
        ctx.fillText(side.score == null ? '–' : String(side.score), x, top + S + 258);
        ctx.fillStyle = C.faint; ctx.font = '600 30px "Barlow Condensed"';
        ctx.fillText(((st.punches || 0) + ' punches · ' + (st.blocks || 0) + ' blocks').toUpperCase(), x, top + S + 302);
      });
      // the stamp
      var title = (METHOD[r.method] || (win === 'draw' ? 'Draw' : 'Decision')).toUpperCase();
      var line = win === 'draw' ? 'THE JUDGES COULDN\'T SPLIT THEM' : (name(win === 'a' ? b.a : b.b) + ' wins').toUpperCase();
      stamp(ctx, title, line, win === 'draw' ? C.ink : C.red);
      // the judges' cards: A's score on A's side, B's on B's
      var cards = r.cards || [], y0 = 1132;
      cards.slice(0, 3).forEach(function (c, i) {
        var y = y0 + i * 50;
        ctx.textAlign = 'center'; ctx.fillStyle = C.muted;
        fit(ctx, String(c.judge || ''), 440, '500', 30, 'Barlow'); ctx.fillText(String(c.judge || ''), W / 2, y);
        ctx.font = '400 40px Anton';
        ctx.fillStyle = c.a > c.b ? C.win : C.ink; ctx.fillText(String(c.a), 72 + S / 2, y + 4);
        ctx.fillStyle = c.b > c.a ? C.win : C.ink; ctx.fillText(String(c.b), W - 72 - S / 2, y + 4);
      });
      // footer
      ctx.fillStyle = C.deep; ctx.fillRect(0, H - 96, W, 96);
      ctx.fillStyle = C.oxblood; ctx.fillRect(0, H - 96, W, 6);
      ctx.textAlign = 'left'; ctx.fillStyle = C.brass; ctx.font = '400 44px Anton'; ctx.fillText('SUBSUDO.COM', 72, H - 32);
      ctx.textAlign = 'right'; ctx.fillStyle = C.ink;
      fit(ctx, 'Think you\'d beat them? Try a round.', 560, '600', 34, '"Barlow Condensed"');
      ctx.fillText('Think you\'d beat them? Try a round.', W - 72, H - 36);
      return new Promise(function (resolve, reject) {
        cv.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('The poster could not be drawn.')); }, 'image/png');
      });
    });
  };

  function poster(b) {
    var key = String(b.id || '') + ':' + (b.finished || '');
    if (!cache[key]) {
      cache[key] = SS.posterPng(b);
      cache[key].catch(function () { delete cache[key]; });
    }
    return cache[key];
  }
  function fileName(b) {
    var slug = (name(b.a) + '-vs-' + name(b.b)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'subsudo-' + (slug || 'bout') + '.png';
  }
  SS.posterPrepare = function (b, img) {
    return poster(b).then(function (blob) {
      if (img) {
        if (img._url) URL.revokeObjectURL(img._url);
        img._url = URL.createObjectURL(blob);
        img.src = img._url;
      }
      return blob.size;
    });
  };
  /* the same without making Python wait: done(size in bytes) when drawn, done(-1) if it failed */
  SS.posterStart = function (b, img, done) {
    SS.posterPrepare(b, img).then(function (n) { if (done) done(n); }, function (e) { console.warn(e); if (done) done(-1); });
  };
  function download(blob, file) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  SS.sharePoster = function (b, text) {
    var url = SS.boutUrl(b.id), file = fileName(b);
    return poster(b).then(function (blob) {
      var f = null;
      try { f = new File([blob], file, { type: 'image/png' }); } catch (e) {}
      if (f && navigator.canShare && navigator.share && navigator.canShare({ files: [f] })) {
        return navigator.share({ files: [f], title: 'Subsudo', text: (text ? text + ' ' : '') + url }).then(function () { return 'shared'; },
          function (err) { if (err && err.name === 'AbortError') return 'cancelled'; download(blob, file); return copyQuiet(url); });
      }
      download(blob, file);
      return copyQuiet(url);
    });
  };
  function copyQuiet(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(url).then(function () { return 'downloaded'; }, function () { return 'downloaded-nolink'; });
    return Promise.resolve('downloaded-nolink');
  }
})();
