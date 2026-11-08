from anvil import *
import anvil.js

from ._anvil_designer import PartRowTemplate
from ... import state


class PartRow(PartRowTemplate):
    """One avatar part in the Locker room with ‹ › arrows (← → keys on a focused row too).
    item = {key, label, names, colors (or None), value}. Arrows raise x-step(key, d) on the panel; the page changes
    the value and calls show(value) here, so the row keeps its keyboard focus."""

    def __init__(self, **properties):
        super().__init__(**properties)
        label = self.item["label"]
        self.lbl.text = label
        state.set_attr(self.row, "aria-label", label)
        state.set_attr(self.row, "data-key", self.item["key"])
        state.set_attr(self.prev, "aria-label", "Previous " + label)
        state.set_attr(self.next, "aria-label", "Next " + label)
        anvil.js.get_dom_node(self.row).addEventListener("keydown", anvil.js.report_exceptions(self._key))
        self.show(self.item["value"], bump=False)

    def show(self, value, bump=True):
        names, colors = self.item["names"], self.item.get("colors")
        self.item["value"] = value
        self.value.text = names[value]
        self.count.text = "%d/%d" % (value + 1, len(names))
        self.swatch.visible = bool(colors)
        if colors:
            self.swatch.style["background"] = colors[value]
        if bump:
            node = anvil.js.get_dom_node(self.row)
            node.classList.remove("bump")
            node.offsetWidth  # restart the little bump animation
            node.classList.add("bump")

    def _step(self, d):
        if self.parent is not None:
            self.parent.raise_event("x-step", key=self.item["key"], d=d)

    def prev_click(self, event):
        self._step(-1)

    def next_click(self, event):
        self._step(1)

    def _key(self, event):
        if event.key in ("ArrowLeft", "ArrowRight"):
            event.preventDefault()
            self._step(-1 if event.key == "ArrowLeft" else 1)
