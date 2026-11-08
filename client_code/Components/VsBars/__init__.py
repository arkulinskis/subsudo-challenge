from anvil import *
from anvil.js import window

from ._anvil_designer import VsBarsTemplate
from ... import ss


class VsBars(VsBarsTemplate):
    """Side-by-side stat bars for a bout (punches, per minute, punch types, blocks, combos, speeds, each hand)."""

    def __init__(self, **properties):
        self._bout, self._ready = None, False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready or not self._bout:
            return
        b = self._bout
        self.a_name.text, self.b_name.text = ss.bout_name(b["a"]), ss.bout_name(b["b"])
        if b["a"].get("stats") and b["b"].get("stats"):
            self.dom_nodes["bars"].innerHTML = window.SS.vsBars(ss.js(b["a"]["stats"]), ss.js(b["b"]["stats"]))

    @property
    def bout(self):
        return self._bout

    @bout.setter
    def bout(self, value):
        self._bout = value
        self._draw()
