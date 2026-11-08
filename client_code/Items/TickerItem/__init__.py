from anvil import *

from ._anvil_designer import TickerItemTemplate


class TickerItem(TickerItemTemplate):
    """One entry on the landing page's world-board ticker. item = {k (brass), t, v (faint)}."""

    def __init__(self, **properties):
        super().__init__(**properties)
