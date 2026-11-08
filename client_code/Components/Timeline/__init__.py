from anvil import *
from anvil.js import window

from ._anvil_designer import TimelineTemplate
from ... import ss


class Timeline(TimelineTemplate):
    """The punch log drawing of a bout."""

    def __init__(self, **properties):
        self._bout, self._ready = None, False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if self._ready and self._bout:
            self.dom_nodes["box"].innerHTML = window.SS.timeline(ss.js(self._bout))

    @property
    def bout(self):
        return self._bout

    @bout.setter
    def bout(self, value):
        self._bout = value
        self._draw()
