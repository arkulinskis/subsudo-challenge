---
name: subsudo
description: Context, workflow and recipes for Subsudo (folder subsudo-forms), the user's Anvil app built as native Anvil Forms (Python + HTML templates, a layout, custom components, RepeatingPanels) around JavaScript engines (punch detection, recorder, portraits). A virtual fight club where adults shadow-box rounds with their phone (motion sensors) or laptop camera (MediaPipe hand tracking), send them as sealed call-outs by mail, and get judged and ranked by city and worldwide. Load this before any feature request, bug fix, restyle, content change or deploy for this app.
---

# Subsudo: working on the app

**What it is:** a virtual fight club for adults. A member records a round (phone in fist: right hand, bell, left hand;
or laptop camera: both hands) and sends it to another member, to an open call-out board, or to a friend by link (no
account needed). The opponent answers on their own time (bouts are messages in Mail); three automatic judges decide;
Elo rating, points, belts and world/city rankings move. Admins send "house challenges" from gym fighters to members
who have nobody to fight, and see a full fight log.

**Where it lives:**
- Folder `C:\Users\arkvi\Documents\CLAUDE\subsudo-forms\` = the git clone of
  **github.com/arkulinskis/subsudo-challenge**, branch `master`. "git" layout: the folder *is* the Anvil app. Anvil
  pulls master; pushing is the deploy. Live: https://subsudo.com.
  (github.com/arkulinskis/subsudo is a different, private repo of the user's. Never push there.)
- Native Forms since 2026-11-08 (forms branch merged that day). The old source folder `..\subsudo` is retired
  (RETIRED.md; its deploy.py refuses to run): never deploy from it.
- Made like `APP_MAKER\template-forms`; its guide has the general Forms patterns, accessibility and design-kit rules.
- **README.md** lists every feature. **APP_MAP.md** is the code map: read it first, regenerate after changes
  (`python -I C:/Users/arkvi/Documents/CLAUDE/APP_MAKER/standard/app_map.py subsudo`).

**What the user wants:** "a gym with gym bags and boxing elements, for adults not kids". Direction: **back-alley gym**:
canvas `#efe9df` / surface `#fbf8f2` / ink `#1c1a18` / oxblood `#8e1b1b` (dark `#c4362b`) / brass `#b07a1f` (dark
`#dba84a`); dark bg `#121110` (rubber floor). Header, footer and phone tab bar are always the dark gym wall
(`--c-hdr`). Fonts: **Anton** (fight-poster headings, uppercase), **Barlow** (body), **Barlow Condensed** (labels,
buttons, badges). Tight radius (8/5px), hard 3px poster shadows on primary buttons, dotted canvas texture, "athletic
tape" section rules (`.ss-h::after`, `design-ok`), gym-bag tiles on Home, glove avatars in the fighter's glove colour.
Claude assumes details and builds; Claude deploys. Every page fits 390 px.

## Workflow for any change

1. `git pull --ff-only` (Anvil commits "Edited ..." when the user changes something in the IDE).
2. Edit a page's template and Python side by side (`client_code/Pages/X/`), or an engine in `theme/assets/ss-*.js`.
3. `python tools/check.py` (no -I) -> **ALL CHECKS PASSED**: `anvil validate`, JS syntax, asset hashes
   (`tools/assets.py`), server tests.
4. `python -I tools/ui_test.py` (Docker Desktop running) -> the smoke test (tools/ui/smoke.js: every address as guest /
   member / admin at 1280 + 390 px, plus one fast pad round with `SS.timeScale` + `SS.tapPad`). Server edits need
   `--restart`; `--stop` at the end.
5. Commit as arkulinskis with the Co-Authored-By line; `git push origin master`. New tables/columns: tell the user to
   accept the **Schema Mismatch** alert ("The schema of the source code is correct"). Regenerate APP_MAP.md.

## Architecture

```
client_code/
  startup.py     as template-forms + sets window.SS_HOST.toast (engine toasts)
  router.py, state.py, auth.py, legal.py   as template-forms (legal.py = the kit: don't edit)
  ss.py          Python <-> engines: js()/py() JSON bridge, text helpers
  Layouts/Shell  dark gym-wall header, account menu, footer (4 links), phone tab bar; Mail dot (polls unread_count
                 every 60 s and 1.2 s after a page change if 20 s passed; Pages/Mail calls shell.set_unread(n))
  Pages/         Landing, Auth, Home (gym), Fight, Bout, Find, Rankings, Mail, Fighter, Invite (#invite/<token>),
                 Locker (avatar), Profile, Admin (overview, house challenges/campaigns, fight log, users, demo, feedback)
  Components/    Recorder (the round flow), Avatar, Place, Tags, Poster, Result, VsBars, Timeline, RatingLine
  Items/         list rows (NavLink carries `dot`; PartRow updates in place to keep focus)
server_code/     Boxing.py (the sport, no database: clean_round, score_round, JUDGES, elo, damage, POINTS, TIERS),
                 Fights.py (bouts, finish, KIND_LABELS, EXPIRE_DAYS, _bot_answer), Fighters.py (card, gym, find,
                 belts, AVATAR_PARTS, hurt_now, active), HouseFights.py, Inbox.py, Invites.py, Rankings.py,
                 DemoData.py, Accounts, Admin, Feedback, common.py, SchemaCheck, legal_server, seo_routes
theme/assets/    ss-core.js (window.SS: portraits SS.avatar, punch timeline, rating line, tape bars, live score =
                 mirror of Boxing.score_round, bell/thud/voice, music, share/copy, UI.toast/busy/initials shim),
                 ss-face.js (SS.AVATAR parts + SS.face SVG + bout damage), ss-motion.js (PhoneDetector,
                 CameraDetector/MediaPipe, SS.recorder), ark-music.js (shared player, generated), app.css,
                 app-kit.js, theme.css
```

## How things are done here

- Pages, lists, dialogs, buttons, server calls: the template-forms patterns (its guide).
- **Recorder:** a page calls `self.recorder.start(on_keep, secs=, devices=, allow_secs=, keep_label=)`; the engine's
  Keep calls Python `on_keep(round_dict)` (a Promise in JS while the server call runs). On `{ok: False}` state.call
  toasts and the summary stays for another try. The component stops camera/motion/music on `hide`; pages call
  `recorder.stop()` when they swap to a result screen.
- **Guest invites:** Pages/Invite keeps `guest_key` and leaves `claim` = {token, key} in browser storage (prefix
  `subsudo.`); Pages/Home claims it on the next visit.
- **Locker:** part names/colours come from `SS.AVATAR` (JS) so they match the drawing; `Fighters.AVATAR_PARTS` must
  keep the same counts.
- **Admin house fighter** is a DropDown of `HOUSE_FIGHTERS`.
- The Recorder's gear icon wrapper is `.rc-ic` (`.ic` is the icon-mask class).

## Recipes

- **New page / server function / table:** template-forms recipes (public callables in `PUBLIC` in test_server.py;
  ownership checks; `C.ok` / `C.fail`). Add the address to tools/ui/smoke.js.
- **Change scoring:** `Boxing.score_round` AND its mirror `SS.score` in ss-core.js (the live score in the recorder).
  The server's score is the one that counts. Judges: `Boxing.JUDGES` + `_judge_metric`; stoppages in `judge()`.
- **Tune punch detection:** phone = `PhoneDetector.TRIGGER/WINDOW/REFRACTORY` and the ratios in
  `PhoneDetector.classify`; camera = `CameraDetector.prototype.feed` (growth > 2.2/s = punch), in ss-motion.js.
- **Points / rating:** `Boxing.POINTS`, `Boxing.elo` (K 40 provisional, 28 after 5 bouts), `PROVISIONAL_FIGHTS`,
  `ACTIVE_DAYS`, `TIERS`. Update the "How the rankings work" text on Rankings, the landing FAQ and the README.
- **New house fighter / level:** `HouseFights.HOUSE_FIGHTERS`, `Boxing.HOUSE_LEVELS` (+ `HOUSE_LEVEL_NAMES`).
- **New avatar part or option:** `SS.AVATAR` (names, colours) + draw it in `SS.face` (ss-face.js), then
  `Fighters.AVATAR_PARTS` (counts must match) and the Locker's rows.
- **Bout damage:** `Boxing.damage(outcome, method, opponent_punches)`, `HURT_MAX`, `HURT_HOURS`; applied in
  `Fights.finish`; `Fighters.hurt_now` -> {level, age, hours_left, ko, label}. Drawing stages: `injuries()` in
  ss-face.js (thresholds 0.3 / 1 / 1.6 / 2.2 / 2.8; colour by age).
- **New badge:** `Fighters.get_fighter` (`badge(...)`) + its icon on the Fighter page.
- **New bout kind:** `Fights.KIND_LABELS`, `EXPIRE_DAYS`, `finish()` (ratings/points branch), `bout()` view, the card badges.
- **Testing a round in the browser:** `SS.timeScale = 12` (fast clock), `SS.forceMotion = true` (phone mode on a
  desktop), `SS.injectMotion({t, ax, ay, az, gx, gy, gz, rot})` during the fight, `SS.tapPad(i)` for pads (training).
- **Email:** not used. If added: the email service in anvil.yaml, `anvil.email.send(...)`, and the legal kit (`emails: true`).
- **Restyle:** tokens at the top of app.css (light + dark), fonts in head_html, spinner in theme.css, `LEGAL_THEME` in
  startup.py and `theme.accent` in the legal kit json.

## Gotchas

- **Demo fighters have `enabled=False`** but must still show and fight: always `Fighters.active(u)`, never
  `u["enabled"]`. They answer call-outs instantly (`Fights._bot_answer`); bouts against them are `is_demo` and
  disappear with the demo (members' points stay on `users.points`).
- The phone needs HTTPS and, on iOS, `DeviceMotionEvent.requestPermission()` from a tap ("Glove up"). Web Audio needs
  that tap too (`SS.unlockAudio`). iOS has no `navigator.vibrate`.
- MediaPipe loads with `import()` from jsDelivr (+ the model from storage.googleapis.com) only when the camera is
  chosen; GPU delegate first, CPU fallback. Its handedness labels assume a mirrored picture, so "Left" = the
  fighter's right hand (the video is mirrored with CSS only).
- Phone rounds: right hand in the first half, left in the second (the 5-second switch isn't counted); the timeline
  draws a RIGHT | LEFT divider for phone lanes.
- The portrait SVG uses ids made unique per drawing (`sf1`, `sf2`...); keep that when adding defs. Default view crops
  to the face (viewBox 20 18 160 160); `SS.face(spec, {full: true})` draws the whole 200x200 scene.
- `Fights.finish(f, when)` takes the bout time (demo data fights in the past).
- Pad rounds are accepted only for training (`clean_round(training=True)`).
- Anton headings are uppercased by CSS: compare text lowercased in tests.
- Email confirmation is off: whoever first signs up with an ADMIN_EMAILS address (Accounts.py) becomes admin.
- Never write Anvil's theme-colour token pattern (percent, `color:`, name, percent) in theme.css.
- No `gh` CLI; git pushes over HTTPS through Git Credential Manager.

## Music

`SS.music('walkout'|'round'|null)` in ss-core.js, called by SS.recorder (pick = walk-out, first fight step = round,
finish/destroy = stop); `SS.say` ducks it. Pref `SS.prefs.music`. Player = `window.ArkMusic` in
theme/assets/ark-music.js, written by `APP_MAKER/tools/music_sync.py`: edit `APP_MAKER/media/public/ark-music.js` and
re-sync, never the copy.

## Privacy & Terms (legal kit)

From `C:/Users/arkvi/Documents/CLAUDE/APP_MAKER/legal-kit` (`apps/subsudo.json`: punch logs, fighter card, guests,
motion sensors + camera used on the device only, "Fighting fair" and "Safety" terms; the `mediapipe` provider covers
jsDelivr + Google): `python -I build.py subsudo && python -I install.py subsudo` there (writes
theme/assets/legal-kit.js, client_code/legal.py, server_code/legal_server.py, the head_html tag), then
`python tools/assets.py` and deploy. Sign-up keeps the tick box (Pages/Auth). Continue with Google:
`login_with_google()` returns None for someone without an account, so auth.py then calls `signup_with_google()` (needs
the tick first). Consent is stored in `users.legal_version`, `legal_accepted_at`, `legal_source`. Feedback = Prepsto
only ("Submit feedback").
