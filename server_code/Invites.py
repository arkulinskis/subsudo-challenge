"""Friend invites: a member sends a link (#invite/<token>); the friend fights back without an account.
The guest's browser keeps a random key, so if they sign up afterwards they can claim the bout."""
import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Boxing as B
from . import Fighters as F
from . import Fights


def _by_token(token):
    if not isinstance(token, str) or not (6 <= len(token) <= 40):
        return None
    return app_tables.fights.get(invite_token=token)


@anvil.server.callable
def get_invite(token):
    """What the invite page shows: who's calling you out, the rules, and the result once fought."""
    f = _by_token(token)
    if f is None or f["kind"] != "invite":
        return C.fail("This invite link doesn't work. Ask your friend for a new one.")
    if f["status"] in ("cancelled", "expired"):
        return C.fail("This invite has %s. Ask your friend for a new one." % ("been cancelled" if f["status"] == "cancelled" else "expired"))
    me = C.me()
    return C.ok(bout=Fights.bout(f, None, detail=f["status"] == "done"), challenger=F.fighter(f["challenger"]),
                claimed=f["opponent"] is not None, mine=me is not None and f["challenger"] == me)


@anvil.server.callable
def answer_invite(token, guest_name, rnd, guest_key):
    """The friend's answer. Anyone with the link can answer once."""
    f = _by_token(token)
    if f is None or f["kind"] != "invite":
        return C.fail("This invite link doesn't work. Ask your friend for a new one.")
    if f["status"] != "pending":
        return C.fail("This bout has already been fought." if f["status"] == "done" else "This invite is closed.")
    me = C.me()
    if me is not None and f["challenger"] == me:
        return C.fail("That's your own invite. Send the link to a friend.")
    name = C.text(guest_name, 40)
    if len(name) < 2:
        return C.fail("Tell your friend who you are: a name of at least 2 characters.")
    if C.rate_limited("guest_round", 8, 3600):
        return C.fail("Too many rounds from this browser in an hour. Try again later.")
    rnd, err = B.clean_round(rnd, (f["rules"] or {}).get("secs"))
    if err:
        return C.fail(err)
    r = app_tables.rounds.add_row(user=None, side="b", who=name, device=rnd["device"], secs=rnd["secs"], created=C.now(),
                                  events=rnd["events"], is_demo=False, fight=f)
    stats, score = B.score_round(rnd["events"], rnd["secs"])
    r.update(stats=stats, score=score, flags=B.round_flags(stats, rnd["secs"], rnd["events"]))
    f.update(guest_name=name, b_name=name, b_round=r, guest_key=Fights.guest_key_hash(guest_key) if guest_key else None)
    Fights.finish(f)
    return C.ok(bout=Fights.bout(f, None, detail=True))


@anvil.server.callable(require_user=True)
def claim_invite(token, guest_key):
    """After signing up: put the bout the guest fought on the new account's record (points, no rating)."""
    me = C.require_user()
    f = _by_token(token)
    if f is None or f["kind"] != "invite" or f["status"] != "done":
        return C.fail("There's no finished bout to claim on this link.")
    if f["opponent"] is not None:
        return C.ok(already=True)
    if f["challenger"] == me:
        return C.fail("You can't claim your own invite.")
    if not guest_key or f["guest_key"] != Fights.guest_key_hash(guest_key):
        return C.fail("This bout was fought on another device.")
    f["opponent"] = me
    if f["b_round"] is not None:
        f["b_round"]["user"] = me
    outcome = "draw" if f["winner"] == "draw" else ("win" if f["winner"] == "b" else "loss")
    pts = B.points_for("guest", outcome, (f["result"] or {}).get("method"))
    f["points_b"] = pts
    Fights._log_points(me, pts, "Claimed invite bout: " + outcome, f)
    me["last_fight"] = C.now()
    return C.ok(bout=Fights.bout(f, me), points=pts)
