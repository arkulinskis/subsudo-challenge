from anvil import *

from ._anvil_designer import AvatarTemplate
from ... import ss


class Avatar(AvatarTemplate):
    """A fighter's portrait (SVG drawn by the JS engine: SS.avatar / SS.sideAvatar). Set fighter, or side for a bout
    side; size '', 'sm', 'lg' or 'xl'."""

    def __init__(self, **properties):
        self._fighter, self._side, self._size, self._ready = None, None, "", False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready:
            return
        if self._side:
            html = ss.side_avatar_html(self._side, self._size)
        elif self._fighter:
            html = ss.avatar_html(self._fighter, self._size)
        else:
            html = ""
        self.dom_nodes["box"].innerHTML = html

    @property
    def fighter(self):
        return self._fighter

    @fighter.setter
    def fighter(self, value):
        self._fighter = value
        self._draw()

    @property
    def side(self):
        return self._side

    @side.setter
    def side(self, value):
        self._side = value
        self._draw()

    @property
    def size(self):
        return self._size

    @size.setter
    def size(self, value):
        self._size = value or ""
        self._draw()
