from anvil import *

from ._anvil_designer import MemberChipTemplate
from ... import state


class MemberChip(MemberChipTemplate):
    """A member in the admin's 'picked fighters' audience. item = {m: {id, ring, email}, picked: bool}.
    A found member (+) raises x-pick, a picked one (×) raises x-unpick."""

    def __init__(self, **properties):
        super().__init__(**properties)
        m, picked = self.item["m"], self.item.get("picked")
        self.ring.text = m["ring"]
        self.email.text = "" if picked else (m.get("email") or "")
        self.email.visible = bool(self.email.text)
        self.icon.classes["ic-x" if picked else "ic-plus"] = True
        state.set_attr(self.btn, "aria-label", ("Remove " if picked else "Add ") + m["ring"])

    def btn_click(self, event):
        if self.parent is not None:
            self.parent.raise_event("x-unpick" if self.item.get("picked") else "x-pick", member=self.item["m"])
