from anvil import *

from ._anvil_designer import HomeTemplate
from ... import router, ss, state


class Home(HomeTemplate):
    """#home, the gym (Operate): your fighter card (rating, tier, record, belts, rank), bouts waiting for your answer,
    the four ways to fight (gym-bag tiles), bouts you're waiting on, recent results, your city's board, fair fights
    and bag work. One call: get_gym. First it claims a guest bout fought on this device before signing up
    (Pages/Invite leaves the token in the browser's storage under 'claim')."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self._claim()
        d = state.call("get_gym")
        if d:
            self._draw(d)

    def _claim(self):
        c = ss.store_dict("claim", None)
        if not c or not c.get("token"):
            return
        state.store_set("claim", None)
        r = state.call_quiet("claim_invite", c["token"], c.get("key"))
        if isinstance(r, dict) and r.get("ok") and not r.get("already"):
            state.toast("Your invite bout is on your record (+%s points)" % r.get("points", 0), "ok")

    def _draw(self, d):
        me, rank = d["me"], d["rank"]
        self.face.fighter = me
        self.real_name.text = me["name"] + (" · " if me.get("city") else "")
        self.place.fighter = me
        self.ring.text = me["ring"]
        state.heading(self.ring, 1)
        self.tags.fighter = me
        left = 3 - (me.get("fights") or 0)
        self.provisional.visible = bool(me.get("provisional"))
        self.provisional.text = "%s to get ranked" % state.plural(left, "ranked bout")
        self.rating.text = str(me["rating"])
        self.record.text = ss.record_text(me["record"])
        self.kos.text = str(me["record"]["ko"])
        self.points.text = str(me["points"])
        self.speed.text = "%.1f" % me["best_speed"] if me.get("best_speed") else "–"
        self.rank_world.text = "#%s" % rank["global"] if rank.get("global") else "–"
        self.city_rank_box.visible = bool(me.get("city"))
        self.rank_city.text = "#%s" % rank["city"] if rank.get("city") else "–"
        self.rank_city_name.text = me.get("city") or ""
        self.nudge_card.visible = bool(d.get("needs_card"))
        self.nudge_locker.visible = not d.get("needs_card") and not me.get("avatar")
        self.nudge_face.fighter = me
        self.corner_part.visible = bool(d["to_answer"])
        self.to_answer_count.text = "%d to answer" % len(d["to_answer"])
        self.to_answer.items = [{"b": b} for b in d["to_answer"]]
        self.waiting_part.visible = bool(d["waiting"])
        self.waiting.items = [{"b": b, "share": True} for b in d["waiting"]]
        state.set_attr(self.record_link, "href", router.href("fighter", me["id"]))
        self.recent.items = [{"b": b, "words": False} for b in d["recent"]]
        self.no_recent.visible = not d["recent"]
        self.city_title.text = me.get("city") or "Your city"
        state.heading(self.city_title, 2)
        self.city_board_part.visible = bool(d["city_top"])
        self.city_board.items = [{"i": i + 1, "f": f} for i, f in enumerate(d["city_top"])]
        self.city_note.visible = not d["city_top"]
        self.city_note.text = ("Nobody ranked in %s yet. Three ranked bouts and that belt could be yours." % me["city"]) if me.get("city") \
            else "Add your city to your fighter card to see your city's board."
        self.suggested.items = d["suggested"]
        t = d["training"]
        self.best_round.text = str(t["best_score"])
        self.train_note.text = "best round · " + state.plural(t["rounds"], "round")
