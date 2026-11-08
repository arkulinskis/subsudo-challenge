from anvil import *

from ._anvil_designer import BoutTemplate
from ... import router, ss, state


class Bout(BoutTemplate):
    """#bout/<id> (Operate): the poster (scores sealed until the answer) and, by state: the result (judges' cards, tale of
    the tape, punch log, post-fight words, rematch), fight back / duck, waiting (share the invite link again, cancel), or
    a bout that ended without a result. Calls: get_bout, decline_bout, cancel_bout, post_words."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.b = ss.loose(None)
        state.set_control_attr(self.words_box, "maxlength", 280)
        state.set_control_attr(self.words_box, "aria-label", "Your words after the bout")
        r = state.call("get_bout", args[0] if args else None)
        self.gone.visible = not r
        self.main.visible = bool(r)
        if r:
            self._draw(r["bout"])

    def _draw(self, b):
        self.b = b
        me = b.get("my_side")
        other = b["b"] if me == "a" else b["a"] if me == "b" else None
        self.kind.text = b["kind_label"]
        self.kind.role = ["badge", "badge-brass"] if b["kind"] == "house" else ["badge"]
        self.secs.text = "%ss round" % b["secs"]
        self.campaign.visible = bool(b.get("campaign"))
        self.campaign.text = (b.get("campaign") or {}).get("title") or ""
        text, role = ss.outcome(b)
        self.outcome.text, self.outcome.visible, self.outcome.role = text, bool(text), ["ss-out", role] if role else ["ss-out"]
        self.status.text = ss.status_text(b)
        self.demo.visible = bool(b.get("demo"))
        self.sr_title.text = "%s vs %s" % (ss.bout_name(b["a"]), ss.bout_name(b["b"]))
        self.poster.bout = b
        done, answer, wait = b["status"] == "done", bool(b.get("can_answer")), bool(b.get("can_cancel"))
        self.done_part.visible = done
        self.answer_part.visible = not done and answer
        self.wait_part.visible = not done and not answer and wait
        self.over_part.visible = not done and not answer and not wait
        if done:
            f = other.get("fighter") if other else None
            self.rematch_link.visible = bool(f and not f.get("me"))
            if f:
                state.set_attr(self.rematch_link, "href", router.href("fight", "call", f["id"]))
            self.result.bout = b
            self.bars.bout = b
            self.timeline.bout = b
            for k, box, who, txt in (("a", self.a_quote, self.a_quote_who, self.a_quote_text), ("b", self.b_quote, self.b_quote_who, self.b_quote_text)):
                w = b[k].get("words")
                box.visible = bool(w)
                who.text = ss.bout_name(b[k]) + (" · before" if k == "a" else "")
                txt.text = w or ""
            self.say_part.visible = bool(b.get("can_words"))
            self.words_box.text = (b["b"].get("words") or "") if me == "b" else ""
            self.no_words.visible = not b["a"].get("words") and not b["b"].get("words") and not b.get("can_words")
        elif answer:
            w = b["a"].get("words")
            self.answer_words.text = "\u201c%s\u201d \u2014 %s" % (w, ss.bout_name(b["a"])) if w else ""
            self.answer_words.visible = bool(w)
            state.set_attr(self.answer_link, "href", router.href("fight", "answer", b["id"]))
            self.answer_text.text = "Take this call-out" if b["status"] == "open" else "Fight back"
            self.decline_button.visible = bool(b.get("can_decline"))
            self.answer_note.text = ("The first fighter to answer takes it. " if b["status"] == "open" else "Answer by %s. " % ss.date_text(b.get("expires"))) + \
                "The score stays sealed until you fight. Ducking counts on your record."
        elif wait:
            self.wait_title.text = "Pinned to the board" if b["status"] == "open" else "Waiting for " + ss.bout_name(b["b"])
            score = b["a"].get("score")
            self.wait_text.text = "Your score: %s. %s %s." % ("–" if score is None else score,
                                                               "Open until" if b["status"] == "open" else "They have until",
                                                               ss.date_text(b.get("expires")))
            self.share_button.visible = bool(b.get("invite_token"))
        else:
            self.over_title.text = ss.status_text(b)

    @handle("decline_button", "click")
    def decline_button_click(self, **event_args):
        if confirm("It counts as a duck on your fighter card, and %s hears about it." % ss.bout_name(self.b["a"]), title="Duck this bout?",
                   buttons=[("Cancel", False), ("Duck it", True)], role="app-dialog"):
            r = state.call("decline_bout", self.b["id"])
            if r:
                state.toast("Ducked.")
                self._draw(r["bout"])

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        if confirm("Your round is thrown out and nobody can answer it.", title="Cancel this bout?",
                   buttons=[("Keep it", False), ("Cancel it", True)], role="app-dialog"):
            r = state.call("cancel_bout", self.b["id"])
            if r:
                state.toast("Cancelled")
                self._draw(r["bout"])

    @handle("share_button", "click")
    def share_button_click(self, **event_args):
        ss.share(ss.invite_url(self.b["invite_token"]), "You've been called out on Subsudo. One round, your phone or your camera.")

    @handle("words_box", "pressed_enter")
    def words_box_pressed_enter(self, **event_args):
        self.say_button_click()

    @handle("say_button", "click")
    def say_button_click(self, **event_args):
        r = state.call("post_words", self.b["id"], self.words_box.text or "")
        if r:
            state.toast("Said.", "ok")
            self._draw(r["bout"])
