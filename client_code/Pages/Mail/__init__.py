from anvil import *

from ._anvil_designer import MailTemplate
from ... import state


class Mail(MailTemplate):
    """#mail: fights arrive as messages (call-outs, house challenges, results, ducks, no-shows, post-fight words), newest
    first, each with its bout card. Opening something in a message marks it read. Calls: get_inbox, mark_read,
    mark_all_read."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.messages.add_event_handler("x-read", self._read)
        self.load()

    def load(self):
        d = state.call("get_inbox")
        if not d:
            return
        n = d["unread"]
        self.to_answer.text = ("%s waiting for your answer." % state.plural(n["to_answer"], "bout")) if n.get("to_answer") else ""
        self.to_answer.visible = bool(n.get("to_answer"))
        self.all_button.visible = bool(n.get("messages"))
        self.messages.items = d["messages"]
        self.empty.visible = not d["messages"]
        self._unread(n.get("total"))

    def _unread(self, n):
        shell = getattr(self, "layout", None)
        if shell is not None and hasattr(shell, "set_unread"):
            shell.set_unread(n)

    def _read(self, message_id, **event_args):
        r = state.call_quiet("mark_read", message_id)
        if isinstance(r, dict) and r.get("unread"):
            self._unread(r["unread"].get("total"))

    @handle("all_button", "click")
    def all_button_click(self, **event_args):
        if state.call("mark_all_read") is not None:
            self.load()
