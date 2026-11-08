from anvil import *

from ._anvil_designer import PlaceTemplate
from ... import ss, state


class Place(PlaceTemplate):
    """'Montréal' + a 'CA' chip (the country's name as its tooltip)."""

    def __init__(self, **properties):
        self._fighter, self._empty, self._ready = None, "", False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready:
            return
        f = self._fighter or {}
        cc = f.get("country") or ""
        self.city.text = f.get("city") or ("" if cc else self._empty)
        self.city.visible = bool(self.city.text)
        self.cc.text = cc
        self.cc.visible = bool(cc)
        state.set_attr(self.cc, "title", ss.country(cc) if cc else None)

    @property
    def fighter(self):
        return self._fighter

    @fighter.setter
    def fighter(self, value):
        self._fighter = value
        self._draw()

    @property
    def empty(self):
        return self._empty

    @empty.setter
    def empty(self, value):
        self._empty = value or ""
        self._draw()
