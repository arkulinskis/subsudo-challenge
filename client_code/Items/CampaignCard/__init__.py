from anvil import *

from ._anvil_designer import CampaignCardTemplate
from ... import ss, state


class CampaignCard(CampaignCardTemplate):
    """A house challenge that was sent (admin). Cancel asks, cancels the unanswered bouts and raises x-changed."""

    def __init__(self, **properties):
        super().__init__(**properties)
        c = self.item
        self.status.role = ["badge", "badge-good"] if c["status"] == "active" else ["badge"]
        bits = [c["house_name"], c["level"], "%ss" % c["secs"]] + (["+%s bonus" % c["bonus"]] if c.get("bonus") else [])
        bits.append(ss.date_text(c.get("created")))
        if c.get("demo"):
            bits.append("demo")
        self.meta.text = " · ".join(bits)
        self.sent.text, self.answered.text, self.house_wins.text = str(c["sent"]), str(c["answered"]), str(c["house_wins"])
        self.member_pct.text = ("%d%%" % round(100.0 * (c["answered"] - c["house_wins"]) / c["answered"])) if c["answered"] else "–"
        self.cancel_box.visible = c["status"] == "active"

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        if confirm("Bouts nobody answered yet are cancelled. Finished ones stay.", title="Cancel this challenge?",
                   buttons=[("Keep", False), ("Cancel them", True)], role="app-dialog"):
            r = state.call("admin_cancel_campaign", self.item["id"])
            if r:
                state.toast(state.plural(r["cancelled"], "bout") + " cancelled", "ok")
                if self.parent is not None:
                    self.parent.raise_event("x-changed")
