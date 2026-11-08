from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import InviteTemplate
from ... import ss, state


class Invite(InviteTemplate):
    """#invite/<token> (public): a friend was sent a link. No account needed: who called you out, a name, a round (phone
    or camera), the result at once. The browser keeps a random guest key; after signing up, the gym page claims the bout
    with it (storage 'claim'). Calls: get_invite, answer_invite (public), claim_invite."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.token = args[0] if args else ""
        self.ch = None
        self._show("")
        state.set_control_attr(self.name_box, "maxlength", 40)
        state.set_control_attr(self.name_box, "autocomplete", "nickname")
        r = anvil.server.call("get_invite", self.token) if self.token else {"ok": False, "error": "This invite link is incomplete."}
        if not isinstance(r, dict) or r.get("ok") is False:
            self._show("closed")
            self.closed_text.text = str((r or {}).get("error") or "This invite doesn't exist any more.")
            return
        self._draw(r)

    def _show(self, which):
        for name, part in (("closed", self.closed_part), ("mine", self.mine_part), ("fight", self.fight_part), ("result", self.result_part)):
            part.visible = name == which
        if which != "fight":
            self.recorder.stop()

    def _draw(self, d):
        b, ch = d["bout"], d["challenger"]
        self.ch = ch
        if b["status"] == "done":
            self._result(b)
            return
        if d.get("mine"):
            self._show("mine")
            return
        self._show("fight")
        self.hero_ring.text = ch["ring"]
        self.hero_text.text = ("From %s. " % ", ".join(x for x in [ch.get("city"), ch.get("country")] if x) if ch.get("city") else "") + \
            "One %s-second round. Their score is sealed until you fight back. No account needed." % b["secs"]
        self.poster.bout = b
        w = b["a"].get("words")
        self.words.text = "\u201c%s\u201d \u2014 %s" % (w, ch["ring"]) if w else ""
        self.words.visible = bool(w)
        self.name_box.placeholder = "What should %s call you?" % ch["ring"]
        saved = state.store_get("guest_name", None)
        self.name_box.text = saved or (b["b"]["name"] if b["b"].get("name") != "Your friend" else "")
        self.recorder.start(self._keep, secs=b["secs"], keep_label="Send my answer")

    def _keep(self, rnd):
        name = (self.name_box.text or "").strip()
        if len(name) < 2:
            state.focus(self.name_box)
            state.toast("Type your fighting name at the top first.", "error")
            return
        state.store_set("guest_name", name)
        r = state.call("answer_invite", self.token, name, rnd, ss.guest_key())
        if not r:
            return
        self._result(r["bout"])
        if state.me():
            c = state.call_quiet("claim_invite", self.token, ss.guest_key())
            if isinstance(c, dict) and c.get("ok") and not c.get("already"):
                state.toast("On your record: +%s points" % c.get("points", 0), "ok")

    def _result(self, b):
        me, ch = state.me(), self.ch or {}
        guest_won = b["result"]["winner"] == "b"
        if not me:
            state.store_set("claim", {"token": self.token, "key": ss.guest_key()})
        self._show("result")
        self.result_poster.bout = b
        self.result.bout = b
        self.bars.bout = b
        self.after_title.text = ("You beat %s. Make it official." % ch.get("ring", "them")) if guest_won else \
            "Too close to call." if b["result"]["winner"] == "draw" else "Want a rematch?"
        state.heading(self.after_title, 1)
        self.after_text.text = "This bout was fought as a guest." if me else \
            "Create a free account and this bout goes on your record, with points. Then call out %s properly, or anyone in the world." % ch.get("ring", "them")
        self.join_link.visible = not me
        self.gym_link.visible = bool(me)
        if guest_won:
            ss.bell(3)
        window.scrollTo(0, 0)

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        ss.copy(window.location.href)
