from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import FighterTemplate
from ... import router, ss, state


class Fighter(FighterTemplate):
    """#fighter/<id> (public): a fighter's card, belts, rating line, record, best round, badges (earned and still to
    earn), recent bouts and a "Call out" button. Calls: get_fighter."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        r = anvil.server.call("get_fighter", args[0] if args else None)
        ok = isinstance(r, dict) and r.get("ok") is not False and r.get("fighter")
        self.gone.visible = not ok
        self.main.visible = bool(ok)
        if ok:
            self._draw(r)

    def _draw(self, d):
        f, b, me = d["fighter"], d["best"], state.me()
        window.document.title = f["ring"] + " · Subsudo"
        self.av.fighter = f
        self.real_name.text = f["name"]
        self.place.fighter = f
        self.stance.text = f.get("stance") or ""
        self.ring.text = f["ring"]
        state.heading(self.ring, 1)
        self.tags.fighter = f
        self.unranked.visible = bool(f.get("provisional"))
        self.open.visible = bool(f.get("open"))
        self.demo.visible = bool(f.get("demo"))
        self.bio.text = "\u201c%s\u201d" % f["bio"] if f.get("bio") else ""
        self.bio.visible = bool(f.get("bio"))
        can_call = bool(d.get("can_challenge") and me)
        self.call_link.visible = can_call
        state.set_attr(self.call_link, "href", router.href("fight", "call", f["id"]))
        self.edit_link.visible = not can_call and bool(f.get("me"))
        self.join_link.visible = not can_call and not f.get("me") and not me
        self.n_rating.text = str(f["rating"])
        self.n_world.text = "#%s" % d["rank"]["global"] if d["rank"].get("global") else "–"
        self.n_record.text = ss.record_text(f["record"])
        self.n_kos.text = str(f["record"]["ko"])
        self.n_points.text = str(f["points"])
        self.n_ducks.text = str(f.get("ducks", 0))
        self.bouts.items = [{"b": x, "words": False} for x in d["bouts"]]
        self.no_bouts.visible = not d["bouts"]
        self.line.history = d.get("history") or []
        self.b_score.text = str(b["score"])
        self.b_speed.text = "%.1f" % b["speed"] if b.get("speed") else "–"
        self.b_punches.text, self.b_blocks.text = str(b["punches"]), str(b["blocks"])
        self.badges.items = d["badges"]
