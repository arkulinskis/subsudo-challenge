from anvil import *

from ._anvil_designer import HouseChipTemplate


class HouseChip(HouseChipTemplate):
    """One house level on #try's "vs the house" row. item = {name, beat, draw, score}: a tick when you'd beat that
    level, a cross when the house wins (a dash for a draw), and the house's score."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        beat, draw = bool(it.get("beat")), bool(it.get("draw"))
        kind = "beat" if beat else ("draw" if draw else "lost")
        self.dom_nodes["chip"].classList.add("ty-" + kind)
        self.dom_nodes["icon"].classList.add("ic-check" if beat else ("ic-minus" if draw else "ic-x"))
        self.dom_nodes["name"].textContent = it.get("name") or ""
        self.dom_nodes["score"].textContent = "house %s" % it.get("score", 0)
        self.dom_nodes["chip"].setAttribute("aria-label", "%s: %s (house scored %s)" % (
            it.get("name"), "you'd win" if beat else ("a draw" if draw else "the house wins"), it.get("score", 0)))
