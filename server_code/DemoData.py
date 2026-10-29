"""Demo fighters, so the gym is never empty. Loaded automatically the first time anyone opens the app
(ensure_loaded), removed or reloaded from Admin -> Demo data. Removing it is remembered: it doesn't come back.

Demo fighters have is_demo=True and @example.com emails; they can't sign in (no password). They have real
records: DEMO_BOUTS bouts between them are fought by the same code as members' bouts (house_round makes
each round). They answer members' call-outs straight away. Every demo row is flagged is_demo=True, so
remove() deletes exactly what load() added (members' own rows stay).
"""
import datetime as dt
import random

from anvil.tables import app_tables

from . import common as C
from . import Boxing as B
from . import Fighters as F

# name, ring name, city, country, glove, stance, starting rating, bio
DEMO_FIGHTERS = [
    ("Kofi Mensah", "Lagos Lightning", "Lagos", "NG", "black", "orthodox", 1240, "Fast hands, faster mouth. Ask anyone on Victoria Island."),
    ("Mika Tanaka", "The Quiet Storm", "Tokyo", "JP", "white", "southpaw", 1310, "I don't talk before fights. Or after."),
    ("Lucia Ferreira", "Ferro", "São Paulo", "BR", "green", "orthodox", 1180, "Night shift nurse, morning shift puncher."),
    ("Dmitri Volkov", "Iron Volk", "Riga", "LV", "oxblood", "orthodox", 1120, "Old-school. Heavy bag in the garage since '09."),
    ("Siobhan Kelly", "Shamrock", "London", "GB", "royal", "orthodox", 1060, "Jab, jab, cross, cup of tea."),
    ("Marcus Reed", "Big Easy", "Montréal", "CA", "brass", "orthodox", 1150, "Plateau's finest. I fight anyone, anytime, any weather."),
    ("Élodie Gagnon", "La Faucheuse", "Montréal", "CA", "black", "southpaw", 1210, "Southpaw. Your jab is in the wrong place."),
    ("Jonah Park", "Jab Jab Park", "Montréal", "CA", "royal", "orthodox", 990, "Still learning. Still swinging."),
    ("Carlos Mendoza", "El Martillo", "Mexico City", "MX", "oxblood", "orthodox", 1270, "Body shots are a love language."),
    ("Priya Nair", "Monsoon", "Mumbai", "IN", "brass", "orthodox", 1090, "Calm, then sudden. Like the weather."),
    ("Tomasz Nowak", "The Pole Axe", "Berlin", "DE", "black", "orthodox", 1030, "Kreuzberg after midnight. Bring water."),
    ("Grace Okoro", "Okoro Express", "Lagos", "NG", "royal", "southpaw", 1140, "Kofi's training partner. Kofi's problem."),
    ("Liam Walker", "Kangaroo Court", "Melbourne", "AU", "green", "southpaw", 970, "The verdict is in: you're getting hit."),
    ("Rosa Dela Cruz", "Manila Thunder", "Manila", "PH", "oxblood", "orthodox", 1020, "Small gym, big right hand."),
]
DEMO_BOUTS = 46
OPEN_CALLS = [(0, "Anyone. Any city. 60 seconds. Let's go.", False), (6, "Montréal only. Prove you own this town.", True),
              (8, "Calling out the whole world. One round.", False)]
WORDS = ["Good fight. Rematch next week?", "Respect. Your left hand is no joke.", "Lucky night. I'll be back.",
         "That uppercut came from nowhere.", "See you at the top of the board."]
# Tables that hold demo rows (each has an is_demo column). Children before parents.
DEMO_TABLES = ["points_log", "messages", "rounds", "fights", "campaigns"]


def state():
    return C.get_setting("demo", "never")  # "never" | "loaded" | "removed"


def ensure_loaded():
    """Call from the app's main data callables: loads the demo once, unless an admin removed it."""
    if state() == "never":
        load()


def _round(user, level, secs, seed, when, side="a"):
    rnd = B.house_round(level, secs, seed=seed)
    stats, score = B.score_round(rnd["events"], secs)
    device = "camera" if sum(ord(ch) for ch in seed) % 3 == 0 else "phone"
    return app_tables.rounds.add_row(user=user, side=side, who=F.ring_name(user), device=device, secs=secs, stats=stats,
                                     events=rnd["events"], score=score, flags=[], created=when, is_demo=True)


def load():
    from . import Fights, HouseFights
    remove(remember=False)
    rng = random.Random(7)
    now = C.now()
    users = []
    for name, ring, city, country, glove, stance, rating, bio in DEMO_FIGHTERS:
        email = F.city_key(name, "").strip("-").replace("-", ".") + ".demo@example.com"
        u = app_tables.users.get(email=email) or app_tables.users.add_row(email=email, enabled=False)
        u.update(display_name=name, ring_name=ring, city=city, country=country, city_key=F.city_key(city, country), glove=glove,
                 stance=stance, bio=bio, open_to_fights=True, rating=rating, points=0, wins=0, losses=0, draws=0, kos=0,
                 ranked_fights=0, ducks=0, best_speed=0, total_punches=0, welcomed=True, is_demo=True,
                 signed_up=now - dt.timedelta(days=rng.randint(70, 200)), last_seen=now - dt.timedelta(hours=rng.randint(1, 90)))
        users.append(u)
    # a season of bouts between them, oldest first
    days = sorted([rng.uniform(1, 75) for _ in range(DEMO_BOUTS)], reverse=True)
    for i, ago in enumerate(days):
        a, b = rng.sample(users, 2)
        when = now - dt.timedelta(days=ago)
        secs = rng.choice(B.ROUND_SECS)
        ra = _round(a, Fights._level_for(F.rating_of(a) + rng.randint(-120, 120)), secs, "d%da" % i, when)
        rb = _round(b, Fights._level_for(F.rating_of(b) + rng.randint(-120, 120)), secs, "d%db" % i, when, side="b")
        f = app_tables.fights.add_row(kind="ranked", status="pending", challenger=a, opponent=b, a_name=F.ring_name(a),
                                      b_name=F.ring_name(b), rules={"secs": secs}, a_round=ra, b_round=rb,
                                      a_words=rng.choice(["", "You've been ducking me.", "One round. Your city or mine.", ""]),
                                      city_key=a["city_key"], created=when - dt.timedelta(hours=rng.randint(2, 40)),
                                      expires=when + dt.timedelta(days=7), is_demo=True)
        ra["fight"], rb["fight"] = f, f
        Fights.finish(f)
        f["finished"] = when
        if rng.random() < .35:
            f["b_words" if rng.random() < .5 else "a_words"] = rng.choice(WORDS)
        a["last_fight"], b["last_fight"] = when, when
        for p in app_tables.points_log.search(fight=f):
            p["created"] = when
    # open call-outs anyone can take
    for who, words, city_only in OPEN_CALLS:
        u = users[who]
        rnd = B.house_round(Fights._level_for(F.rating_of(u)), 60, seed="open%d" % who)
        rnd["device"] = "phone"
        flt = {"city_key": u["city_key"], "city": u["city"]} if city_only else {}
        f = Fights._new_fight("open", "open", u, None, rnd, words, F.ring_name(u), "", is_demo=True, open_filter=flt)
        f["created"] = now - dt.timedelta(hours=6 + who)
    # a house challenge the admin "sent" earlier, answered by some demo fighters
    c = app_tables.campaigns.add_row(title="Friday Fight Night", message="Big Dee is in the building. 60 seconds, no excuses.",
                                     house_name="Big Dee Marsh", house_level="pro", secs=60, bonus=20,
                                     audience={"type": "all"}, sent=6, status="active", created=now - dt.timedelta(days=3),
                                     expires=now + dt.timedelta(days=4), created_by=None, is_demo=True)
    house = HouseFights._house_round_row("Big Dee Marsh", "pro", 60, seed="friday")
    house["is_demo"] = True
    for j, u in enumerate(users[3:9]):
        f = HouseFights.house_fight(u, "Big Dee Marsh", "pro", 60, c["message"], campaign=c, a_round=house, days=4)
        rb = _round(u, Fights._level_for(F.rating_of(u) + 60), 60, "fri%d" % j, now - dt.timedelta(days=2), side="b")
        rb["fight"] = f
        f["b_round"] = rb
        Fights.finish(f)
        f["finished"] = now - dt.timedelta(days=2, hours=j)
        for p in app_tables.points_log.search(fight=f):
            p["created"] = f["finished"]
    C.set_setting("demo", "loaded")
    return counts()


def remove(remember=True):
    for name in DEMO_TABLES:
        for r in getattr(app_tables, name).search(is_demo=True):
            r.delete()
    for u in app_tables.users.search(is_demo=True):
        u.delete()
    if remember:
        C.set_setting("demo", "removed")
    return counts()


def counts():
    out = {"users": len(app_tables.users.search(is_demo=True))}
    for name in ("fights", "rounds", "campaigns"):
        out[name] = len(getattr(app_tables, name).search(is_demo=True))
    return out
