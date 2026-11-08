/* Smoke test (tools/ui_test.py runs it at 1280 px and at 390 px): every page address opens without errors, is not
   empty and doesn't scroll sideways. Signed out (landing, the boards, a fighter's page, a closed invite, sign in/up),
   then as a new member (the gym, Find, Mail, every fight mode, answering Coach Bruno's welcome bout's screen, a bout,
   the Locker room, the fighter card, plus one fast pad round through the recorder engine and back to Python), then as
   admin (every Admin tab). Python/JS errors are caught by ui_test.py from the browser log. Resolves to {ok, log}. */
(async function () {
  const log = [], bad = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  const errs = [];
  window.addEventListener('error', (e) => errs.push(String(e.message || e)));
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const visible = (e) => !!e && e.getClientRects().length > 0;
  function button(re, root) { return $$((root || '') + ' button').find((b) => re.test(b.textContent) && visible(b)); }
  async function open(hash, expect, landed) {
    if (location.hash !== hash) window.UI_READY = false;
    location.hash = hash;
    await until(() => window.UI_READY && (landed ? landed() : location.hash === hash), hash, 30000);
    await sleep(700);
    const main = $('.ui-main');
    const text = main ? main.innerText.trim() : '';
    const w = document.documentElement.scrollWidth, vw = screen.width <= 500 ? screen.width : window.innerWidth;
    const problems = [];
    if (text.length < 40) problems.push('empty page');
    if (expect && !new RegExp(expect.source, 'i').test(text)) problems.push('missing ' + expect);
    if (w > vw + 1) {
      const wide = $$('body *').filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1; })
        .slice(0, 3).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 2).join('.'));
      problems.push('scrolls sideways (' + w + ' > ' + vw + ') ' + wide.join(' '));
    }
    if (errs.length) problems.push('errors: ' + errs.splice(0).join(' / '));
    if (problems.length) bad.push(hash + ': ' + problems.join('; '));
    log.push((problems.length ? 'BAD  ' : 'ok   ') + hash);
  }
  async function signUp(name, email, password) {
    location.hash = '#auth/signup';
    await until(() => window.UI_READY && $$('.au-card input').length >= 3, 'sign-up form');
    await sleep(400);
    const inputs = $$('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]');
    type(inputs[0], name); type(inputs[1], email); type(inputs[2], password);
    const tick = $('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    button(/Create account/, '.au-card .anvil-role-btn-block').click();
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      if (location.hash.indexOf('#home') === 0 && window.UI_READY && $('.gy-card')) return true;
      const msg = $('.au-card .anvil-role-msg-error');
      if (msg && visible(msg) && msg.textContent.trim()) { log.push('sign-up said: ' + msg.textContent.trim()); return false; }
      await sleep(200);
    }
    log.push('sign-up: still on ' + location.hash);
    return false;
  }
  async function signIn(email, password) {
    location.hash = '#auth';
    await until(() => window.UI_READY && $$('.au-card input[type=password]').length, 'sign-in form');
    await sleep(400);
    type($('.au-card input[type=email]'), email); type($('.au-card input[type=password]'), password);
    button(/Sign in/, '.au-card .anvil-role-btn-block').click();
    await until(() => location.hash.indexOf('#home') === 0 && window.UI_READY, 'signed in as ' + email, 30000);
  }
  async function signOut() {
    $('.anvil-role-avatar button').click();
    await sleep(300);
    button(/Sign out/, '.ui-menu').click();
    await until(() => {
      const a = $('.anvil-role-avatar button');
      return location.hash === '#landing' && window.UI_READY && (!a || !visible(a));
    }, 'signed out');
  }
  try {
    // ---- signed out
    await open('#landing', /Throw the first round/);
    const fighterLink = await until(() => $('.lp-board a.rk-row[href^="#fighter/"]'), 'the world top 5 (demo fighters)', 20000).catch(() => null);
    if (!fighterLink) bad.push('#landing: the world board is empty');
    if ($$('.lp-ticker .tk').length < 4) bad.push('#landing: no ticker');
    if (!$('.ss-av')) bad.push('#landing: no avatars drawn');
    const fighterHash = fighterLink ? fighterLink.getAttribute('href') : null;
    await open('#rankings', /Rankings/);
    if (!$('.rk-pod')) bad.push('#rankings: no podium');
    await open('#rankings/week', /7 days/);
    await open('#rankings/city', /Rankings/);
    if (fighterHash) await open(fighterHash, /Recent bouts/);
    await open('#invite/not-a-real-token', /link is closed/);
    await open('#auth', /Sign in/);
    await open('#auth/signup', /Create account/);

    // ---- a new member
    const ok = await signUp('Smoke Tester', 'smoke' + Date.now() + '@example.com', 'Ss-' + Math.random().toString(36).slice(2) + '-Kq7');
    if (!ok) throw new Error('sign-up failed');
    await open('#home', /Pick a fight/);
    const answer = $('a.ui-btn[href^="#fight/answer/"]');
    if (!answer) bad.push('#home: no welcome bout to answer');
    await open('#find', /Find a fight/);
    if (!$('.fd-card')) bad.push('#find: no fighters');
    await open('#find/calls', /call-out/);
    await open('#mail', /Mail/);
    if (answer) {
      const id = answer.getAttribute('href').split('/')[2];
      await open('#fight/answer/' + id, /sealed until you fight back/);
      await open('#bout/' + id, /Fight back/);
    }
    if (fighterHash) {
      await open(fighterHash, /Recent bouts/);
      const scorecards = $('.ss-bout a.ui-btn[href^="#bout/"]');
      await open('#fight/call/' + fighterHash.split('/')[1], /Calling out/);
      if (scorecards) await open(scorecards.getAttribute('href'), /Mail/);
    }
    await open('#fight/open', /Open call-out/);
    await open('#fight/invite', /Invite a friend/);
    await open('#fight/train', /Bag work/);
    // one fast pad round: engine -> Python on_keep -> save_training -> the result screen
    window.SS.timeScale = 30; window.SS.prefs.sound = false; window.SS.prefs.voice = false; window.SS.prefs.music = false;
    (await until(() => $('[data-dev=pads]'), 'the pads choice')).click();
    await sleep(300);
    (await until(() => $('[data-start]'), 'Glove up')).click();
    await sleep(400);
    for (let i = 0; i < 30; i++) { window.SS.tapPad(i % 6); await sleep(60); }
    const keep = await until(() => $('[data-keep]'), 'the round summary', 30000).catch(() => null);
    if (!keep) bad.push('#fight/train: the round never finished');
    else {
      keep.click();
      await until(() => /Round saved|Personal best/i.test(($('.ui-main') || {}).innerText || ''), 'training saved', 30000)
        .then(() => log.push('ok   pad round saved'), () => bad.push('#fight/train: keeping the round did not save it'));
    }
    if (errs.length) bad.push('#fight/train: errors: ' + errs.splice(0).join(' / '));
    await open('#locker', /Locker room/);
    const next = $('.lk-arrow[aria-label^="Next"]');
    if (next) { next.click(); await sleep(400); }
    await open('#profile', /Fighter card/);
    await open('#rankings/city', /Rankings/);
    await open('#landing', /Open the gym/);
    await signOut();

    // ---- admin (ADMIN_EMAILS in Accounts.py): sign up the first time, sign in after that
    const adminPw = 'Ss-smoke-adm-93Kx-7q';
    if (!(await signUp('Admin Tester', 'arkulinskis@gmail.com', adminPw))) await signIn('arkulinskis@gmail.com', adminPw);
    for (const t of ['overview', 'challenges', 'log', 'feedback', 'users', 'demo']) await open('#admin/' + t, /Admin/);
    await signOut();
    log.push(bad.length ? 'PROBLEMS: ' + bad.join(' | ') : 'PASSED');
    return { ok: !bad.length, log: log };
  } catch (e) {
    log.push(String(e && e.message || e));
    if (bad.length) log.push('PROBLEMS: ' + bad.join(' | '));
    return { ok: false, log: log };
  }
})();
