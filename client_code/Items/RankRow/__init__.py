from anvil import *

from ._anvil_designer import RankRowTemplate
from ... import router, state


class RankRow(RankRowTemplate):
    """A row on a board (rankings, the landing page's top 5). item = {"r": {rank, value, fighter}, "unit": "rating"|"pts"
    (or "" to hide), "tier": show the tier badge}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        r, f = self.item["r"], self.item["r"]["fighter"]
        state.set_attr(self.row, "href", router.href("fighter", f["id"]))
        self.row.classes["me"] = bool(f.get("me"))
        self.pos.text = str(r["rank"])
        self.av.fighter = f
        self.ring.text = f["ring"]
        self.place.fighter = f
        self.tags.tier = bool(self.item.get("tier"))
        self.tags.fighter = f
        rec = f.get("record") or {}
        self.rec.text = ("%s-%s-%s" % (rec["w"], rec["l"], rec["d"]) + (" · %s KO" % rec["ko"] if rec.get("ko") else "")) if rec else ""
        self.value.text = str(r["value"])
        self.unit.text = self.item.get("unit") or ""
        self.unit.visible = bool(self.unit.text)
