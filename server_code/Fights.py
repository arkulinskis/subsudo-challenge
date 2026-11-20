"""Bouts. Side A records a round first (a member, the house, or the member who sent an invite link); the
bout arrives in side B's Mail as a call-out; B records an answer; the judges score it; ratings, records,
points and both mailboxes are updated (finish).

kind:   ranked (member vs member) | open (a call-out anyone may take; ranked once taken)
        | invite (a friend without an account, through a link) | house (an admin challenge from a house fighter)
status: pending (waiting for B) | open (waiting for anyone) | done | declined | cancelled | expired
Until B answers, A's score stays sealed: B only sees the rules and A's words.
"""
import datetime as dt
import hashlib
import secrets

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables
import anvil.tables.query as q

from . import common as C
from . import Boxing as B
from . import Fighters as F
from . import Inbox

KIND_LABELS = {"ranked": "Ranked bout", "open": "Open call-out", "invite": "Friend invite", "house": "House challenge"}
EXPIRE_DAYS = {"ranked": 7, "open": 7, "invite": 14, "house": 7}


# ------------------------------------------------------------------------------------------------ views
def _reveal(f, side, me):
    if f["status"] == "done" or C.is_admin(me):
        return True
    return side == "a" and me is not None and f["challenger"] == me


def _side(f, side, me, detail):
    r = f[side + "_round"]
    user = f["challenger"] if side == "a" else f["opponent"]
    if side == "a" and f["kind"] == "house":
        name = f["house_name"] or "The House"
    elif user is not None:
        name = F.ring_name(user)
    elif side == "b":
        name = f["guest_name"] or f["b_name"] or ("Anyone" if f["status"] == "open" else "Your friend")
    else:
        name = f["a_name"] or "Someone"
    out = {"name": name, "fighter": F.fighter(user, me) if user is not None else None,
           "house": side == "a" and f["kind"] == "house", "guest": side == "b" and f["kind"] == "invite" and user is None,
           "level": B.HOUSE_LEVEL_NAMES.get(f["house_level"]) if (side == "a" and f["kind"] == "house") else None,
           "words": f[side + "_words"] or "", "recorded": r is not None, "device": r["device"] if r is not None else None}
    if r is not None and _reveal(f, side, me):
        out["score"], out["stats"] = int(r["score"] or 0), r["stats"]
        out["ref"] = ref_view(r, gym=out["house"] or bool(r["is_demo"]))
        if detail:
            out["events"] = r["events"] or []
    if f["status"] == "done":
        out["rating_delta"] = f["rating_" + side]
        out["points"] = f["points_" + side]
    return out


def bout(f, me, detail=False):
    """A bout for the pages (lists use detail=False; the bout page also gets the punch logs)."""
    if f is None:
        return None
    my_side = "a" if (me is not None and f["challenger"] == me) else ("b" if (me is not None and f["opponent"] == me) else None)
    st = f["status"]
    can_take = (st == "open" and me is not None and f["challenger"] != me and _filter_ok(f, me))
    rules = f["rules"] or {}
    c = f["campaign"]
    out = {"id": f.get_id(), "kind": f["kind"], "kind_label": KIND_LABELS.get(f["kind"], "Bout"), "status": st,
           "created": C.iso(f["created"]), "expires": C.iso(f["expires"]), "finished": C.iso(f["finished"]),
           "secs": int(rules.get("secs") or 60), "a": _side(f, "a", me, detail), "b": _side(f, "b", me, detail),
           "my_side": my_side, "can_answer": (st == "pending" and my_side == "b") or can_take,
           "can_decline": st == "pending" and my_side == "b",
           "can_cancel": st in ("pending", "open") and my_side == "a",
           "can_words": st == "done" and my_side is not None,
           "city": (f["open_filter"] or {}).get("city") if st == "open" else None,
           "campaign": {"title": c["title"], "bonus": int(c["bonus"] or 0)} if c is not None else None,
           "demo": bool(f["is_demo"])}
    if st == "done":
        res = f["result"] or {}
        out["result"] = {"winner": f["winner"], "method": res.get("method"), "method_name": res.get("method_name"),
                         "cards": res.get("cards") or [], "ref": res.get("ref")}
        if my_side:
            out["outcome"] = "draw" if f["winner"] == "draw" else ("win" if f["winner"] == my_side else "loss")
    if my_side == "a" and f["kind"] == "invite":
        out["invite_token"] = f["invite_token"]
    return out


def _filter_ok(f, me):
    flt = f["open_filter"] or {}
    return not flt.get("city_key") or flt.get("city_key") == me["city_key"]


def ref_view(r, gym=False):
    """What the pages show of a round's Ref's report: {verdict, line, notes}. Rounds recorded before the ref joined
    (2026-11-20) have no report: the gym's own rounds read as clean, members' rounds say so."""
    rep = B.ref_of(r["stats"])
    if rep is None:
        if gym:
            return {"verdict": "clean", "line": "Ref: clean round", "notes": []}
        return {"verdict": "none", "line": "Ref: no report. This round was fought before the ref joined the gym.", "notes": []}
    return {"verdict": rep.get("verdict") or "clean", "line": rep.get("line") or B.ref_line(rep),
            "notes": rep.get("notes") or [], "dropped": int(rep.get("dropped") or 0), "retro": bool(rep.get("retro"))}


# ------------------------------------------------------------------------------------------------ helpers
def _round_row(rnd, user, side, who, is_demo=False):
    events, stats, score, flags = B.round_record(rnd)
    return app_tables.rounds.add_row(user=user, side=side, who=who, device=rnd["device"], secs=rnd["secs"], stats=stats,
                                     events=events, score=score, flags=flags, created=C.now(), is_demo=is_demo)


def _new_fight(kind, status, challenger, opponent, rnd, words, a_name, b_name, is_demo=False, **extra):
    a = _round_row(rnd, challenger, "a", a_name, is_demo) if rnd is not None else None
    f = app_tables.fights.add_row(kind=kind, status=status, challenger=challenger, opponent=opponent, a_name=a_name, b_name=b_name,
                                  rules={"secs": rnd["secs"] if rnd else extra.pop("secs", 60)}, a_round=a,
                                  a_words=C.text(words, 280), city_key=challenger["city_key"] if challenger is not None else None,
                                  created=C.now(), expires=C.now() + dt.timedelta(days=EXPIRE_DAYS[kind]), is_demo=is_demo, **extra)
    if a is not None:
        a["fight"] = f
    return f


def _level_for(rating):
    return "rookie" if rating < 950 else "club" if rating < 1100 else "pro" if rating < 1250 else "champ"


def _log_points(user, pts, reason, f):
    if user is None or not pts:
        return
    user["points"] = (user["points"] or 0) + pts
    app_tables.points_log.add_row(user=user, points=pts, reason=reason, fight=f, created=C.now(), is_demo=bool(f["is_demo"]))


def _outcome(winner, side):
    return "draw" if winner == "draw" else ("win" if winner == side else "loss")


def _side_name(f, side):
    """A side's name for public text (ring name, display name or the name a guest typed; never an email)."""
    user = f["challenger"] if side == "a" else f["opponent"]
    if side == "a" and f["kind"] == "house":
        return f["house_name"] or "The House"
    if user is not None:
        return public_name(user)
    return (f["guest_name"] or f["b_name"] or "A friend") if side == "b" else (f["a_name"] or "A fighter")


def public_name(u):
    """Ring name, else the display name they typed; never anything made from their email."""
    return (u["ring_name"] or u["display_name"] or "A Subsudo fighter") if u is not None else "A Subsudo fighter"


def _headline(f, side):
    """'You beat Kofi by knockout' / 'Kofi beat you on points' for one side's mailbox."""
    other = f["b_name"] if side == "a" else f["a_name"]
    if side == "b" and f["kind"] == "house":
        other = f["house_name"]
    if side == "a" and f["opponent"] is not None:
        other = F.ring_name(f["opponent"])
    if side == "b" and f["challenger"] is not None:
        other = F.ring_name(f["challenger"])
    res = f["result"] or {}
    how = {"ko": "by knockout", "tko": "by TKO", "ud": "by unanimous decision", "sd": "by split decision",
           "md": "by majority decision"}.get(res.get("method"), "")
    o = _outcome(f["winner"], side)
    if o == "draw":
        return "Draw with %s" % other
    return ("You beat %s %s" % (other, how)).strip() if o == "win" else ("%s beat you %s" % (other, how)).strip()


def finish(f, when=None):
    """Both rounds are in: judge, then update ratings, records, points, faces (bout damage) and mail.
    `when` is the time of the bout (demo data fights in the past); default now."""
    when = when or C.now()
    a_r, b_r = f["a_round"], f["b_round"]
    res = B.judge(a_r["stats"], b_r["stats"], a_r["score"] or 0, b_r["score"] or 0)
    ca, cb, kind, w = f["challenger"], f["opponent"], f["kind"], res["winner"]
    # The ref: a round under review doesn't count toward the rankings. Nobody's rating or record moves, the reviewed
    # side gets no points, and the clean side keeps its points (at least a draw's: it didn't lose to a real round).
    review = [s for s, r in (("a", a_r), ("b", b_r)) if not B.ref_counts(r["stats"])]
    if review:
        names = [_side_name(f, s) for s in review]
        res["ref"] = {"sides": review, "names": names, "unranked": True,
                      "line": "Ref's call: %s round%s under review, so this bout doesn't count toward the rankings."
                              % (" and ".join("%s's" % n for n in names), "s are" if len(names) > 1 else " is")}
    f.update(a_score=a_r["score"], b_score=b_r["score"], result=res, winner=res["winner"], status="done", finished=when)
    da = db = 0
    if kind in ("ranked", "open") and ca is not None and cb is not None:
        pa = B.points_for("ranked", _outcome(w, "a"), res["method"])
        pb = B.points_for("ranked", _outcome(w, "b"), res["method"])
        if not review:
            outcome_a = 1.0 if w == "a" else (0.5 if w == "draw" else 0.0)
            da, db = B.elo(F.rating_of(ca), F.rating_of(cb), outcome_a, ca["ranked_fights"], cb["ranked_fights"], res["method"])
            for u, d, side in ((ca, da, "a"), (cb, db, "b")):
                o = _outcome(w, side)
                u.update(rating=F.rating_of(u) + d, ranked_fights=(u["ranked_fights"] or 0) + 1,
                         wins=(u["wins"] or 0) + (o == "win"), losses=(u["losses"] or 0) + (o == "loss"),
                         draws=(u["draws"] or 0) + (o == "draw"),
                         kos=(u["kos"] or 0) + (o == "win" and res["method"] in ("ko", "tko")))
        else:
            pa = 0 if "a" in review else max(pa, B.POINTS["draw"])
            pb = 0 if "b" in review else max(pb, B.POINTS["draw"])
    elif kind == "house":
        pa, pb = 0, B.points_for("house", _outcome(w, "b"), res["method"])
        if w == "b" and f["campaign"] is not None:
            pb += int(f["campaign"]["bonus"] or 0)
        if "b" in review:
            pb = 0
    else:  # invite: the guest has no account (they can claim the bout later)
        pa, pb = B.points_for("guest", _outcome(w, "a"), res["method"]), 0
        if "a" in review:
            pa = 0
        elif "b" in review:
            pa = max(pa, B.POINTS["guest_draw"])
    f.update(rating_a=da, rating_b=db, points_a=pa, points_b=pb)
    for u, side, r in ((ca, "a", a_r), (cb, "b", b_r)):
        if u is None:
            continue
        st = r["stats"] or {}
        other = b_r if side == "a" else a_r
        o = _outcome(w, side)
        hurt = min(B.HURT_MAX, F.hurt_level_at(u, when) + B.damage(o, res["method"], (other["stats"] or {}).get("punches", 0)))
        u.update(hurt_level=round(hurt, 2), hurt_at=when, hurt_kind="ko" if (o == "loss" and res["method"] == "ko") else "")
        if side not in review:  # a round under review counts for nothing: no activity, best speed or punches
            u.update(last_fight=when, best_speed=max(u["best_speed"] or 0, st.get("top_speed", 0)),
                     total_punches=(u["total_punches"] or 0) + st.get("punches", 0))
        _log_points(u, pa if side == "a" else pb, KIND_LABELS.get(kind, "Bout") + ": " + _outcome(w, side), f)
        body = "Judges' scores are in. Open the bout to see the cards and the punch log."
        if review:
            body += " The ref put %s under review, so this bout doesn't count toward the rankings." % (
                "your round" if side in review and len(review) == 1 else "a round")
        Inbox.send(u, "result", _headline(f, side), body, f)


def sweep():
    """Bouts past their answer-by date become 'expired' (a no-show counts as a duck)."""
    now = C.now()
    for f in app_tables.fights.search(status=q.any_of("pending", "open")):
        if f["expires"] is not None and f["expires"] < now:
            f["status"] = "expired"
            if f["challenger"] is not None:
                Inbox.send(f["challenger"], "expired", "No answer from %s" % (f["b_name"] or "your opponent"),
                           "The bout expired before they fought back. Call out someone else!", f)
            if f["kind"] == "ranked" and f["opponent"] is not None:
                f["opponent"]["ducks"] = (f["opponent"]["ducks"] or 0) + 1


def _bot_answer(f, bot):
    """Demo fighters answer straight away with a round that fits their rating."""
    secs = int((f["rules"] or {}).get("secs") or 60)
    rnd = B.house_round(_level_for(F.rating_of(bot)), secs, seed=f.get_id(), device="phone")
    r = _round_row(rnd, bot, "b", F.ring_name(bot), bool(bot["is_demo"]))
    r["fight"] = f
    f["b_round"] = r
    finish(f)


def _need_card(me):
    if not me["ring_name"]:
        return "Set up your fighter card first (ring name and city), so opponents know who's calling."
    return None


# ------------------------------------------------------------------------------------------------ callables
@anvil.server.callable(require_user=True)
def create_challenge(opponent_id, rnd, words=""):
    """Call out a member: your recorded round goes into their Mail, sealed."""
    me = C.require_user()
    if _need_card(me):
        return C.fail(_need_card(me))
    opp = C.row_by_id(app_tables.users, opponent_id)
    if not F.active(opp):
        return C.fail("That fighter isn't taking bouts right now.")
    if opp == me:
        return C.fail("Shadow boxing is great training, but you can't call yourself out.")
    rnd, err = B.clean_round(rnd)
    if err:
        return C.fail(err)
    if C.rate_limited("challenge", 30, 3600):
        return C.fail("That's a lot of call-outs for one hour. Ice your hands and try again later.")
    open_between = [f for f in app_tables.fights.search(challenger=me, opponent=opp, status="pending")]
    if len(open_between) >= 3:
        return C.fail("You already have 3 bouts waiting for %s. Let them answer first." % F.ring_name(opp))
    f = _new_fight("ranked", "pending", me, opp, rnd, words, F.ring_name(me), F.ring_name(opp), is_demo=bool(opp["is_demo"]))
    Inbox.send(opp, "challenge", "%s called you out" % F.ring_name(me),
               f["a_words"] or "A %d-second round is waiting. Their score stays sealed until you fight back." % rnd["secs"], f)
    if opp["is_demo"]:
        _bot_answer(f, opp)
    return C.ok(bout=bout(f, me))


@anvil.server.callable(require_user=True)
def create_open_call(rnd, words="", city_only=False):
    """An open call-out: the first member who takes it fights your round."""
    me = C.require_user()
    if _need_card(me):
        return C.fail(_need_card(me))
    rnd, err = B.clean_round(rnd)
    if err:
        return C.fail(err)
    if city_only and not me["city_key"]:
        return C.fail("Add your city to your fighter card to post a call-out for your city.")
    if len(app_tables.fights.search(challenger=me, status="open")) >= 3:
        return C.fail("You already have 3 open call-outs. Wait for takers, or cancel one.")
    flt = {"city_key": me["city_key"], "city": me["city"]} if city_only else {}
    f = _new_fight("open", "open", me, None, rnd, words, F.ring_name(me), "", open_filter=flt)
    return C.ok(bout=bout(f, me))


@anvil.server.callable(require_user=True)
def create_invite(rnd, words="", friend_name=""):
    """A link for a friend without an account. Returns the token; the page builds the link."""
    me = C.require_user()
    if not (me["ring_name"] or me["display_name"]):  # a friend knows you by name: a ring name isn't needed for invites
        return C.fail(_need_card(me))
    rnd, err = B.clean_round(rnd)
    if err:
        return C.fail(err)
    if len(app_tables.fights.search(challenger=me, kind="invite", status="pending")) >= 10:
        return C.fail("You have 10 invites waiting already. Nudge your friends, or cancel some.")
    if C.rate_limited("invite", 20, 3600):
        return C.fail("That's a lot of invites for one hour. Try again later.")
    token = secrets.token_urlsafe(9)
    f = _new_fight("invite", "pending", me, None, rnd, words, F.ring_name(me), C.text(friend_name, 40), invite_token=token)
    return C.ok(bout=bout(f, me), token=token)


@anvil.server.callable(require_user=True)
def answer_bout(fight_id, rnd):
    """Fight back: record your answer to a call-out (or take an open call-out)."""
    me = C.require_user()
    f = C.row_by_id(app_tables.fights, fight_id)
    if f is None:
        return C.fail("That bout no longer exists.")
    if f["status"] == "open":
        if f["challenger"] == me:
            return C.fail("That's your own call-out. Wait for someone to take it.")
        if not _filter_ok(f, me):
            return C.fail("This call-out is for fighters from %s." % ((f["open_filter"] or {}).get("city") or "another city"))
        if _need_card(me):
            return C.fail(_need_card(me))
    elif f["status"] != "pending" or f["opponent"] != me:
        return C.fail("This bout is closed." if f["opponent"] == me else "That bout isn't yours to answer.")
    rnd, err = B.clean_round(rnd, (f["rules"] or {}).get("secs"))
    if err:
        return C.fail(err)
    if f["status"] == "open":
        f.update(opponent=me, b_name=F.ring_name(me), status="pending")
        if f["challenger"] is not None:
            Inbox.send(f["challenger"], "challenge", "%s took your open call-out" % F.ring_name(me), "", f)
    r = _round_row(rnd, me, "b", F.ring_name(me), bool(f["is_demo"]))
    r["fight"] = f
    f["b_round"] = r
    finish(f)
    return C.ok(bout=bout(f, me, detail=True))


@anvil.server.callable(require_user=True)
def decline_bout(fight_id):
    me = C.require_user()
    f = C.row_by_id(app_tables.fights, fight_id)
    if f is None or f["opponent"] != me or f["status"] != "pending":
        return C.fail("There's nothing to decline here.")
    f["status"] = "declined"
    if f["kind"] == "ranked":
        me["ducks"] = (me["ducks"] or 0) + 1
    if f["challenger"] is not None:
        Inbox.send(f["challenger"], "declined", "%s ducked your call-out" % F.ring_name(me), "Find a braver opponent on the Find page.", f)
    return C.ok(bout=bout(f, me))


@anvil.server.callable(require_user=True)
def cancel_bout(fight_id):
    me = C.require_user()
    f = C.row_by_id(app_tables.fights, fight_id)
    if f is None or f["challenger"] != me or f["status"] not in ("pending", "open"):
        return C.fail("Only a bout you started and that's still waiting can be cancelled.")
    f["status"] = "cancelled"
    return C.ok(bout=bout(f, me))


@anvil.server.callable(require_user=True)
def post_words(fight_id, words):
    """Post-fight words (respect, or a rematch call) after the result, shown on the bout page."""
    me = C.require_user()
    f = C.row_by_id(app_tables.fights, fight_id)
    if f is None or f["status"] != "done" or me not in (f["challenger"], f["opponent"]):
        return C.fail("You can only add words to a finished bout you fought in.")
    words = C.text(words, 280)
    if len(words) < 2:
        return C.fail("Say a little more than that.")
    side = "a" if f["challenger"] == me else "b"
    f[side + "_words"] = words
    other = f["opponent"] if side == "a" else f["challenger"]
    Inbox.send(other, "words", "%s had something to say" % F.ring_name(me), words, f)
    return C.ok(bout=bout(f, me, detail=True))


@anvil.server.callable(require_user=True)
def get_bout(fight_id):
    me = C.require_user()
    f = C.row_by_id(app_tables.fights, fight_id)
    if f is None:
        return C.fail("That bout no longer exists.")
    mine = me in (f["challenger"], f["opponent"])
    if not (mine or f["status"] in ("done", "open") or C.is_admin(me)):
        return C.fail("That bout is between other fighters.")
    for m in app_tables.messages.search(user=me, fight=f, read=False):
        m["read"] = True
    return C.ok(bout=bout(f, me, detail=True))


@anvil.server.callable(require_user=True)
def save_training(rnd):
    """Bag work: a round that isn't a bout. 1 point each, up to 5 a day."""
    me = C.require_user()
    rnd, err = B.clean_round(rnd, training=True)
    if err:
        return C.fail(err)
    if C.rate_limited("training", 60, 3600):
        return C.fail("That's a lot of rounds. Rest is training too.")
    prev = [p for p in app_tables.rounds.search(user=me, side="train") if not B.ref_review(p["stats"])]
    r = _round_row(rnd, me, "train", F.ring_name(me))
    st = r["stats"]
    counts = B.ref_counts(st)  # a round under review earns nothing and sets no bests
    today = C.now() - dt.timedelta(hours=24)
    given = sum(p["points"] or 0 for p in app_tables.points_log.search(user=me, reason="Bag work") if p["created"] >= today)
    pts = B.POINTS["training"] if (given < B.TRAINING_POINTS_PER_DAY and counts) else 0
    if pts:
        me["points"] = (me["points"] or 0) + pts
        app_tables.points_log.add_row(user=me, points=pts, reason="Bag work", fight=None, created=C.now(), is_demo=False)
    if counts:
        if rnd["device"] != "pads":  # taps aren't punches: pad rounds don't set your top speed
            me["best_speed"] = max(me["best_speed"] or 0, st["top_speed"])
        me["total_punches"] = (me["total_punches"] or 0) + st["punches"]
    best = max([p["score"] or 0 for p in prev] or [0])
    mine = r["score"] if counts else 0
    return C.ok(score=r["score"], stats=st, points=pts, personal_best=mine > best and bool(prev), best=max(best, mine),
                ref=ref_view(r), counts=counts, capped=counts and not pts)


# ------------------------------------------------------------------------------------------------ try a round (#try)
TRY_LEVELS = ("rookie", "club", "pro", "champ")


@anvil.server.callable
def try_round(rnd):
    """#try: one round with no account. Scored with the ref, then judged against the house at all four levels.
    Writes nothing: the browser keeps the round until the visitor signs up (Pages/Home then saves it as bag work)."""
    rnd, err = B.clean_round(rnd, training=True)
    if err:
        return C.fail(err)
    if C.rate_limited("try", 20, 3600):
        return C.fail("That's 20 try-out rounds this hour. Sign up free to keep training, or come back in a while.")
    events, stats, score, flags = B.round_record(rnd)
    counts = B.ref_counts(stats)
    house = []
    for level in TRY_LEVELS:
        h = B.house_round(level, rnd["secs"], seed="try-" + level)
        hs, hc = B.score_round(h["events"], rnd["secs"])
        j = B.judge(stats, hs, score, hc)
        house.append({"level": level, "name": B.HOUSE_LEVEL_NAMES[level], "score": hc, "winner": j["winner"],
                      "beat": counts and j["winner"] == "a", "draw": counts and j["winner"] == "draw",
                      "method": j["method_name"]})
    beaten = [x["name"] for x in house if x["beat"]]
    if not counts:
        verdict = "The ref put this round under review, so the house doesn't count it. Try again with real punches."
    elif not beaten:
        verdict = "The house wins this one. Rookie is %s points away: throw both hands and mix in hooks." % max(
            0, house[0]["score"] - score)
    elif len(beaten) == len(TRY_LEVELS):
        verdict = "You'd beat the house at every level, Champion included. The world board is waiting."
    else:
        verdict = "You'd beat the house at %s level." % beaten[-1]
    return C.ok(score=score, stats=stats, ref=stats["ref"], house=house, verdict=verdict, counts=counts,
                device=rnd["device"], secs=rnd["secs"])


# ------------------------------------------------------------------------------------------------ public bout pages
def public_bout(f):
    """bout(f, None, detail=True) for anyone with the link: finished bouts only, names only (never an email or a
    name made from one), no invite token."""
    b = bout(f, None, detail=True)
    for side in ("a", "b"):
        s = b[side]
        s["name"] = _side_name(f, side)
        if s.get("fighter"):
            s["fighter"]["ring"] = s["name"]
            s["fighter"].pop("name", None)
    b["public"] = True
    return b


def public_headline(f):
    """'Kofi beat Ana by knockout' (or 'Kofi and Ana fought to a draw') for link previews and the poster."""
    a, b = _side_name(f, "a"), _side_name(f, "b")
    res = f["result"] or {}
    how = {"ko": "by knockout", "tko": "by TKO", "ud": "by unanimous decision", "sd": "by split decision",
           "md": "by majority decision"}.get(res.get("method"), "on points")
    if f["winner"] == "draw":
        return "%s and %s fought to a draw" % (a, b)
    win, lose = (a, b) if f["winner"] == "a" else (b, a)
    return "%s beat %s %s" % (win, lose, how)


@anvil.server.callable
def get_public_bout(fight_id):
    """#bout/<id> for visitors without an account (shared posters and /b/<id> links): finished bouts only."""
    f = C.row_by_id(app_tables.fights, fight_id)
    if f is None or f["status"] != "done":
        return C.fail("Only finished bouts can be opened without an account.")
    return C.ok(bout=public_bout(f), headline=public_headline(f))


def guest_key_hash(key):
    return hashlib.sha256(("subsudo:" + str(key or "")).encode("utf-8")).hexdigest()
