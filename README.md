# Subsudo

The virtual fight club. Adults shadow-box one round with their **phone held in their fist** (motion sensors) or in front
of their **laptop camera** (in-browser hand tracking), send it to anyone in the world as a sealed call-out, and the
opponent fights back on their own time. Three automatic judges score the bout; ratings, points, belts and the world
and city rankings move. Bouts arrive as messages (Mail), so nothing has to be live. Built on [Anvil](https://anvil.works).

- **App repo:** github.com/arkulinskis/subsudo-challenge (branch `master`). Anvil pulls `master`.
- **Live:** not published yet.

## What it does

**For visitors:** a landing page (gym scene, how it works, live World top 5, FAQ), public rankings (`#rankings`) and
fighter pages (`#fighter/<id>`), sign-up with email and password, Privacy & Terms, and **friend invites**: anyone with an
invite link (`#invite/<token>`) can fight back without an account, see the result at once, and claim the bout onto their
record if they sign up later on the same device.

**For members:**
- **The gym** (`#home`): fighter card with rating, tier, record, KOs, points, top speed, world and city rank, belts;
  "In your corner" (bouts waiting for your answer); four ways to fight; bouts you're waiting on; recent results; your
  city's board; "fair fights" (opponents near your rating, other cities first); bag-work bests.
- **Recording a round** (`#fight/...`): pick the gear (phone / camera, plus on-screen pads for training), 30/60/90 s,
  bell and punch sounds, the corner voice, a 3-2-1 countdown, the live round (timer ring, punch count, last punch and
  speed, left/right/blocks, flash on each hit), a summary, then keep or redo.
  - **Phone:** right fist for half the round, two bells and a 5-second switch, then the left fist. Forward thrust =
    punch (straight), up + forward = uppercut, a fast wrist turn (gyroscope) = hook, straight up or down = block.
    Speed is estimated from the acceleration. Screen wake lock, vibration on each hit.
  - **Camera:** MediaPipe Hand Landmarker (loaded from jsDelivr + Google's model file only when chosen) tracks both
    hands; a fist growing fast in the picture = punch, up + forward = uppercut, sideways = hook, up/down = block. The
    picture never leaves the device.
- **Ways to fight:** call out a member (`#fight/call/<id>`), answer a call-out (`#fight/answer/<id>`), post an **open
  call-out** anyone (or only your city) can take (`#fight/open`), **invite a friend** with a link (`#fight/invite`:
  copy / share / WhatsApp / SMS / email), **bag work** (`#fight/train`, 1 point a round, 5 a day).
- **Sealed scores:** the opponent only sees your words and the rules until they answer.
- **Judging:** each round is scored from its punch log (punch type × speed, blocks, combos, both-hands bonus). Three
  judges look at power, volume and ring craft and score 10-9 / 10-8 / 10-10; majority wins. Lopsided scores are a
  TKO (1.8×) or KO (2.5×, or nothing thrown).
- **Bout page** (`#bout/<id>`): poster, the decision stamp, judges' cards, tale of the tape (side-by-side stats), the
  punch timeline for both fighters, post-fight words, rematch; decline ("duck") or cancel while pending.
- **Find** (`#find`): fighters by world / my city / near my rating, search by name or city, open to fights; the open
  call-out board (`#find/calls`).
- **Rankings** (`#rankings`, `/city[/<key>]`, `/week`): Elo rating (start 1000; KO ×1.25, split ×0.8), shown after 3
  ranked bouts and while you fought in the last 120 days; podium, belts (#1 world = World belt, #1 of each city =
  city belt), tiers (Bag Puncher → Champion), "This week" by points.
- **Mail** (`#mail`): call-outs, house challenges, results, ducks, no-shows, post-fight words; red unread dot on the nav.
- **Fighter pages:** rating line, record, best round, 9 badges (First blood, KO artist, Speed demon, Volume puncher,
  Iron guard, Globetrotter, House crusher, Road warrior, Belt holder).
- **Locker room** (`#locker`): the avatar builder. A portrait (SVG) with ‹ › arrows (and ← → keys) for 17 features: skin, face
  shape, marks (scar, cauliflower ear, tattoo, chain, earring, freckles), hair (13 styles), hair colour, brows, facial hair, eyes,
  eye colour, nose (incl. a boxer's break), mouth (incl. mouthguard), headgear, top, kit colour, gloves, hands (guard, wraps...),
  backdrop; Random; Save. The portrait replaces the glove avatar everywhere (cards, posters, rankings, Find, Mail).
- **Bout damage:** every finished bout marks both faces (losing by KO most, a winner a little, plus how many punches you took):
  flushed cheeks, a black eye, a cut brow with butterfly strips, a swollen cheek and nose tape, a second black eye and a head
  bandage, dizzy stars for 3 hours after a KO. It heals in a straight line over 24 hours, bruises turning purple → blue →
  yellow; a badge says "Bruised · 9h to heal". The locker can preview each stage.
- **Profile** (`#profile`): fighter card (ring name, city + country, stance, glove colour, a line, open to fights) with
  a live preview; name, theme, sound and voice, password reset.
- **Welcome:** every new member gets a 30-second bout from Coach Bruno (and, while demo data is loaded, a call-out from
  a demo fighter). Unanswered bouts expire after 7 days (invites 14); a no-show counts as a duck.

**For admins** (`#admin`; arkulinskis@gmail.com becomes an admin on first sign-in):
- **Overview:** members, feedback, bouts fought / waiting, rounds recorded and flagged, active challenges.
- **Challenges:** send a house challenge (house fighter, level Rookie/Club/Pro/Champion, round length, bonus points,
  days to answer, message) to everyone, members idle for N days, members who never fought, one city, or picked
  members; live audience count; stats per challenge (sent, fought, house won); cancel the unanswered ones.
- **Fight log:** every bout with kind, status, both devices, scores, punches, result and flags (very high punch rate,
  speed at the limit, identical speeds); filter; CSV download; click through to the bout.
- **Feedback inbox, Users** (make admin, disable), **Demo data** (14 demo fighters in 11 cities with their own looks and 46 bouts, 3 of them last night so some faces are bruised, open
  call-outs and a house challenge; remove or reload).

**Points:** ranked win 25, KO/TKO win 35, draw 12, loss 5; house win 15 (+ bonus), draw 8, loss 3; invite bouts (the
inviter) 12 / 18 / 6 / 2; bag work 1 (5 a day).

## Setting it up in Anvil (once)

1. In the Anvil editor: **Create app → Clone from GitHub**, and paste `https://github.com/arkulinskis/subsudo-challenge`.
2. **Users** service: email + password, sign-up allowed (already set in `anvil.yaml`; check it).
3. Open the app in the editor. If it shows a **Schema Mismatch** alert, choose **"The schema of the source code is correct"** so Anvil creates the tables.
4. **Run** it and sign up with **arkulinskis@gmail.com** straight away (that account becomes the admin).
5. **Publish** (Publish → public URL, or your own domain). Motion sensors and the camera need HTTPS (Anvil gives it).

## Working on it

See `.claude/skills/subsudo/SKILL.md`. In short:

```
python -I tools/check.py --ui                    # syntax, server tests, headless UI tests → ALL CHECKS PASSED
python -I tools/preview/devserver.py 8765        # the app on in-memory data: http://localhost:8765/  (?as=ana#home, ?as=admin#admin)
python tools/deploy.py                           # dry run (needs PyYAML, so no -I)
python tools/deploy.py --push "Message"          # deploy: commit + push to GitHub, Anvil pulls it
```

## Project layout

```
web/            core.js/core.css (shared engine + gym design tokens), app.js (header, footer), pages/*.html
                pages/_ss_core.html   window.SS: avatars, bout cards, poster, judges, timeline, score, sounds, unread dot
                pages/_ss_face.html   SS.face: the avatar portraits + bout damage (built in pages/locker.html)
                pages/_ss_motion.html phone + camera detectors and the round recorder
client_code/    Main.py (the only Anvil form: bridge to the server, sign-in), legal.py
server_code/    Boxing.py (rules: scoring, judges, Elo, points, house rounds), Fighters.py, Fights.py, Invites.py,
                Rankings.py, Inbox.py, HouseFights.py, DemoData.py + common, Accounts, Feedback, Admin, legal_server
assets/         icon.svg (a boxing glove) + generated PNG icons
tools/          sync_to_anvil.py (settings + table schema), deploy.py, check.py, preview/ (dev server, UI tests, screenshots), testing/
```
