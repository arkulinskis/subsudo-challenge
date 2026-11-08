from anvil import *

from ._anvil_designer import JudgeRowTemplate
from ... import state


class JudgeRow(JudgeRowTemplate):
    """One judge's card. item = {judge, looks, a, b}; the higher score is green."""

    def __init__(self, **properties):
        super().__init__(**properties)
        a, b = self.item["a"], self.item["b"]
        self.a.text, self.b.text = str(a), str(b)
        self.a.role = ["n", "hi"] if a > b else ["n"]
        self.b.role = ["n", "hi"] if b > a else ["n"]
        state.set_attr(self.a, "role", "cell")
        state.set_attr(self.b, "role", "cell")
