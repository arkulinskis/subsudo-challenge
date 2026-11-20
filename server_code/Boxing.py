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


HURT_MAX = 4.0
HURT_HOURS = 24


def damage(outcome, method, opponent_punches):
    """How much a bout marks your face (0..~3.6). Losing by knockout hurts most; even winners get bruised.
    The opponent's punch count adds a little. It heals in a straight line over HURT_HOURS."""
    if outcome == "loss":
        base = {"ko": 3.0, "tko": 2.4}.get(method, 1.6)
    elif outcome == "draw":
        base = 1.1
    else:
        base = 0.3 if method in ("ko", "tko") else 0.6
    return round(base + min(1.0, (opponent_punches or 0) / 150.0) * 0.6, 2)


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
    events = []
    for e in raw[:2000]:
        if not isinstance(e, (list, tuple)) or len(e) < 4:
            continue
        try:
            t, hand, typ, speed = int(e[0]), str(e[1]), str(e[2]), float(e[3])
        except (TypeError, ValueError):
            continue
        if hand not in ("L", "R") or typ not in TYPES or t < 0 or speed != speed:
            continue
        events.append([t, hand, typ, round(clamp(speed, 0.0, MAX_SPEED), 2)])
    events.sort(key=lambda e: e[0])
    out = {"device": device, "secs": rsecs, "events": events}
    kept, report = referee(out)  # the fair-fight referee: only what a real recorder can produce is scored
    out["events"], out["ref"] = kept[:1200], report
    return out, None


# ------------------------------------------------------------------------------------------------ the referee
# The recorders (theme/assets/ss-motion.js) can't produce some things: a fist back within 330 ms (phone) / 320 ms
# (camera) of its last punch, a speed over 13 m/s (both clamp there), a right hand in the phone's left half (the
# phone gives the right hand first, then the left; the timestamps leave out the 5-second switch), anything after the
# final bell. Real rounds never trip these rules, so whatever trips them was made some other way: it is dropped and
# the round is scored on what's left. Patterns no fist makes (a metronome, one speed all round, top speed on every
# punch) only add a note, and a note puts the round "under review": it's shown to everyone, but it doesn't count
# toward ratings, records, points or bests. Pads (training only) are tapped, so they get looser timing rules.
REF_GAP_MS = 280            # same hand again sooner than this: dropped (engines: 320-330 ms)
REF_PAD_GAP_MS = 90         # pads: a finger can drum fast, keyboard auto-repeat can't count
REF_MAX_SPEED = 13.0        # the engines clamp speeds to 13 m/s
REF_PAD_MAX_SPEED = 6.0     # the pads make 3.2-5.8 m/s
REF_SWITCH_SLACK_MS = 200   # phone: how far a hand may stray past the half-way switch
REF_BELL_SLACK_MS = 500     # after the final bell
REF_STEADY_MIN = 20         # punches before "machine-like timing" is judged
REF_STEADY_CV = 0.05        # gaps that vary less than 5% are a metronome, not a fighter
REF_LIMIT_SHARE = 0.6       # this share of punches at the speed limit = a shaken phone or a script
REF_MAX_RATE = 5.0          # punches a second over the whole round (camera max is ~6; fighters stay well under)
REF_REVIEW_SHARE = 0.2      # more than this share dropped (and at least 5): under review
REF_REASONS = {"fast": "faster than a fist can come back", "speed": "faster than the sensors can measure",
               "hand": "with the wrong hand for that half of the round", "late": "after the final bell"}
REF_ORDER = ("fast", "speed", "hand", "late")


def _cv(values):
    if len(values) < 2:
        return 1.0
    mean = sum(values) / float(len(values))
    if mean <= 0:
        return 0.0
    var = sum((v - mean) ** 2 for v in values) / float(len(values))
    return (var ** 0.5) / mean


def _steady(punches):
    """True when the gaps between punches (all of them, or one hand's) vary less than REF_STEADY_CV."""
    groups = [punches] + [[e for e in punches if e[1] == h] for h in ("L", "R")]
    for g in groups:
        if len(g) >= REF_STEADY_MIN:
            gaps = [b[0] - a[0] for a, b in zip(g, g[1:])]
            if _cv(gaps) < REF_STEADY_CV:
                return True
    return False


def _moves(n_punch, n_block):
    if n_block and not n_punch:
        return "%d block%s" % (n_block, "" if n_block == 1 else "s")
    if n_punch and not n_block:
        return "%d punch%s" % (n_punch, "" if n_punch == 1 else "es")
    return "%d moves" % (n_punch + n_block)


def ref_line(report):
    """The sentence under the judges' cards: 'Ref: clean round' / 'Ref took away 14 punches thrown faster ...'."""
    took = [r for r in report.get("reasons") or [] if r.get("n")]
    retro = bool(report.get("retro"))
    lead = "Ref (checked after the bout)" if retro else "Ref"
    parts = []
    if took:
        bits = ["%s thrown %s" % (_moves(r.get("punches", 0), r.get("blocks", 0)), r["text"]) for r in took]
        verb = " would have taken away " if retro else " took away "
        parts.append(lead + verb + " and ".join(bits) + ".")
    if report.get("verdict") == "review":
        why = ", ".join(report.get("notes") or []) or "an unusual round"
        parts.append(("Under review: %s." if took else lead + ": under review, %s.") % why)
        parts.append("The result stands." if retro else "This round doesn't count toward the rankings.")
    elif not took:
        parts.append(lead + ": clean round" + ("." if retro else ""))
    elif retro:
        parts.append("The result stands.")
    return " ".join(parts)


def referee(rnd):
    """(kept events, report). report = {v, verdict: clean|adjusted|review, counts, kept, dropped, reasons, notes, line};
    it's stored as stats["ref"] (stats is an obj column: no schema change)."""
    device, secs = rnd.get("device"), int(rnd.get("secs") or 0)
    events = sorted([list(e) for e in rnd.get("events") or []], key=lambda e: e[0])
    pads = device == "pads"
    gap = REF_PAD_GAP_MS if pads else REF_GAP_MS
    top = REF_PAD_MAX_SPEED if pads else REF_MAX_SPEED
    half, end = secs * 500, secs * 1000 + REF_BELL_SLACK_MS
    last: dict = {"L": None, "R": None}
    tally = {k: [0, 0] for k in REF_ORDER}  # [punches, blocks]
    kept = []
    for e in events:
        t, hand, typ, speed = e[0], e[1], e[2], e[3]
        why = None
        if t > end:
            why = "late"
        elif device == "phone" and ((hand == "R" and t > half + REF_SWITCH_SLACK_MS) or (hand == "L" and t < half - REF_SWITCH_SLACK_MS)):
            why = "hand"
        elif speed > top:
            why = "speed"
        elif last[hand] is not None and t - last[hand] < gap:
            why = "fast"
        if why:
            tally[why][1 if typ == "b" else 0] += 1
            continue
        kept.append(e)
        last[hand] = t
    dropped = len(events) - len(kept)
    reasons = [{"key": k, "n": sum(tally[k]), "punches": tally[k][0], "blocks": tally[k][1], "text": REF_REASONS[k]}
               for k in REF_ORDER if sum(tally[k])]
    punches = [e for e in kept if e[2] != "b"]
    notes = []
    if _steady(punches):
        notes.append("machine-like timing")
    if len(kept) > 20 and len(set(round(e[3], 1) for e in kept)) <= 2:
        notes.append("identical speeds")
    if len(punches) >= REF_STEADY_MIN and len([e for e in punches if e[3] >= REF_MAX_SPEED - 0.1]) >= REF_LIMIT_SHARE * len(punches):
        notes.append("fists at the speed limit all round")
    if secs and len(punches) / float(secs) > REF_MAX_RATE:
        notes.append("a punch rate no fighter keeps up")
    if dropped >= 5 and dropped > REF_REVIEW_SHARE * len(events):
        notes.append("most of it couldn't come from a real recorder" if dropped > 0.5 * len(events)
                     else "too many impossible punches")
    verdict = "review" if notes else ("adjusted" if dropped else "clean")
    report: dict = {"v": 1, "verdict": verdict, "counts": verdict != "review", "kept": len(kept), "dropped": dropped,
                    "reasons": reasons, "notes": notes}
    report["line"] = ref_line(report)
    return kept, report


def round_record(rnd):
    """(events, stats, score, flags) for a round to store. Browser rounds were refereed in clean_round (rnd["ref"]);
    the gym's own rounds (house, demo, bots) go through the referee here, so every round carries a report."""
    if isinstance(rnd.get("ref"), dict):
        events, report = rnd["events"], rnd["ref"]
    else:
        events, report = referee(rnd)
    stats, score = score_round(events, rnd["secs"])
    stats["ref"] = report
    flags = round_flags(stats, rnd["secs"], events) + (["under review"] if report.get("verdict") == "review" else [])
    return events, stats, score, flags


def ref_of(stats):
    r = (stats or {}).get("ref")
    return r if isinstance(r, dict) else None


def ref_counts(stats):
    """Does this round count toward ratings, records, points and bests? Rounds from before the ref always do."""
    r = ref_of(stats)
    return True if r is None or r.get("retro") else bool(r.get("counts", True))


def ref_review(stats):
    """Under review (now, or when an admin ran the ref over older rounds)."""
    r = ref_of(stats)
    return bool(r and r.get("verdict") == "review")


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
HOUSE_GAP_MS = 340  # a house fist comes back no faster than a real recorder allows (the ref checks 280 ms)


def house_round(level, secs, seed=None, device="house"):
    """A believable round for a house fighter (or a demo fighter): {device, secs, events}. It obeys the same physics
    the referee checks: each fist needs HOUSE_GAP_MS to come back; device "phone" throws the right hand in the first
    half and the left in the second (like the phone recorder); "pads" taps at pad speeds."""
    ppm, mean_speed, block_share = HOUSE_LEVELS.get(level, HOUSE_LEVELS["club"])
    rnd = random.Random(seed)
    events, t, end = [], rnd.randint(300, 900), secs * 1000
    rate = ppm / 60.0
    last = {"L": -10 ** 6, "R": -10 ** 6}
    while t < end:
        block = rnd.random() < block_share
        r = rnd.random()
        typ = "b" if block else ("s" if r < .62 else ("h" if r < .82 else "u"))
        if device == "phone":
            hand = "R" if t < secs * 500 else "L"
            t = max(t, last[hand] + HOUSE_GAP_MS)
            if hand == "R" and t >= secs * 500:
                hand = "L"
                t = max(t, last["L"] + HOUSE_GAP_MS)
        else:
            hand = "L" if (typ == "s" and rnd.random() < .55) else rnd.choice("LR")
            if t - last[hand] < HOUSE_GAP_MS:
                other = "L" if hand == "R" else "R"
                if t - last[other] >= HOUSE_GAP_MS:
                    hand = other
                else:
                    hand = min(last, key=lambda k: last[k])
                    t = last[hand] + HOUSE_GAP_MS
        if t >= end:
            break
        if block:
            speed = rnd.uniform(1.5, 3.5)
        elif device == "pads":
            speed = rnd.uniform(3.2, 5.8)
        else:
            speed = clamp(rnd.gauss(mean_speed + (0.6 if typ != "s" else 0), 1.0), 1.5, 11.5)
        events.append([t, hand, typ, round(speed, 2)])
        last[hand] = t
        # bursts: short gaps inside a combo, longer resets between
        gap = rnd.uniform(.22, .45) if rnd.random() < .6 else rnd.expovariate(rate) + .2
        t += int(gap * 1000)
    return {"device": device, "secs": secs, "events": events}

