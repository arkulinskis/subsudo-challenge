from anvil import *

from ._anvil_designer import BoutCardTemplate
from ... import router, ss, state


class BoutCard(BoutCardTemplate):
    """A bout as a fight-poster card (home, Mail, Find's open call-outs, a fighter's record).
    item = {"b": bout dict, "words": show the challenger's words (default True), "unread": bool,
            "share": show "Share link" instead of Open (invites you're waiting on)}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.draw()

    def draw(self):
        o = self.item or {}
        b = o.get("b")
        if not b:
            return
        self.card.classes["house"] = b["kind"] == "house"
        self.card.classes["unread"] = bool(o.get("unread"))
        sides = {"a": (self.a_av, self.a_link, self.a_name, self.a_sub, self.a_score),
                 "b": (self.b_av, self.b_link, self.b_name, self.b_sub, self.b_score)}
        for k, (av, link, name, sub, score) in sides.items():
            s = b[k]
            av.side = s
            name.text = ss.bout_name(s)
            state.set_attr(link, "href", router.href("fighter", s["fighter"]["id"]) if s.get("fighter") else None)
            sub.text = ss.side_sub(b, k)
            sub.visible = bool(sub.text)
            if isinstance(s.get("score"), (int, float)):
                won = bool(b.get("result")) and b["result"].get("winner") == k
                score.text, score.role, score.visible = str(s["score"]), (["score", "win"] if won else ["score"]), True
            elif s.get("recorded"):
                score.text, score.role, score.visible = "???", ["score", "sealed"], True
                state.set_attr(score, "title", "Sealed until you fight back")
            else:
                score.visible = False
        words = b["a"].get("words") if o.get("words", True) and b["status"] != "done" else ""
        self.words.text, self.words.visible = words or "", bool(words)
        self.kind.text = b.get("kind_label") or ""
        self.kind.role = ["badge", ss.KIND_BADGE[b["kind"]]] if b["kind"] in ss.KIND_BADGE else ["badge"]
        self.secs.text = "%ss" % b.get("secs", 60)
        bonus = (b.get("campaign") or {}).get("bonus")
        self.bonus.text, self.bonus.visible = "+%s bonus" % bonus if bonus else "", bool(bonus)
        text, role = ss.outcome(b)
        self.outcome.text, self.outcome.visible, self.outcome.role = text, bool(text), ["ss-out", role] if role else ["ss-out"]
        self.status.text = ss.status_text(b)
        share = bool(o.get("share") and b.get("invite_token"))
        self.share_button.visible = share
        self.answer_link.visible = not share and bool(b.get("can_answer"))
        self.open_link.visible = not share and not b.get("can_answer")
        if b.get("can_answer"):
            state.set_attr(self.answer_link, "href", router.href("fight", "answer", b["id"]))
            self.answer_text.text = "Take it" if b["status"] == "open" else "Fight back"
        else:
            state.set_attr(self.open_link, "href", router.href("bout", b["id"]))
            self.open_text.text = "Scorecards" if b["status"] == "done" else "Open"

    @handle("share_button", "click")
    def share_button_click(self, **event_args):
        me = state.me() or {}
        ss.share(ss.invite_url(self.item["b"]["invite_token"]),
                 "%s called you out on Subsudo. One round, your phone or your camera." % (me.get("name") or "A friend"))
