/* ss-face.js: _ss_face: the fighter portraits (built in the Locker room, locker.html).
  SS.AVATAR      the parts: key -> {label, names[], colors?}. The counts must match Fighters.AVATAR_PARTS (server).
  SS.face(spec, {glove, hurt, full}) -> an SVG string (200x200 drawing, cropped to the face unless full): backdrop, torso + top, neck, head, ears,
                 hair, brows, eyes, nose, mouth, facial hair, headgear, marks, gloves/hands, then bout damage.
  SS.defaultFace(seed) a stable random look for fighters who never visited the Locker room.
  hurt = {level 0..4, age (hours since the bout), ko}: level >= .3 flushed cheek, >= 1 black eye, >= 1.6 cut brow with
  butterfly strips, >= 2.2 swollen cheek + nose tape, >= 2.8 second black eye + head bandage; a fresh KO adds
  dizzy stars. Bruises go purple -> blue -> yellow-green as they age, and fade out by 24 hours (the level drops). */
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
