from anvil import *

from ._anvil_designer import ResultTemplate
from ... import ss, state

LOOKS = {"power": "Looks at power and speed", "volume": "Counts punches and combos", "craft": "Defence, variety, both hands"}


class Result(ResultTemplate):
    """The stamp, the line under it and the judges' cards of a finished bout."""

    def __init__(self, **properties):
        self._bout, self._ready = None, False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready or not self._bout or not self._bout.get("result"):
            return
        b = self._bout
        r, mine = b["result"], b.get("outcome")
        a_name, b_name = ss.bout_name(b["a"]), ss.bout_name(b["b"])
        if r["winner"] == "draw":
            self.stamp.text, kind = "Draw", "draw"
        else:
            short = ss.METHOD_SHORT.get(r.get("method"), "Decision")
            self.stamp.text = ("You win · " + short) if mine == "win" else ("You lose · " + short) if mine == "loss" else short
            kind = "loss" if mine == "loss" else "win"
        self.stamp.role = ["stamp", "stamp-" + kind]
        winner = a_name if r["winner"] == "a" else b_name if r["winner"] == "b" else None
        self.line.text = ("%s wins by %s" % (winner, r["method_name"].lower())) if winner else "The judges couldn't split them"
        self.a_head.text, self.b_head.text = a_name, b_name
        self.judges.items = [{"judge": c["judge"], "looks": LOOKS.get(c.get("looks_at"), ""), "a": c["a"], "b": c["b"]}
                             for c in r.get("cards") or []]

    @property
    def bout(self):
        return self._bout

    @bout.setter
    def bout(self, value):
        self._bout = value
        self._draw()
