"""The rules of the sport, with no database: cleaning a recorded round, scoring it, the three judges,
the rating (Elo), tiers, points, and the rounds the house fighters "throw".

A round arrives from the browser as {device, secs, events}; events = [[t_ms, hand, type, speed], ...]
  hand: "L" | "R"     type: "s" straight (jab/cross) | "u" uppercut | "h" hook | "b" block
  speed: estimated fist speed in m/s (punches; blocks carry their speed too but it isn't scored)
The browser shows a live score with the same formula (web/pages/_ss_core.html SS.score); the server's
number is the one that counts.
"""
import random

ROUND_SECS = (30, 60, 90)
DEVICES = ("phone", "camera")
TYPES = ("s", "u", "h", "b")
TYPE_NAMES = {"s": "straight", "u": "uppercut", "h": "hook", "b": "block"}
TYPE_PTS = {"s": 1.0, "h": 1.2, "u": 1.3}
MAX_SPEED = 14.0
COMBO_GAP_MS = 700

START_RATING = 1000
PROVISIONAL_FIGHTS = 3       # ranked fights before you show up in the rankings
ACTIVE_DAYS = 120            # ...and you must have fought in this many days

TIERS = [(1350, "Champion"), (1200, "Contender"), (1050, "Club Fighter"), (900, "Sparring Partner"), (0, "Bag Puncher")]

POINTS = {"win": 25, "ko": 35, "draw": 12, "loss": 5,             # ranked bouts between members
          "house_win": 15, "house_draw": 8, "house_loss": 3,      # admin "house" challenges (+ the campaign bonus)
          "guest_win": 12, "guest_ko": 18, "guest_draw": 6, "guest_loss": 2,   # the inviter, against a guest
          "training": 1}
TRAINING_POINTS_PER_DAY = 5

HOUSE_LEVELS = {  # punches per minute, mean speed (m/s), block share
    "rookie": (55, 3.8, .18), "club": (85, 4.9, .22), "pro": (115, 6.0, .25), "champ": (145, 7.1, .28)}
HOUSE_LEVEL_NAMES = {"rookie": "Rookie", "club": "Club", "pro": "Pro", "champ": "Champion"}

JUDGES = [("Knuckles Moreau", "power"), ("Iron Mae Okafor", "volume"), ("Sal \"The Eye\" Russo", "craft")]


def tier(rating):
    for floor, name in TIERS:
        if (rating or 0) >= floor:
            return name
    return TIERS[-1][1]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ------------------------------------------------------------------------------------------------ rounds
def clean_round(rnd, secs=None, training=False):
    """Validate a round from the browser. Returns (round, None) or (None, "message").
    Pad rounds (tapping the screen) are allowed for training only."""
    if not isinstance(rnd, dict):
        return None, "That round didn't come through. Please record it again."
    device = rnd.get("device")
    if device not in DEVICES and not (training and device == "pads"):
        return None, "Record the round with your phone or your camera."
    try:
        rsecs = int(rnd.get("secs") or 0)
    except (TypeError, ValueError):
        rsecs = 0
    if rsecs not in ROUND_SECS:
        return None, "Rounds are 30, 60 or 90 seconds."
    if secs is not None and rsecs != int(secs):
        return None, "This bout is %d seconds a round. Record it again." % int(secs)
    raw = rnd.get("events")
    if not isinstance(raw, list):
        return None, "That round didn't come through. Please record it again."
    limit_ms = rsecs * 1000 + 15000  # the phone has a hand switch break in the middle
    events = []
    for e in raw[:2000]:
        if not isinstance(e, (list, tuple)) or len(e) < 4:
            continue
        try:
            t, hand, typ, speed = int(e[0]), str(e[1]), str(e[2]), float(e[3])
        except (TypeError, ValueError):
            continue
        if hand not in ("L", "R") or typ not in TYPES or t < 0 or t > limit_ms or speed != speed:
            continue
        events.append([t, hand, typ, round(clamp(speed, 0.0, MAX_SPEED), 2)])
    events.sort(key=lambda e: e[0])
    return {"device": device, "secs": rsecs, "events": events[:1200]}, None


def score_round(events, secs):
    """(stats, score). The judges and the rankings read the stats."""
    hands = {h: {"s": 0, "u": 0, "h": 0, "b": 0, "top": 0.0, "sum": 0.0} for h in ("L", "R")}
    punches = [e for e in events if e[2] != "b"]
    blocks = [e for e in events if e[2] == "b"]
    total = 0.0
    for t, hand, typ, speed in events:
        hs = hands[hand]
        hs[typ] += 1
        if typ != "b":
            hs["sum"] += speed
            hs["top"] = max(hs["top"], speed)
            total += TYPE_PTS[typ] * clamp(speed / 5.0, 0.5, 2.0)
    block_pts = 0.6 * min(len(blocks), max(10, len(punches)))
    combos, run, last = 0, 0, None
    for e in punches:
        run = run + 1 if last is not None and e[0] - last <= COMBO_GAP_MS else 1
        if run == 3:
            combos += 1
        last = e[0]
    nl = sum(hands["L"][k] for k in "suh")
    nr = sum(hands["R"][k] for k in "suh")
    n = nl + nr
    balanced = n >= 8 and min(nl, nr) >= 0.25 * n
    raw = (total + block_pts + 2 * combos) * (1.1 if balanced else 1.0)
    variety = len([k for k in "suh" if hands["L"][k] + hands["R"][k] > 0])
    speeds = [e[3] for e in punches]
    stats = {
        "punches": n, "blocks": len(blocks), "combos": combos, "balanced": balanced, "variety": variety,
        "straights": hands["L"]["s"] + hands["R"]["s"], "uppercuts": hands["L"]["u"] + hands["R"]["u"],
        "hooks": hands["L"]["h"] + hands["R"]["h"],
        "top_speed": round(max(speeds), 1) if speeds else 0.0,
        "avg_speed": round(sum(speeds) / len(speeds), 1) if speeds else 0.0,
        "per_min": round(n * 60.0 / secs, 1) if secs else 0.0,
        "power": round(sum(TYPE_PTS[e[2]] * e[3] for e in punches), 1),
        "hands": {h: {"punches": sum(v[k] for k in "suh"), "straights": v["s"], "uppercuts": v["u"], "hooks": v["h"],
                      "blocks": v["b"], "top_speed": round(v["top"], 1),
                      "avg_speed": round(v["sum"] / max(1, sum(v[k] for k in "suh")), 1)} for h, v in hands.items()},
    }
    return stats, int(round(raw * 10))


def round_flags(stats, secs, events):
    """Things an admin may want to look at (shown in Admin -> Fight log). They don't change the result."""
    flags = []
    if secs and stats["punches"] / float(secs) > 5:
        flags.append("very high punch rate")
    if stats["top_speed"] >= MAX_SPEED:
        flags.append("speed at the limit")
    if events and len(set(round(e[3], 1) for e in events)) <= 2 and len(events) > 20:
        flags.append("identical speeds")
    return flags


# ------------------------------------------------------------------------------------------------ judging
def _judge_metric(kind, s):
    if kind == "power":
        return s["power"] + 1.0 * s["blocks"]
    if kind == "volume":
        return s["punches"] + 2 * s["combos"] + 0.3 * s["blocks"]
    return 1.2 * s["blocks"] + 4 * s["variety"] + (6 if s["balanced"] else 0) + 0.4 * s["punches"] + s["combos"]


def judge(a_stats, b_stats, a_score, b_score):
    """Three judges score 10-9 (10-8 for a clear round, 10-10 when level). Majority decides; a lopsided
    score is a stoppage. Returns {cards, winner: a|b|draw, method, method_name}."""
    cards, wa, wb = [], 0, 0
    for name, kind in JUDGES:
        ma, mb = _judge_metric(kind, a_stats), _judge_metric(kind, b_stats)
        hi = max(ma, mb)
        if hi <= 0 or abs(ma - mb) <= 0.03 * hi:
            ca, cb = 10, 10
        else:
            lo = max(min(ma, mb), 0.001)
            clear = hi / lo >= 1.3
            ca, cb = (10, 8 if clear else 9) if ma > mb else (8 if clear else 9, 10)
            if ma > mb:
                wa += 1
            else:
                wb += 1
        cards.append({"judge": name, "looks_at": kind, "a": ca, "b": cb})
    if wa > wb and wa >= 2:
        winner = "a"
    elif wb > wa and wb >= 2:
        winner = "b"
    else:
        winner = "draw"
    method = "draw"
    if winner != "draw":
        hi, lo = (a_score, b_score) if winner == "a" else (b_score, a_score)
        losing_judges = wb if winner == "a" else wa
        if losing_judges == 0 and (lo <= 0 < hi or hi >= 2.5 * lo):
            method = "ko"
        elif losing_judges == 0 and hi >= 1.8 * lo:
            method = "tko"
        elif losing_judges == 0 and min(wa, wb) == 0 and max(wa, wb) == 3:
            method = "ud"
        elif losing_judges == 1:
            method = "sd"
        else:
            method = "md"
    return {"cards": cards, "winner": winner, "method": method, "method_name": METHOD_NAMES[method]}


METHOD_NAMES = {"ko": "Knockout", "tko": "Technical knockout", "ud": "Unanimous decision", "sd": "Split decision",
                "md": "Majority decision", "draw": "Draw"}


# ------------------------------------------------------------------------------------------------ rating + points
def elo(ra, rb, outcome_a, fights_a, fights_b, method):
    """New-rating deltas (da, db). outcome_a: 1 win, .5 draw, 0 loss."""
    ra, rb = ra or START_RATING, rb or START_RATING
    ea = 1.0 / (1 + 10 ** ((rb - ra) / 400.0))
    mult = {"ko": 1.25, "tko": 1.15, "sd": .8}.get(method, 1.0)
    ka = 40 if (fights_a or 0) < 5 else 28
    kb = 40 if (fights_b or 0) < 5 else 28
    da = ka * (outcome_a - ea) * mult
    db = kb * ((1 - outcome_a) - (1 - ea)) * mult
    return int(round(da)), int(round(db))


def points_for(kind, result_for_me, method):
    """Points for one side. kind: ranked | house | guest. result_for_me: win | loss | draw."""
    ko = method in ("ko", "tko")
    if kind == "house":
        return POINTS["house_" + result_for_me]
    if kind == "guest":
        return POINTS["guest_ko"] if (result_for_me == "win" and ko) else POINTS["guest_" + result_for_me]
    return POINTS["ko"] if (result_for_me == "win" and ko) else POINTS[result_for_me]


# ------------------------------------------------------------------------------------------------ house fighters
def house_round(level, secs, seed=None):
    """A believable round for a house fighter (or a demo fighter): {device, secs, events}."""
    ppm, mean_speed, block_share = HOUSE_LEVELS.get(level, HOUSE_LEVELS["club"])
    rnd = random.Random(seed)
    events, t, end = [], rnd.randint(300, 900), secs * 1000
    rate = ppm / 60.0
    while t < end:
        if rnd.random() < block_share:
            events.append([t, rnd.choice("LR"), "b", round(rnd.uniform(1.5, 3.5), 2)])
        else:
            r = rnd.random()
            typ = "s" if r < .62 else ("h" if r < .82 else "u")
            hand = "L" if (typ == "s" and rnd.random() < .55) else rnd.choice("LR")
            speed = clamp(rnd.gauss(mean_speed + (0.6 if typ != "s" else 0), 1.0), 1.5, 11.5)
            events.append([t, hand, typ, round(speed, 2)])
        # bursts: short gaps inside a combo, longer resets between
        gap = rnd.uniform(.22, .45) if rnd.random() < .6 else rnd.expovariate(rate) + .2
        t += int(gap * 1000)
    return {"device": "house", "secs": secs, "events": events}

