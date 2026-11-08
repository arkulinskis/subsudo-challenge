from anvil import *

from ._anvil_designer import PosterTemplate
from ... import router, ss, state


class Poster(PosterTemplate):
    """A vs B on the dark gym wall. Names link to fighter pages; scores show ??? while sealed."""

    def __init__(self, **properties):
        self._bout, self._ready = None, False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready or not self._bout:
            return
        b = self._bout
        parts = {"a": (self.a_av, self.a_link, self.a_name, self.a_sub, self.a_score, self.a_delta),
                 "b": (self.b_av, self.b_link, self.b_name, self.b_sub, self.b_score, self.b_delta)}
        for k, (av, link, name, sub, score, delta) in parts.items():
            s = b[k]
            av.side = s
            name.text = ss.bout_name(s)
            state.set_attr(link, "href", router.href("fighter", s["fighter"]["id"]) if s.get("fighter") else None)
            sub.text = ss.side_sub(b, k, poster=True)
            text, role = ss.side_score(b, k)
            score.text = text
            score.role = ["sc", role] if role else ["sc"]
            bits = []
            if b["status"] == "done":
                if s.get("points"):
                    bits.append("+%s pts" % s["points"])
                if s.get("rating_delta"):
                    bits.append("%s%s rating" % ("+" if s["rating_delta"] > 0 else "", s["rating_delta"]))
            delta.text = " · ".join(bits)
            delta.visible = bool(bits)

    @property
    def bout(self):
        return self._bout

    @bout.setter
    def bout(self, value):
        self._bout = value
        self._draw()
