"""The Python side of the Subsudo engine (theme/assets/ss-core.js, ss-face.js, ss-motion.js = window.SS) and the small
text helpers every Form shares (places, tiers, bout status lines, dates, share links, the guest key).

Drawing stays JavaScript: Components/Avatar, Timeline, VsBars, RatingLine and Recorder call it through here.
Data goes to JS as JSON (js()); anything coming back from JS is turned into real Python with py().
"""
import json

import anvil.js
from anvil.js import window

from . import state

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
KIND_BADGE = {"house": "badge-brass", "invite": "badge-brand"}
METHOD_SHORT = {"ko": "KO!", "tko": "TKO", "ud": "Decision", "sd": "Split decision", "md": "Majority"}


def js(obj):
    """A Python dict/list as a real JS object (the engine reads plain JS objects)."""
    return window.JSON.parse(json.dumps(obj))


def py(js_obj):
    """A JS object from the engine as real Python dicts and lists."""
    return json.loads(window.JSON.stringify(js_obj))


def loose(x):
    """Pass a value through untyped (the validator's stubs don't know dynamic dom_nodes keys)."""
    return x


# ---------------------------------------------------------------- drawing
def avatar_html(fighter, size=""):
    """The fighter's Locker-room portrait (house fighters and guests get a glove) as an SVG string."""
    return window.SS.avatar(js(fighter or {}), size or "")


def side_avatar_html(side, size=""):
    return window.SS.sideAvatar(js(side or {}), size or "")


# ---------------------------------------------------------------- words
def country(code):
    return window.SS.country(code) if code else ""


def place_text(f):
    """'Montréal' (the country code is a separate chip, see Components/Place)."""
    return (f or {}).get("city") or ""


def tier_role(name):
    return "tier-" + "-".join(str(name or "").lower().split())


def belt_text(b):
    return "World belt" if b == "World" else "%s belt" % b


def hurt_text(h):
    if not h:
        return ""
    heal = h.get("age", 0) >= 14
    word = "Seeing stars" if h.get("ko") else ("Healing" if heal else h.get("label") or "Bruised")
    return "%s · %sh to heal" % (word, h.get("hours_left", 0))


def bout_name(side):
    return side["fighter"]["ring"] if side.get("fighter") else (side.get("name") or "")


def record_text(r):
    return "%s-%s-%s" % (r["w"], r["l"], r["d"]) if r else ""


def date_text(iso, year=True):
    """'2 Nov 2026' (or '2 Nov')."""
    if not iso:
        return ""
    y, m, d = iso[:10].split("-")
    return "%d %s%s" % (int(d), MONTHS[int(m) - 1], (" " + y) if year else "")


def status_text(b):
    s = b["status"]
    if s == "done":
        return "%s · %s" % (b["result"]["method_name"], state.ago(b.get("finished")))
    if s == "open":
        return "Open call-out · " + state.ago(b.get("created"))
    if s == "pending":
        if b.get("my_side") == "b":
            return "Answer by " + date_text(b.get("expires"), False)
        return "Waiting for %s · sent %s" % (bout_name(b["b"]), state.ago(b.get("created")))
    return {"declined": "Ducked", "cancelled": "Cancelled", "expired": "Expired, no answer"}.get(s, s)


def outcome(b):
    """('Won', 'out-win') for a finished bout seen by one of its fighters, else ('', '')."""
    o = b.get("outcome")
    if b["status"] != "done" or not o:
        return "", ""
    return {"win": "Won", "loss": "Lost"}.get(o, "Draw"), "out-" + o


def side_sub(b, key, poster=False):
    """The line under a fighter's name on a bout card or the poster."""
    s = b[key]
    if s.get("fighter"):
        f = s["fighter"]
        bits = [x for x in [f.get("city"), f.get("country")] if x]
        text = " · ".join(bits)
        return (text + " · %s" % f["rating"]) if poster else text
    if s.get("house"):
        return ("House fighter · " if poster else "House · ") + (s.get("level") or "")
    if s.get("guest"):
        return "Guest"
    if b["status"] == "open":
        return "Anyone" if poster else ((b["city"] + " only") if b.get("city") else "Any city")
    return ""


def side_score(b, key):
    """(text, role) for a side's score: the number, ??? while sealed, or '–'."""
    s = b[key]
    won = bool(b.get("result")) and b["result"].get("winner") == key
    if isinstance(s.get("score"), (int, float)):
        return str(s["score"]), ("win" if won else "")
    if s.get("recorded"):
        return "???", "sealed"
    return "–", "sealed"


# ---------------------------------------------------------------- sharing and the guest key
def invite_url(token):
    return window.SS.inviteUrl(token)


def share(url, text):
    window.SS.share(url, text)


def copy(text):
    window.SS.copy(text)


def store_dict(key, default):
    """A dict from this browser's storage as real Python (UI.store.get gives JS proxies for objects)."""
    try:
        raw = window.localStorage.getItem("subsudo." + key)
        v = json.loads(raw) if raw else None
    except Exception:
        v = None
    return v if isinstance(v, dict) else default


def guest_key():
    k = state.store_get("guest_key", None)
    if not k:
        k = window.SS_RANDOM_KEY()
        state.store_set("guest_key", k)
    return str(k)


def prefs():
    p = window.SS.prefs
    return {"sound": bool(p.sound), "voice": bool(p.voice), "music": bool(p.music)}


def set_pref(key, value):
    window.SS.setPref(key, bool(value))


def bell(n=1):
    window.SS.bell(n)


def say(text):
    window.SS.say(text)


def report(fn):
    return anvil.js.report_exceptions(fn)
