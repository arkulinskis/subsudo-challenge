from anvil import *

from ._anvil_designer import LogRowTemplate
from ... import router, ss, state


class LogRow(LogRowTemplate):
    """One bout in the admin fight log; the whole row opens the bout."""

    def __init__(self, **properties):
        super().__init__(**properties)
        f = self.item
        state.set_attr(self.row, "href", router.href("bout", f["id"]))
        self.when.text = ss.date_text(f.get("created"), False)
        self.kind.text = f["kind"] + (" · demo" if f.get("demo") else "")
        self.devices.text = (f.get("a_device") or "") + (" / " + f["b_device"] if f.get("b_device") else "")
        self.score.text = ("–" if f.get("a_score") is None else str(f["a_score"])) + (" : %s" % f["b_score"] if f.get("b_score") is not None else "")
        if f["status"] == "done":
            self.result.text = "draw" if f["winner"] == "draw" else "%s · %s" % (f["winner"].upper(), f["method"])
        else:
            self.result.text = f["status"]
        self.flags.text = ", ".join(f.get("flags") or [])
