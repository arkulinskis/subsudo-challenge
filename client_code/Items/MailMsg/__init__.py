from anvil import *
import anvil.js

from ._anvil_designer import MailMsgTemplate
from ... import state

ICON = {"challenge": "megaphone", "house": "house", "result": "trophy", "words": "chat", "declined": "x", "expired": "clock",
        "system": "bell"}


class MailMsg(MailMsgTemplate):
    """One message in Mail (a call-out, a result, words ...) with its bout card. Opening anything in an unread
    message marks it read (x-read on the panel)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        m = self.item
        self.box.classes["unread"] = not m["read"]
        self.new_badge.visible = not m["read"]
        self.icon_box.classes[m["kind"]] = True
        self.icon.classes["ic-" + ICON.get(m["kind"], "bell")] = True
        self.body.text, self.body.visible = m.get("body") or "", bool(m.get("body"))
        self.when.text = state.ago(m.get("created"))
        self.card.visible = bool(m.get("bout"))
        if m.get("bout"):
            self.card.item = {"b": m["bout"], "unread": not m["read"], "words": m["kind"] != "words"}
            self.card.draw()
        anvil.js.get_dom_node(self).addEventListener("click", anvil.js.report_exceptions(self._clicked))

    def _clicked(self, event):
        if self.item["read"] or not event.target.closest("a, button"):
            return
        self.item["read"] = True
        if self.parent is not None:
            self.parent.raise_event("x-read", message_id=self.item["id"])
