from anvil import *

from ._anvil_designer import TierChipTemplate
from ... import ss


class TierChip(TierChipTemplate):
    """A rating tier in "How the rankings work". item = {name, from}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.name.text = self.item["name"]
        self.name.role = ["tier", ss.tier_role(self.item["name"])]
        self.from_.text = "%s+" % self.item["from"]
