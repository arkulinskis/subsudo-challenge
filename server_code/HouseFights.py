"""The house: fighters run by the gym, for members who have nobody to fight.

- welcome(): every new member finds a 30-second bout from Coach Bruno in their Mail (and, while the demo
  data is loaded, a call-out from a demo fighter).
- Admin -> Challenges: send a house challenge to many members at once (everyone, idle members, people who
  never fought, a city, or picked fighters), with a points bonus for beating the house.
- Admin -> Fight log: every bout, with both devices, scores, method and anything odd about a round.
"""
import datetime as dt

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import Boxing as B
from . import Fighters as F
from . import Fights
from . import Inbox

HOUSE_FIGHTERS = ["Coach Bruno", "The Heavy Bag", "Old Man Ferro", "Big Dee Marsh", "Lefty Navarro", "The Night Janitor"]
AUDIENCES = ("all", "idle", "never", "city", "picked")
BOT_TAUNTS = ["Saw your name on the board. Let's see if it belongs there.", "Long way from my gym to yours. My hands travel fine.",
              "One round. No excuses. Bring your guard.", "I hear you're quick. I'm quicker."]


def _house_round_row(name, level, secs, seed):
    rnd = B.house_round(level, secs, seed=seed)
    stats, score = B.score_round(rnd["events"], secs)
    return app_tables.rounds.add_row(user=None, side="a", who=name, device="house", secs=secs, stats=stats,
                                     events=rnd["events"], score=score, flags=[], created=C.now(), is_demo=False)


def house_fight(user, name, level, secs, words, campaign=None, a_round=None, days=7):
    a = a_round or _house_round_row(name, level, secs, seed="%s-%s" % (name, user.get_id()))
    f = app_tables.fights.add_row(kind="house", status="pending", challenger=None, opponent=user, a_name=name,
                                  b_name=F.ring_name(user), house_name=name, house_level=level, rules={"secs": secs},
                                  a_round=a, a_words=C.text(words, 280), city_key=user["city_key"], campaign=campaign,
                                  created=C.now(), expires=C.now() + dt.timedelta(days=days),
                                  is_demo=bool(campaign is not None and campaign["is_demo"]))
    if a["fight"] is None:
        a["fight"] = f
    return f


def welcome(me):
    """A first bout for every new member, so nobody starts with an empty corner."""
    if me["welcomed"] or me["is_demo"]:
        return
    me["welcomed"] = True
    if me["rating"] is None:
        me["rating"] = B.START_RATING
    f = house_fight(me, "Coach Bruno", "rookie", 30, "Welcome to the club. Thirty seconds, both hands. Show me what you've got.")
    Inbox.send(me, "house", "Coach Bruno wants to see your hands",
               "Your first bout: 30 seconds against the gym's coach. Beat him for %d points." % B.POINTS["house_win"], f)
    from . import DemoData
    if DemoData.state() == "loaded":
        bots = [u for u in app_tables.users.search(is_demo=True) if u["ring_name"]]
        if bots:
            bot = bots[sum(ord(ch) for ch in me.get_id()) % len(bots)]
            rnd = B.house_round(Fights._level_for(F.rating_of(bot)), 60, seed="welcome-" + me.get_id())
            rnd["device"] = "phone"
            g = Fights._new_fight("ranked", "pending", bot, me, rnd, BOT_TAUNTS[len(bots) % len(BOT_TAUNTS)],
                                  F.ring_name(bot), F.ring_name(me), is_demo=True)
            Inbox.send(me, "challenge", "%s called you out" % F.ring_name(bot), g["a_words"], g)


# ------------------------------------------------------------------------------------------------ admin
def _targets(aud):
    aud = aud if isinstance(aud, dict) else {}
    kind = aud.get("type") if aud.get("type") in AUDIENCES else "all"
    rows = [u for u in app_tables.users.search() if not u["is_demo"] and u["enabled"] is not False]
    if kind == "idle":
        try:
            days = max(1, min(365, int(aud.get("days") or 14)))
        except (TypeError, ValueError):
            days = 14
        since = C.now() - dt.timedelta(days=days)
        rows = [u for u in rows if u["last_fight"] is None or u["last_fight"] < since]
    elif kind == "never":
        rows = [u for u in rows if u["last_fight"] is None]
    elif kind == "city":
        rows = [u for u in rows if aud.get("city_key") and u["city_key"] == aud.get("city_key")]
    elif kind == "picked":
        ids = set(aud.get("ids") or [])
        rows = [u for u in rows if u.get_id() in ids]
    return rows


def _campaign(c):
    fights = list(app_tables.fights.search(campaign=c))
    done = [f for f in fights if f["status"] == "done"]
    return {"id": c.get_id(), "title": c["title"], "message": c["message"] or "", "house_name": c["house_name"],
            "level": B.HOUSE_LEVEL_NAMES.get(c["house_level"], c["house_level"]), "secs": int(c["secs"] or 60),
            "bonus": int(c["bonus"] or 0), "audience": c["audience"] or {}, "sent": len(fights), "answered": len(done),
            "house_wins": len([f for f in done if f["winner"] == "a"]), "status": c["status"],
            "created": C.iso(c["created"]), "expires": C.iso(c["expires"]), "demo": bool(c["is_demo"])}


@anvil.server.callable(require_user=True)
def admin_campaigns():
    C.require_admin()
    rows = app_tables.campaigns.search(tables.order_by("created", ascending=False))
    return {"campaigns": [_campaign(c) for c in rows[:100]], "house_fighters": HOUSE_FIGHTERS,
            "levels": [{"key": k, "name": B.HOUSE_LEVEL_NAMES[k], "ppm": v[0], "speed": v[1]} for k, v in B.HOUSE_LEVELS.items()],
            "cities": F.list_cities()}


@anvil.server.callable(require_user=True)
def admin_audience(aud):
    C.require_admin()
    rows = _targets(aud)
    return {"count": len(rows), "sample": [F.ring_name(u) for u in rows[:8]]}


@anvil.server.callable(require_user=True)
def admin_find_members(query):
    """For the 'picked fighters' audience: members by ring name, name or email (admins only)."""
    C.require_admin()
    query = C.text(query, 60).lower()
    if len(query) < 2:
        return {"members": []}
    rows = [u for u in app_tables.users.search() if not u["is_demo"] and (query in (u["email"] or "").lower()
            or query in F.ring_name(u).lower() or query in C.name_of(u).lower())]
    return {"members": [{"id": u.get_id(), "ring": F.ring_name(u), "email": u["email"], "city": u["city"] or ""} for u in rows[:20]]}


@anvil.server.callable(require_user=True)
def admin_send_campaign(data):
    me = C.require_admin()
    if not isinstance(data, dict):
        return C.fail("Fill in the challenge first.")
    title = C.text(data.get("title"), 80)
    name = C.text(data.get("house_name"), 40)
    level = data.get("level") if data.get("level") in B.HOUSE_LEVELS else None
    try:
        secs, bonus, days = int(data.get("secs") or 0), int(data.get("bonus") or 0), int(data.get("days") or 7)
    except (TypeError, ValueError):
        return C.fail("Round length, bonus and days must be numbers.")
    if len(title) < 3:
        return C.fail("Give the challenge a title (at least 3 characters).")
    if len(name) < 2:
        return C.fail("Pick or type the house fighter's name.")
    if level is None:
        return C.fail("Pick how hard the house fighter hits.")
    if secs not in B.ROUND_SECS:
        return C.fail("Rounds are 30, 60 or 90 seconds.")
    if not (0 <= bonus <= 200):
        return C.fail("The bonus is 0 to 200 points.")
    if not (1 <= days <= 30):
        return C.fail("Members get 1 to 30 days to answer.")
    targets = _targets(data.get("audience"))
    if not targets:
        return C.fail("Nobody matches that audience.")
    if len(targets) > 2000:
        return C.fail("That's more than 2000 members. Narrow the audience.")
    msg = C.text(data.get("message"), 400, multiline=True)
    c = app_tables.campaigns.add_row(title=title, message=msg, house_name=name, house_level=level, secs=secs, bonus=bonus,
                                     audience=data.get("audience") if isinstance(data.get("audience"), dict) else {"type": "all"},
                                     sent=len(targets), status="active", created=C.now(),
                                     expires=C.now() + dt.timedelta(days=days), created_by=me, is_demo=False)
    a = _house_round_row(name, level, secs, seed=c.get_id())
    for u in targets:
        f = house_fight(u, name, level, secs, msg or title, campaign=c, a_round=a, days=days)
        Inbox.send(u, "house", "%s: %s" % (name, title),
                   (msg + "\n\n" if msg else "") + ("Beat the house for %d bonus points." % bonus if bonus else ""), f)
    return C.ok(campaign=_campaign(c), sent=len(targets))


@anvil.server.callable(require_user=True)
def admin_cancel_campaign(campaign_id):
    C.require_admin()
    c = C.row_by_id(app_tables.campaigns, campaign_id)
    if c is None:
        return C.fail("That challenge no longer exists.")
    n = 0
    for f in app_tables.fights.search(campaign=c, status="pending"):
        f["status"] = "cancelled"
        n += 1
    c["status"] = "cancelled"
    return C.ok(campaign=_campaign(c), cancelled=n)


@anvil.server.callable(require_user=True)
def admin_fight_log(query=None, status=None, kind=None):
    """Every bout, newest first, for the Fight log tab (and its CSV download)."""
    C.require_admin()
    query = C.text(query, 60).lower()
    rows = app_tables.fights.search(tables.order_by("created", ascending=False))
    out = []
    for f in rows:
        if status and f["status"] != status:
            continue
        if kind and f["kind"] != kind:
            continue
        a, b = f["a_round"], f["b_round"]
        names = (f["a_name"] or "", f["b_name"] or "")
        if query and not any(query in n.lower() for n in names):
            continue
        res = f["result"] or {}
        out.append({"id": f.get_id(), "created": C.iso(f["created"]), "finished": C.iso(f["finished"]), "kind": f["kind"],
                    "status": f["status"], "a": names[0], "b": names[1] or ("(open)" if f["status"] == "open" else "(guest)"),
                    "a_device": a["device"] if a is not None else "", "b_device": b["device"] if b is not None else "",
                    "a_score": int(f["a_score"] or 0) if f["status"] == "done" else (int(a["score"] or 0) if a is not None else None),
                    "b_score": int(f["b_score"] or 0) if f["status"] == "done" else None,
                    "a_punches": (a["stats"] or {}).get("punches") if a is not None else None,
                    "b_punches": (b["stats"] or {}).get("punches") if b is not None else None,
                    "winner": f["winner"] or "", "method": res.get("method") or "",
                    "flags": ((a["flags"] or []) if a is not None else []) + ((b["flags"] or []) if b is not None else []),
                    "city": f["city_key"] or "", "demo": bool(f["is_demo"])})
        if len(out) >= 400:
            break
    rounds = len(app_tables.rounds.search())
    return {"fights": out, "total": len(out), "rounds": rounds}
