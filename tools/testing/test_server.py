"""Server tests against the strict mock of Anvil (tools/testing/mock).

    python tools/testing/test_server.py          -> prints ALL OK, or the first failure

call(name, ...) runs a server function the way the browser does: by name, with require_user enforced,
and the reply must be JSON (a datetime or a row in a reply fails here, like it would break the page).
Add tests for every new server function: the happy path, bad input, and someone who isn't allowed.
"""
import datetime as dt
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
_tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(PROJECT / "server_code", _tmp / "app")
(_tmp / "app" / "__init__.py").write_text("")
os.environ["ANVIL_APP_YAML"] = str(PROJECT / "anvil.yaml")  # the mock's tables follow the app's own schema
sys.path[:0] = [str(HERE / "mock"), str(_tmp)]
import anvil.server  # noqa: E402
import anvil.users  # noqa: E402
from anvil.tables import app_tables as T  # noqa: E402

M = {p.stem: importlib.import_module("app." + p.stem) for p in sorted((PROJECT / "server_code").glob("*.py"))}
now = dt.datetime.now(dt.timezone.utc)


def call(name, *args):
    r = anvil.server.call(name, *args)
    json.dumps(r)  # strict: must be JSON-able
    return r


def as_user(row):
    anvil.users.CURRENT[0] = row
    anvil.server.session.use(row.get_id() if row is not None else None)


def denied(name, *args):
    try:
        call(name, *args)
    except anvil.server.PermissionDenied:
        return True
    return False


def ok(r, msg=""):
    assert isinstance(r, dict) and r.get("ok"), (msg, r)
    return r


def bad(r, msg=""):
    assert isinstance(r, dict) and r.get("ok") is False and r.get("error"), (msg, r)
    return r


def person(email, name=None, **kw):
    return T.users.add_row(email=email, enabled=True, signed_up=now, display_name=name, **kw)


# ---------------------------------------------------------------------------------- accounts
admin = person("arkulinskis@gmail.com", "The Admin")
ana = person("ana@example.com", "Ana")
bob = person("bob@example.com")

as_user(None)
assert call("get_me") is None
assert denied("update_profile", "X")
as_user(admin)
assert call("get_me")["is_admin"] is True, "ADMIN_EMAILS become admins on first sign-in"
as_user(ana)
me = call("get_me")
assert me["name"] == "Ana" and me["is_admin"] is False
assert ana["last_seen"] is not None
as_user(bob)
assert call("get_me")["name"] == "Bob", "a name comes from the email when none is set"
bad(call("update_profile", " x "))
assert ok(call("update_profile", "  Bob   Stone "))["me"]["name"] == "Bob Stone"

# ---------------------------------------------------------------------------------- feedback
as_user(None)
bad(call("submit_feedback", "bug", "hi"))
ok(call("submit_feedback", "bug", "The button is broken", "guest@example.com", {"page": "#home", "evil": "x" * 9999}))
fb = T.feedback.search()[0]
assert fb["name"] == "Guest" and fb["email"] == "guest@example.com" and "evil" not in fb["context"] and fb["status"] == "new"
for i in range(4):
    ok(call("submit_feedback", "idea", "Idea number %d" % i))
bad(call("submit_feedback", "idea", "One too many this hour"), "rate limit")
as_user(ana)
ok(call("submit_feedback", "nonsense-kind", "Signed-in feedback"))
assert T.feedback.get(message="Signed-in feedback")["kind"] == "other"
assert denied("list_feedback")
as_user(admin)
lst = call("list_feedback")
assert lst["counts"]["new"] == 6 and len(lst["items"]) == 6
fid = lst["items"][0]["id"]
ok(call("set_feedback_status", fid, "done", "Fixed it"))
assert call("list_feedback", "done")["items"][0]["note"] == "Fixed it"
bad(call("set_feedback_status", fid, "weird"))
bad(call("set_feedback_status", "nope", "done"))
ok(call("delete_feedback", fid))
assert len(call("list_feedback")["items"]) == 5

# ---------------------------------------------------------------------------------- admin
as_user(ana)
for fn, args in [("admin_overview", ()), ("list_users", ()), ("set_admin", (bob.get_id(), True)), ("demo_load", ()), ("demo_remove", ())]:
    assert denied(fn, *args), fn
as_user(admin)
ov = call("admin_overview")
assert ov["users"] == 3 and ov["admins"] == 1 and ov["feedback_new"] == 5
assert len(call("list_users")["users"]) == 3 and len(call("list_users", "bob")["users"]) == 1
ok(call("set_admin", bob.get_id(), True))
assert bob["is_admin"] is True
bad(call("set_admin", admin.get_id(), False), "can't remove your own admin")
ok(call("set_enabled", bob.get_id(), False))
assert bob["enabled"] is False
bad(call("set_enabled", admin.get_id(), False))
ok(call("set_enabled", bob.get_id(), True))
ok(call("set_admin", bob.get_id(), False))
assert bob["is_admin"] is False

# ---------------------------------------------------------------------------------- Subsudo: the sport itself
Bx = M["Boxing"]
r, err = Bx.clean_round({"device": "phone", "secs": 30, "events": [[100, "R", "s", 6], [50, "L", "u", 99], [70, "X", "s", 3],
                                                                   "junk", [999999, "L", "s", 4], [120, "L", "b", 2]]})
assert err is None and [e[0] for e in r["events"]] == [50, 100, 120], "sorted, junk + out-of-time dropped"
assert r["events"][0][3] == Bx.MAX_SPEED, "speeds are capped"
assert Bx.clean_round({"device": "toaster", "secs": 30, "events": []})[1]
assert Bx.clean_round({"device": "phone", "secs": 45, "events": []})[1]
assert Bx.clean_round({"device": "phone", "secs": 30, "events": []}, 60)[1], "must match the bout's round length"
st, sc = Bx.score_round([[0, "L", "s", 5], [300, "R", "s", 5], [600, "L", "h", 5], [5000, "R", "b", 2]], 30)
assert st["punches"] == 3 and st["combos"] == 1 and st["blocks"] == 1 and sc > 0
assert st["hands"]["L"]["punches"] == 2 and st["hands"]["R"]["blocks"] == 1
strong = Bx.house_round("champ", 60, seed=1)
weak = Bx.house_round("rookie", 60, seed=1)
s1, c1 = Bx.score_round(strong["events"], 60)
s2, c2 = Bx.score_round(weak["events"], 60)
assert c1 > c2, "the champion out-scores the rookie"
j = Bx.judge(s1, s2, c1, c2)
assert j["winner"] == "a" and len(j["cards"]) == 3
assert Bx.judge(s1, s1, c1, c1)["winner"] == "draw"
empty, c0 = Bx.score_round([], 60)
assert Bx.judge(s1, empty, c1, c0)["method"] == "ko", "nothing thrown = knockout"
da, db = Bx.elo(1000, 1000, 1.0, 10, 10, "ud")
assert da > 0 and db < 0 and da == -db
assert Bx.elo(1400, 1000, 1.0, 10, 10, "ud")[0] < da, "beating a weaker fighter earns less"
assert Bx.tier(1360) == "Champion" and Bx.tier(800) == "Bag Puncher"


def rnd(level="club", secs=60, seed=3, device="phone"):
    x = Bx.house_round(level, secs, seed=seed)
    x["device"] = device
    return x


# ---------------------------------------------------------------------------------- the gym, fighter cards, demo data
as_user(None)
assert denied("get_gym")
as_user(ana)
gym = call("get_gym")
assert M["DemoData"].state() == "loaded", "demo loads on first visit"
assert gym["needs_card"] is True and gym["me"]["rating"] == 1000
houses = [b for b in gym["to_answer"] if b["kind"] == "house"]
assert len(houses) == 1 and houses[0]["a"]["name"] == "Coach Bruno", "new members get a welcome bout"
assert "score" not in houses[0]["a"], "the other side's score is sealed until you answer"
assert len(gym["to_answer"]) == 2, "...and a call-out from a demo fighter"
assert len(call("get_gym")["to_answer"]) == 2, "welcome happens once"
assert call("unread_count")["total"] >= 2
bad(call("create_challenge", bob.get_id(), rnd()), "a fighter card is needed first")
bad(call("update_fighter", {"ring_name": "A"}))
bad(call("update_fighter", {"ring_name": "The Hammer", "city": "Montreal"}), "city needs a country")
bad(call("update_fighter", {"ring_name": "The Hammer", "city": "Montreal", "country": "Canada"}))
card = ok(call("update_fighter", {"ring_name": "The Hammer", "city": "Montréal", "country": "ca", "stance": "southpaw",
                                  "glove": "brass", "bio": "Hi", "open": True}))["fighter"]
assert card["city_key"] == "montreal-ca" and card["stance"] == "southpaw" and card["glove"] == "brass" and "email" not in card
assert ana["city_key"] == M["Fighters"].city_key("MONTREAL ", "CA"), "accents and case don't split a city"
as_user(bob)
call("get_gym")
ok(call("update_fighter", {"ring_name": "Bobcat", "city": "Berlin", "country": "DE"}))

# ---------------------------------------------------------------------------------- a ranked bout: call-out, sealed score, answer, result
as_user(ana)
bad(call("create_challenge", ana.get_id(), rnd()), "can't fight yourself")
bad(call("create_challenge", "nope", rnd()))
bad(call("create_challenge", bob.get_id(), {"device": "phone", "secs": 61, "events": []}))
b1 = ok(call("create_challenge", bob.get_id(), rnd("pro", seed=11), "See you in Berlin"))["bout"]
assert b1["status"] == "pending" and b1["my_side"] == "a" and "score" in b1["a"], "you see your own score"
as_user(bob)
inbox = call("get_inbox")
assert any(m["kind"] == "challenge" and "The Hammer" in m["title"] for m in inbox["messages"])
seen = ok(call("get_bout", b1["id"]))["bout"]
assert seen["can_answer"] and "score" not in seen["a"], "sealed for the opponent"
bad(call("answer_bout", b1["id"], {"device": "phone", "secs": 30, "events": []}), "wrong round length")
done = ok(call("answer_bout", b1["id"], rnd("rookie", seed=12)))["bout"]
assert done["status"] == "done" and done["result"]["winner"] == "a" and done["outcome"] == "loss"
assert len(done["result"]["cards"]) == 3 and "events" in done["a"] and "events" in done["b"]
assert ana["rating"] > 1000 and bob["rating"] < 1000 and ana["wins"] == 1 and bob["losses"] == 1
assert ana["ranked_fights"] == 1 and ana["points"] >= Bx.POINTS["win"]
bad(call("answer_bout", b1["id"], rnd(seed=12)), "can't answer twice")
ok(call("post_words", b1["id"], "Rematch. Soon."))
bad(call("post_words", b1["id"], "x"))
as_user(admin)
bad(call("post_words", b1["id"], "Not my bout"))
assert ok(call("get_bout", b1["id"]))["bout"]["b"]["words"] == "Rematch. Soon.", "admins can look at any bout"
as_user(None)
assert denied("get_bout", b1["id"])

# decline + cancel
as_user(ana)
b2 = ok(call("create_challenge", bob.get_id(), rnd(seed=13)))["bout"]
b3 = ok(call("create_challenge", bob.get_id(), rnd(seed=14)))["bout"]
bad(call("decline_bout", b2["id"]), "the challenger can't decline")
as_user(bob)
bad(call("cancel_bout", b3["id"]), "only the challenger cancels")
ok(call("decline_bout", b2["id"]))
assert bob["ducks"] == 1
as_user(ana)
ok(call("cancel_bout", b3["id"]))
bad(call("cancel_bout", b3["id"]))
as_user(bob)
bad(call("answer_bout", b3["id"], rnd(seed=1)), "cancelled bouts are closed")
as_user(cat := person("cat@example.com", "Cat"))
bad(call("get_bout", b2["id"]), "declined bouts stay between the two")

# demo fighters answer straight away
as_user(ana)
bot = T.users.search(is_demo=True)[0]
bb = ok(call("create_challenge", bot.get_id(), rnd(seed=21)))["bout"]
assert bb["status"] == "done", "demo fighters answer at once"

# answering the welcome bout from the house
house = [b for b in call("get_gym")["to_answer"] if b["kind"] == "house"][0]
hb = ok(call("answer_bout", house["id"], rnd("champ", secs=30, seed=5)))["bout"]
assert hb["result"]["winner"] == "b" and hb["b"]["points"] == Bx.POINTS["house_win"]

# ---------------------------------------------------------------------------------- open call-outs
as_user(bob)
oc = ok(call("create_open_call", rnd(seed=31), "Anyone in Berlin?", True))["bout"]
assert oc["status"] == "open"
as_user(ana)
bad(call("answer_bout", oc["id"], rnd(seed=32)), "city-only call-out")
calls = call("find_fighters", None, "world", True)["calls"]
assert any(c["id"] == oc["id"] and not c["can_answer"] for c in calls)
as_user(bob)
oc2 = ok(call("create_open_call", rnd(seed=33), "Anyone, anywhere"))["bout"]
bad(call("answer_bout", oc2["id"], rnd(seed=33)), "not your own call-out")
as_user(ana)
taken = ok(call("answer_bout", oc2["id"], rnd(seed=34)))["bout"]
assert taken["status"] == "done" and taken["my_side"] == "b" and taken["kind"] == "open"

# ---------------------------------------------------------------------------------- invites for friends without an account
as_user(None)
assert denied("create_invite", rnd())
as_user(ana)
inv = ok(call("create_invite", rnd(seed=41), "Bet you can't", "Sam"))
tok = inv["token"]
assert inv["bout"]["invite_token"] == tok and inv["bout"]["kind"] == "invite"
as_user(None)
bad(call("get_invite", "nope-nope"))
g = ok(call("get_invite", tok))
assert g["challenger"]["ring"] == "The Hammer" and "score" not in g["bout"]["a"] and "email" not in json.dumps(g)
bad(call("answer_invite", tok, "", rnd(seed=42), "k1"))
gd = ok(call("answer_invite", tok, "Sam the Guest", rnd("pro", seed=42), "guest-key-1"))["bout"]
assert gd["status"] == "done" and gd["b"]["name"] == "Sam the Guest" and "score" in gd["a"]
bad(call("answer_invite", tok, "Again", rnd(seed=43), "k2"), "only once")
as_user(cat)
bad(call("claim_invite", tok, "wrong-key"))
cl = ok(call("claim_invite", tok, "guest-key-1"))
assert cl["bout"]["my_side"] == "b" and cat["points"] == cl["points"]
assert ok(call("claim_invite", tok, "guest-key-1"))["already"]
as_user(ana)
assert ok(call("claim_invite", tok, "guest-key-1"))["already"], "already claimed"

# ---------------------------------------------------------------------------------- training, rankings, fighter pages, inbox
as_user(None)
assert denied("save_training", rnd())
as_user(ana)
t1 = ok(call("save_training", rnd("rookie", seed=51)))
assert t1["points"] == 1 and t1["score"] > 0
for i in range(6):
    call("save_training", rnd("club", seed=60 + i))
assert ok(call("save_training", rnd(seed=70)))["points"] == 0, "max 5 bag-work points a day"
bad(call("save_training", {"device": "phone", "secs": 10, "events": []}))
assert ok(call("save_training", rnd(seed=71, device="pads")))["score"] > 0, "pads are fine for training"
bad(call("create_challenge", bob.get_id(), rnd(seed=72, device="pads")), "...but not for bouts")
as_user(None)
rk = call("get_rankings", "world")
assert rk["rows"] and rk["rows"][0]["rank"] == 1 and rk["rows"][0]["fighter"]["belts"][0] == "World"
assert all(r["fighter"]["fights"] >= Bx.PROVISIONAL_FIGHTS for r in rk["rows"])
assert "email" not in json.dumps(rk)
as_user(ana)
cr = call("get_rankings", "city")
assert cr["city"]["key"] == "montreal-ca" and all(r["fighter"]["city_key"] == "montreal-ca" for r in cr["rows"])
assert cr["me"] and cr["me"]["fighter"]["me"] and not cr["my_status"], "3 ranked bouts: Ana is on the Montreal board"
assert call("get_rankings", "world")["my_status"] is None or call("get_rankings", "world")["me"]
wk = call("get_rankings", "week")
assert any(r["fighter"]["me"] for r in wk["rows"]), "points this week include Ana's"
assert call("list_cities")[0]["fighters"] >= 3
as_user(cat)
assert "more ranked bout" in call("get_rankings", "world")["my_status"], "unranked members are told what it takes"
as_user(ana)
fp = ok(call("get_fighter", ana.get_id()))
assert fp["fighter"]["ring"] == "The Hammer" and any(b["key"] == "first" and b["got"] for b in fp["badges"]) and fp["history"]
bad(call("get_fighter", "nope"))
ff = call("find_fighters", "lagos", "world", True)
assert ff["fighters"] and all("Lagos" in f["city"] for f in ff["fighters"])
assert all(f["city_key"] == "montreal-ca" for f in call("find_fighters", None, "city", True)["fighters"])
ib = call("get_inbox")
assert ib["messages"] and any(m["kind"] == "result" for m in ib["messages"])
mid = ib["messages"][0]["id"]
ok(call("mark_read", mid))
as_user(bob)
bad(call("mark_read", mid), "not your message")
ok(call("mark_all_read"))
assert call("unread_count")["messages"] == 0

# expiry: an unanswered call-out expires and counts as a duck
as_user(ana)
bx = ok(call("create_challenge", bob.get_id(), rnd(seed=81)))["bout"]
row = T.fights.get_by_id(bx["id"])
row["expires"] = now - dt.timedelta(minutes=1)
ducks = bob["ducks"]
call("get_gym")
assert row["status"] == "expired" and bob["ducks"] == ducks + 1

# ---------------------------------------------------------------------------------- the Locker room avatar + bout damage
FI = M["Fighters"]
parts = call("avatar_parts")
spec = {k: n - 1 for k, n in parts.items()}
as_user(None)
assert denied("update_avatar", spec)
as_user(ana)
bad(call("update_avatar", {"skin": 99}))
bad(call("update_avatar", "nope"))
bad(call("update_avatar", dict(spec, hair=parts["hair"])), "out of range")
saved = ok(call("update_avatar", spec, "green"))["fighter"]
assert saved["avatar"] == spec and saved["glove"] == "green"
assert ok(call("update_avatar", spec, "not-a-glove"))["fighter"]["glove"] == "green", "a bad glove is ignored"
assert ok(call("get_fighter", ana.get_id()))["fighter"]["avatar"] == spec, "others see the avatar"
assert Bx.damage("loss", "ko", 150) > Bx.damage("loss", "ud", 50) > Bx.damage("win", "ud", 50) > 0
fresh = FI.fighter(ana, ana)["hurt"]
assert fresh and fresh["level"] > 0 and fresh["hours_left"] <= 24, "Ana fought today: her face shows it"
ana["hurt_at"] = now - dt.timedelta(hours=20)
older = FI.fighter(ana, ana)["hurt"]
assert older is None or older["level"] < fresh["level"], "bruises fade"
ana["hurt_at"] = now - dt.timedelta(hours=25)
assert FI.fighter(ana, ana)["hurt"] is None, "healed after 24 hours"
ana.update(hurt_level=0, hurt_at=None, hurt_kind="")
before = FI.hurt_level_at(bob, now)
as_user(ana)
kb = ok(call("create_challenge", bob.get_id(), rnd("champ", seed=95)))["bout"]
as_user(bob)
ok(call("answer_bout", kb["id"], rnd("rookie", seed=96)))
assert FI.hurt_level_at(bob, M["common"].now()) > before and FI.fighter(ana, ana)["hurt"], "both fighters carry the bout"
assert bob["hurt_level"] <= Bx.HURT_MAX
assert any(u["avatar"] for u in T.users.search(is_demo=True)), "demo fighters have faces"
assert any(FI.hurt_now(u) for u in T.users.search(is_demo=True)), "some demo fighters fought last night"

# ---------------------------------------------------------------------------------- admin: house challenges + fight log
as_user(ana)
for fn, args in [("admin_campaigns", ()), ("admin_audience", ({"type": "all"},)), ("admin_send_campaign", ({},)),
                 ("admin_cancel_campaign", ("x",)), ("admin_fight_log", ()), ("admin_find_members", ("an",))]:
    assert denied(fn, *args), fn
as_user(admin)
cp = call("admin_campaigns")
assert cp["campaigns"] and cp["campaigns"][0]["demo"] and cp["house_fighters"]
assert call("admin_audience", {"type": "all"})["count"] == 4
assert call("admin_audience", {"type": "city", "city_key": "montreal-ca"})["count"] == 1
assert call("admin_audience", {"type": "never"})["count"] >= 1
assert any(m["email"] == "cat@example.com" for m in call("admin_find_members", "cat")["members"])
bad(call("admin_send_campaign", {"title": "x"}))
bad(call("admin_send_campaign", {"title": "Sunday", "house_name": "Coach Bruno", "level": "pro", "secs": 45}))
bad(call("admin_send_campaign", {"title": "Sunday", "house_name": "Coach Bruno", "level": "pro", "secs": 60,
                                 "audience": {"type": "city", "city_key": "nowhere-xx"}}))
sent = ok(call("admin_send_campaign", {"title": "Sunday Sparring", "message": "Bring it.", "house_name": "The Heavy Bag",
                                       "level": "club", "secs": 60, "bonus": 10, "days": 5,
                                       "audience": {"type": "picked", "ids": [ana.get_id(), cat.get_id()]}}))
assert sent["sent"] == 2
as_user(cat)
hc = [b for b in call("get_gym")["to_answer"] if b["kind"] == "house" and b["campaign"]]
assert hc and hc[0]["campaign"]["bonus"] == 10 and hc[0]["a"]["name"] == "The Heavy Bag"
won = ok(call("answer_bout", hc[0]["id"], rnd("champ", seed=91)))["bout"]
assert won["outcome"] == "win" and won["b"]["points"] == Bx.POINTS["house_win"] + 10, "the campaign bonus is paid"
as_user(admin)
camp = [c for c in call("admin_campaigns")["campaigns"] if c["title"] == "Sunday Sparring"][0]
assert camp["sent"] == 2 and camp["answered"] == 1
assert ok(call("admin_cancel_campaign", camp["id"]))["cancelled"] == 1
bad(call("admin_cancel_campaign", "nope"))
log = call("admin_fight_log")
assert log["total"] > 40
assert all(x["status"] == "done" for x in call("admin_fight_log", None, "done")["fights"])
assert call("admin_fight_log", "hammer")["fights"]
ov = call("admin_overview")
assert ov["fights"] > 40 and "rounds" in ov

# ---------------------------------------------------------------------------------- demo data: remove keeps members' data
ana_points = ana["points"]
ok(call("demo_remove"))
assert M["DemoData"].state() == "removed" and not T.users.search(is_demo=True) and not T.fights.search(is_demo=True)
assert T.fights.get_by_id(b1["id"]) is not None and ana["points"] == ana_points, "members' bouts and points stay"
as_user(ana)
call("get_gym")
assert M["DemoData"].state() == "removed", "removed demo data doesn't come back by itself"
as_user(admin)
ok(call("demo_load"))
n1 = len(T.fights.search(is_demo=True))
ok(call("demo_load"))
assert len(T.fights.search(is_demo=True)) == n1, "reloading replaces the demo instead of doubling it"

# ---------------------------------------------------------------------------------- Privacy & Terms
if "legal_server" in M:
    as_user(ana)
    st = call("legal_state")
    assert st["signedIn"] and st["accepted_version"] is None
    ok(call("legal_accept", st["version"], "signup"))
    assert ana["legal_source"] == "signup" and call("legal_state")["accepted_version"] == st["version"]

# ---------------------------------------------------------------------------------- every callable is covered by a permission check
# A callable that changes data without require_user / a C.require_* check is a security hole. List the public ones here.
PUBLIC = {"get_me", "submit_feedback", "legal_state", "legal_accept", "get_fighter", "list_cities", "get_rankings",
          "get_invite", "answer_invite", "avatar_parts"}
for name, (f, need) in sorted(anvil.server.CALLABLES.items()):
    if name in PUBLIC:
        continue
    assert need, "%s is callable by anyone: add require_user=True (or list it in PUBLIC in test_server.py)" % name

print("ALL OK (%d server functions)" % len(anvil.server.CALLABLES))
