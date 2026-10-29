"""Fighters: the public fighter card, the gym (home) page, editing your card, finding opponents, belts.

A fighter is a row of `users`. Public fields only leave the server through fighter() (never the email).
"""
import datetime as dt
import re
import unicodedata

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables
import anvil.tables.query as q

from . import common as C
from . import Boxing as B

STANCES = ("orthodox", "southpaw")
GLOVES = ("oxblood", "black", "brass", "royal", "white", "green")


def city_key(city, country):
    """'Montréal', 'CA' -> 'montreal-ca' (accents, case and spacing don't split a city)."""
    s = unicodedata.normalize("NFKD", city or "").encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip().replace(" ", "-")
    return (s + "-" + (country or "").lower()) if s else ""


def active(u):
    """Can fight and be shown. Demo fighters are disabled (nobody signs in as them) but active."""
    return u is not None and (bool(u["is_demo"]) or u["enabled"] is not False)


def ring_name(u):
    if u is None:
        return "Someone"
    return u["ring_name"] or C.name_of(u)


def rating_of(u):
    return int(u["rating"] if u["rating"] is not None else B.START_RATING)


def is_ranked(u, now=None):
    """Shown in the rankings: enough ranked bouts, fought recently, account active."""
    now = now or C.now()
    return ((u["ranked_fights"] or 0) >= B.PROVISIONAL_FIGHTS and u["last_fight"] is not None
            and (now - u["last_fight"]).days <= B.ACTIVE_DAYS and active(u))


def ranked_rows():
    now = C.now()
    rows = [u for u in app_tables.users.search(tables.order_by("rating", ascending=False)) if is_ranked(u, now)]
    rows.sort(key=lambda u: (-rating_of(u), -(u["wins"] or 0)))
    return rows


def belts(rows=None):
    """{user_id: ["World", "Montréal"]}: #1 in the world and #1 in each city."""
    rows = ranked_rows() if rows is None else rows
    out, seen = {}, set()
    if rows:
        out.setdefault(rows[0].get_id(), []).append("World")
    for u in rows:
        k = u["city_key"]
        if k and k not in seen:
            seen.add(k)
            out.setdefault(u.get_id(), []).append(u["city"] or "City")
    return out


def fighter(u, me=None, belt_map=None):
    if u is None:
        return None
    rating, n = rating_of(u), u["ranked_fights"] or 0
    return {"id": u.get_id(), "ring": ring_name(u), "name": C.name_of(u), "city": u["city"] or "", "country": u["country"] or "",
            "city_key": u["city_key"] or "", "stance": u["stance"] or "orthodox", "glove": u["glove"] or "oxblood",
            "bio": u["bio"] or "", "open": u["open_to_fights"] is not False, "rating": rating, "tier": B.tier(rating),
            "provisional": n < B.PROVISIONAL_FIGHTS, "fights": n, "points": int(u["points"] or 0),
            "record": {"w": int(u["wins"] or 0), "l": int(u["losses"] or 0), "d": int(u["draws"] or 0), "ko": int(u["kos"] or 0)},
            "ducks": int(u["ducks"] or 0), "best_speed": float(u["best_speed"] or 0), "punches": int(u["total_punches"] or 0),
            "demo": bool(u["is_demo"]), "me": me is not None and u == me,
            "belts": (belt_map or {}).get(u.get_id(), [])}


def _positions(me, rows):
    """(global rank, city rank) of `me` among ranked fighters, or None."""
    g = c = None
    ci = 0
    for i, u in enumerate(rows):
        if u["city_key"] and u["city_key"] == me["city_key"]:
            ci += 1
        if u == me:
            g = i + 1
            c = ci if me["city_key"] else None
    return g, c


@anvil.server.callable(require_user=True)
def get_gym():
    """Everything the gym (home) page needs, in one call."""
    from . import DemoData, Fights, HouseFights, Inbox
    DemoData.ensure_loaded()
    me = C.require_user()
    HouseFights.welcome(me)
    Fights.sweep()
    rows = ranked_rows()
    bm = belts(rows)
    g, c = _positions(me, rows)
    to_answer = [f for f in app_tables.fights.search(tables.order_by("created", ascending=False), opponent=me, status="pending")]
    waiting = [f for f in app_tables.fights.search(tables.order_by("created", ascending=False), challenger=me,
                                                   status=q.any_of("pending", "open"))]
    mine = list(app_tables.fights.search(tables.order_by("finished", ascending=False), challenger=me, status="done")) + \
        list(app_tables.fights.search(tables.order_by("finished", ascending=False), opponent=me, status="done"))
    mine.sort(key=lambda f: f["finished"] or f["created"], reverse=True)
    city_top = [u for u in rows if me["city_key"] and u["city_key"] == me["city_key"]][:5]
    my_r = rating_of(me)
    pool = [u for u in app_tables.users.search(open_to_fights=True) if u != me and active(u)]
    pool.sort(key=lambda u: (abs(rating_of(u) - my_r) - (60 if u["city_key"] != me["city_key"] else 0)))
    train = list(app_tables.rounds.search(tables.order_by("created", ascending=False), user=me, side="train"))
    return {"me": fighter(me, me, bm), "rank": {"global": g, "city": c, "ranked_total": len(rows)},
            "needs_card": not (me["ring_name"] and me["city"]),
            "to_answer": [Fights.bout(f, me) for f in to_answer[:12]],
            "waiting": [Fights.bout(f, me) for f in waiting[:12]],
            "recent": [Fights.bout(f, me) for f in mine[:6]],
            "city_top": [fighter(u, me, bm) for u in city_top],
            "suggested": [fighter(u, me, bm) for u in pool[:4]],
            "training": {"rounds": len(train), "best_score": max([r["score"] or 0 for r in train] or [0]),
                         "top_speed": max([(r["stats"] or {}).get("top_speed", 0) for r in train] or [0])},
            "unread": Inbox.unread(me)}


@anvil.server.callable(require_user=True)
def update_fighter(data):
    me = C.require_user()
    if not isinstance(data, dict):
        return C.fail("Nothing to save.")
    ring = C.text(data.get("ring_name"), 30)
    if len(ring) < 2:
        return C.fail("Your ring name needs at least 2 characters.")
    city = C.text(data.get("city"), 40)
    country = C.text(data.get("country"), 10).upper()
    if country and not re.fullmatch(r"[A-Z]{2}", country):
        return C.fail("Pick your country from the list.")
    if city and not country:
        return C.fail("Pick your country too, so your city ranks in the right place.")
    stance = data.get("stance") if data.get("stance") in STANCES else "orthodox"
    glove = data.get("glove") if data.get("glove") in GLOVES else "oxblood"
    me.update(ring_name=ring, city=city, country=country, city_key=city_key(city, country), stance=stance, glove=glove,
              bio=C.text(data.get("bio"), 160), open_to_fights=bool(data.get("open", True)))
    if me["rating"] is None:
        me["rating"] = B.START_RATING
    return C.ok(fighter=fighter(me, me))


@anvil.server.callable
def get_fighter(fighter_id):
    """A fighter's public page: card, belts, record, rating history, recent bouts, best numbers, badges."""
    from . import Fights
    me = C.me()
    u = C.row_by_id(app_tables.users, fighter_id)
    if u is None or (not active(u) and not C.is_admin(me)):
        return C.fail("That fighter has left the gym.")
    done = list(app_tables.fights.search(challenger=u, status="done")) + list(app_tables.fights.search(opponent=u, status="done"))
    done.sort(key=lambda f: f["finished"] or f["created"])
    history, r = [], None
    for f in done:
        if f["kind"] not in ("ranked", "open") or f["challenger"] is None or f["opponent"] is None:
            continue
        side = "a" if f["challenger"] == u else "b"
        delta = f["rating_a"] if side == "a" else f["rating_b"]
        history.append({"t": C.iso(f["finished"]), "delta": int(delta or 0)})
    # walk back from today's rating to draw the line
    r = rating_of(u)
    for h in reversed(history):
        h["rating"] = r
        r -= h["delta"]
    rounds = list(app_tables.rounds.search(user=u))
    best = {"score": max([x["score"] or 0 for x in rounds] or [0]),
            "speed": max([(x["stats"] or {}).get("top_speed", 0) for x in rounds] or [0]),
            "punches": max([(x["stats"] or {}).get("punches", 0) for x in rounds] or [0]),
            "blocks": max([(x["stats"] or {}).get("blocks", 0) for x in rounds] or [0])}
    countries = set()
    house_wins = 0
    for f in done:
        side = "a" if f["challenger"] == u else "b"
        other = f["opponent"] if side == "a" else f["challenger"]
        if other is not None and other["country"]:
            countries.add(other["country"])
        if f["kind"] == "house" and f["winner"] == side:
            house_wins += 1
    rows = ranked_rows()
    bm = belts(rows)
    card = fighter(u, me, bm)
    badges = []
    def badge(cond, key, name, how):
        badges.append({"key": key, "name": name, "how": how, "got": bool(cond)})
    badge(card["record"]["w"] >= 1, "first", "First blood", "Win a ranked bout")
    badge(card["record"]["ko"] >= 3, "ko", "KO artist", "3 knockouts")
    badge(best["speed"] >= 9, "speed", "Speed demon", "A punch over 9 m/s")
    badge(best["punches"] >= 120, "volume", "Volume puncher", "120 punches in one round")
    badge(best["blocks"] >= 40, "guard", "Iron guard", "40 blocks in one round")
    badge(len(countries) >= 3, "globe", "Globetrotter", "Fight people from 3 countries")
    badge(house_wins >= 3, "house", "House crusher", "Beat 3 house fighters")
    badge(len(done) >= 10, "road", "Road warrior", "10 bouts")
    badge(bool(card["belts"]), "belt", "Belt holder", "Be #1 in your city")
    g, c = _positions(u, rows)
    return C.ok(fighter=card, rank={"global": g, "city": c}, history=history[-30:], best=best, badges=badges,
                bouts=[Fights.bout(f, me) for f in reversed(done[-12:])],
                can_challenge=me is not None and me != u and active(u))


@anvil.server.callable(require_user=True)
def find_fighters(query=None, scope="world", open_only=True):
    """Opponents to call out (scope: world | city | near) plus the open call-outs anyone can take."""
    from . import DemoData, Fights
    DemoData.ensure_loaded()
    me = C.require_user()
    Fights.sweep()
    query = C.text(query, 60).lower()
    my_r = rating_of(me)
    rows = [u for u in app_tables.users.search() if u != me and active(u) and (u["ring_name"] or u["is_demo"])]
    if open_only:
        rows = [u for u in rows if u["open_to_fights"] is not False]
    if scope == "city":
        rows = [u for u in rows if me["city_key"] and u["city_key"] == me["city_key"]]
    if query:
        rows = [u for u in rows if query in ring_name(u).lower() or query in (u["city"] or "").lower()
                or query in C.name_of(u).lower()]
    if scope == "near":
        rows.sort(key=lambda u: abs(rating_of(u) - my_r))
    else:
        rows.sort(key=lambda u: (-(u["last_fight"] or dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc)).timestamp()))
    bm = belts()
    calls = [f for f in app_tables.fights.search(tables.order_by("created", ascending=False), status="open")
             if f["challenger"] != me]
    return {"fighters": [fighter(u, me, bm) for u in rows[:60]], "total": len(rows),
            "calls": [Fights.bout(f, me) for f in calls[:30]], "my_city": me["city"] or "", "has_city": bool(me["city_key"])}


@anvil.server.callable
def list_cities():
    """Cities with fighters (for the rankings picker), biggest first."""
    counts = {}
    for u in app_tables.users.search():
        if u["city_key"] and active(u):
            c = counts.setdefault(u["city_key"], {"key": u["city_key"], "city": u["city"], "country": u["country"] or "", "fighters": 0})
            c["fighters"] += 1
    return sorted(counts.values(), key=lambda c: (-c["fighters"], c["city"]))
