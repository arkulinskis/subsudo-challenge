from anvil import *
from anvil.js import window

from ._anvil_designer import RatingLineTemplate
from ... import ss


class RatingLine(RatingLineTemplate):
    """The rating line, or a note until there are two ranked bouts."""

    def __init__(self, **properties):
        self._history, self._ready = None, False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready:
            return
        h = self._history or []
        self.empty.visible = len(h) < 2
        self.dom_nodes["box"].innerHTML = window.SS.ratingLine(ss.js(h)) if len(h) >= 2 else ""

    @property
    def history(self):
        return self._history

    @history.setter
    def history(self, value):
        self._history = value
        self._draw()
