from anvil import *

from ._anvil_designer import BadgeTileTemplate
from ... import state

ICONS = {"first": "glove", "ko": "bolt", "speed": "bolt", "volume": "grid", "guard": "shield", "globe": "globe", "house": "house",
         "road": "map", "belt": "trophy"}


class BadgeTile(BadgeTileTemplate):
    """A badge on a fighter's page, earned (brass medal) or still to earn. item = {key, name, how, got}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.tile.classes["got"] = bool(self.item.get("got"))
        self.icon.classes["ic-" + ICONS.get(self.item.get("key"), "star")] = True
        state.set_attr(self.tile, "title", self.item.get("how"))
