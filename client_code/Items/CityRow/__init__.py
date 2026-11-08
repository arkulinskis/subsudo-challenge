from anvil import *

from ._anvil_designer import CityRowTemplate
from ... import router, state


class CityRow(CityRowTemplate):
    """Your city's board on the gym page. item = {"i": position from 1, "f": fighter dict}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        f = self.item["f"]
        state.set_attr(self.row, "href", router.href("fighter", f["id"]))
        self.pos.text = str(self.item["i"])
        self.av.fighter = f
        self.nm.text = f["ring"]
        self.rt.text = str(f["rating"])
