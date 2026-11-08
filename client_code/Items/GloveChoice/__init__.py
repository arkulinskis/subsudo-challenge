from anvil import *

from ._anvil_designer import GloveChoiceTemplate
from ... import state


class GloveChoice(GloveChoiceTemplate):
    """A glove colour on the fighter card form. item = {key, name, on}; a click raises x-glove(key) on the panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.av.fighter = {"glove": self.item["key"], "bare": True}
        state.set_attr(self.btn, "aria-label", self.item["name"] + " gloves")
        state.set_attr(self.btn, "title", self.item["name"])
        state.set_attr(self.btn, "data-key", self.item["key"])
        state.set_attr(self.btn, "aria-pressed", "true" if self.item.get("on") else "false")
        self.btn.classes["on"] = bool(self.item.get("on"))

    def btn_click(self, event):
        if self.parent is not None:
            self.parent.raise_event("x-glove", key=self.item["key"])
