from anvil import *

from ._anvil_designer import SuggestCardTemplate
from ... import router, state


class SuggestCard(SuggestCardTemplate):
    """A fair fight suggested on the gym page (close to your rating). item = fighter dict."""

    def __init__(self, **properties):
        super().__init__(**properties)
        f = self.item
        self.av.fighter = f
        self.ring.text = f["ring"]
        self.place.fighter = f
        self.rating.text = str(f["rating"])
        state.set_attr(self.link, "href", router.href("fighter", f["id"]))
        state.set_attr(self.call_link, "href", router.href("fight", "call", f["id"]))
        state.set_attr(self.call_link, "aria-label", "Call out " + f["ring"])
