from anvil import *

from ._anvil_designer import FighterCardTemplate
from ... import router, ss, state


class FighterCard(FighterCardTemplate):
    """A fighter to call out on Find. item = fighter dict."""

    def __init__(self, **properties):
        super().__init__(**properties)
        f = self.item
        self.av.fighter = f
        self.ring.text = f["ring"]
        self.place.fighter = f
        self.stance.text = f.get("stance") or ""
        self.tags.fighter = f
        self.bio.text = f.get("bio") or ""
        self.rating.text = str(f["rating"])
        self.record.text = ss.record_text(f["record"])
        self.kos.text = str(f["record"]["ko"])
        self.speed.text = "%.1f" % f["best_speed"] if f.get("best_speed") else "–"
        self.demo.visible = bool(f.get("demo"))
        state.set_attr(self.link, "href", router.href("fighter", f["id"]))
        state.set_attr(self.record_link, "href", router.href("fighter", f["id"]))
        state.set_attr(self.record_link, "aria-label", f["ring"] + "'s record")
        state.set_attr(self.call_link, "href", router.href("fight", "call", f["id"]))
        state.set_attr(self.call_link, "aria-label", "Call out " + f["ring"])
