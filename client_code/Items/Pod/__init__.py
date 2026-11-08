from anvil import *

from ._anvil_designer import PodTemplate
from ... import router, state


class Pod(PodTemplate):
    """A podium place (top 3 of a board, shown 2-1-3). item = {"r": row, "i": 0 for the winner, 1, 2}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        r, i = self.item["r"], self.item["i"]
        f = r["fighter"]
        state.set_attr(self.pod, "href", router.href("fighter", f["id"]))
        self.pod.classes["p%d" % (i + 1)] = True
        self.place_no.text = str(i + 1)
        self.av.size = "lg" if i == 0 else ""
        self.av.fighter = f
        self.ring.text = f["ring"]
        self.place.fighter = f
        self.value.text = str(r["value"])
