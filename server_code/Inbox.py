"""Mail: fights arrive as messages (call-outs, results, house challenges, post-fight words).
send() is used by the other modules; the page calls get_inbox / mark_read / unread_count."""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C

KINDS = ("challenge", "result", "house", "words", "system", "declined", "expired")


def send(user, kind, title, body="", fight=None):
    """A message for one member. Demo fighters don't read mail, so nothing is stored for them."""
    if user is None or user["is_demo"]:
        return None
    return app_tables.messages.add_row(user=user, kind=kind if kind in KINDS else "system", title=C.text(title, 140),
                                       body=C.text(body, 600, multiline=True), fight=fight, read=False, created=C.now(),
                                       is_demo=bool(fight is not None and fight["is_demo"]))


def unread(user):
    """Unread messages + bouts waiting for this member's answer (the red dot on Mail)."""
    msgs = len(app_tables.messages.search(user=user, read=False))
    waiting = len(app_tables.fights.search(opponent=user, status="pending"))
    return {"messages": msgs, "to_answer": waiting, "total": msgs + waiting}


def _msg(m, me):
    from . import Fights
    f = m["fight"]
    return {"id": m.get_id(), "kind": m["kind"], "title": m["title"], "body": m["body"] or "", "read": bool(m["read"]),
            "created": C.iso(m["created"]), "bout": Fights.bout(f, me) if f is not None else None}


@anvil.server.callable(require_user=True)
def get_inbox():
    from . import Fights
    me = C.require_user()
    Fights.sweep()
    rows = app_tables.messages.search(tables.order_by("created", ascending=False), user=me)
    return {"messages": [_msg(m, me) for m in rows[:120]], "unread": unread(me)}


@anvil.server.callable(require_user=True)
def mark_read(message_id):
    me = C.require_user()
    m = C.row_by_id(app_tables.messages, message_id)
    if m is None or m["user"] != me:
        return C.fail("That message isn't yours.")
    m["read"] = True
    return C.ok(unread=unread(me))


@anvil.server.callable(require_user=True)
def mark_all_read():
    me = C.require_user()
    for m in app_tables.messages.search(user=me, read=False):
        m["read"] = True
    return C.ok(unread=unread(me))


@anvil.server.callable(require_user=True)
def unread_count():
    return unread(C.require_user())
