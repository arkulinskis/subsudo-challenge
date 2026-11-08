from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import FightTemplate
from ... import router, ss, state

MODES = ("answer", "call", "open", "invite", "train")


class Fight(FightTemplate):
    """#fight/answer/<boutId>, #fight/call/<fighterId>, #fight/open, #fight/invite, #fight/train: every way to record a
    round. A short setup (words, a friend's name, city only), then Components/Recorder (the JS engine), then the server:
      answer -> answer_bout (the result is revealed here)    call -> create_challenge (demo fighters answer at once)
      open   -> create_open_call                             invite -> create_invite (share screen with the link)
      train  -> save_training (pads allowed)"""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.mode = args[0] if args and args[0] in MODES else "train"
        self.arg = args[1] if len(args) > 1 else None
        self.bout = ss.loose(None)
        self.fighter = ss.loose(None)
        self._url = self._msg = ""
        self._parts("setup")
        for p in (self.answer_head, self.call_head, self.plain_head, self.friend_field, self.city_only_box):
            p.visible = False
        state.set_control_attr(self.words_box, "maxlength", 280)
        state.set_control_attr(self.friend_box, "maxlength", 40)
        getattr(self, "_" + self.mode)()

    def _parts(self, which):
        for name, part in (("setup", self.setup_part), ("closed", self.closed_part), ("reveal", self.reveal_part),
                           ("sent", self.sent_part), ("trained", self.trained_part)):
            part.visible = name == which
        if which != "setup":
            self.recorder.stop()
            window.scrollTo(0, 0)

    def _plain(self, title, lead, words_placeholder=None):
        self.plain_head.visible = True
        self.title.text, self.lead.text = title, lead
        state.heading(self.title, 1)
        self.words_field.visible = words_placeholder is not None
        self.words_box.placeholder = words_placeholder or ""

    def _send(self, fn, *args):
        """A server call for a kept round: {"ok": False} -> toast + None (the recorder's summary stays for another try)."""
        return state.call(fn, *args)

    # ---- the five modes
    def _answer(self):
        r = state.call("get_bout", self.arg)
        if not r:
            self._closed("This bout doesn't exist or isn't yours.", None)
            return
        b = self.bout = r["bout"]
        if not b.get("can_answer"):
            self._closed(ss.status_text(b), b["id"])
            return
        who = ss.bout_name(b["a"])
        self.answer_head.visible = True
        self.answer_meta.text = "%s · %s-second round" % (b["kind_label"], b["secs"])
        self.answer_poster.bout = b
        words = b["a"].get("words")
        self.answer_words.text = "\u201c%s\u201d \u2014 %s" % (words, who) if words else ""
        self.answer_words.visible = bool(words)
        self.answer_note.text = "%s's score is sealed until you fight back. Give it everything." % who
        self.setup_card.visible = False
        self.recorder.start(self._keep_answer, secs=b["secs"], keep_label="Send my answer")

    def _keep_answer(self, rnd):
        res = self._send("answer_bout", self.bout["id"], rnd)
        if res:
            self._reveal(res["bout"])

    def _call(self):
        r = state.call("get_fighter", self.arg)
        if not r:
            self._closed("That fighter isn't here any more.", None)
            return
        f = self.fighter = r["fighter"]
        if f.get("me"):
            router.go("fight", "train")
            return
        self.call_head.visible = True
        self.call_av.fighter = f
        self.call_place.fighter = f
        self.call_ring.text = f["ring"]
        state.heading(self.call_ring, 1)
        self.call_tags.fighter = f
        self.call_line.text = "%s · %s" % (f["rating"], ss.record_text(f["record"]) + (" (%s KO)" % f["record"]["ko"] if f["record"].get("ko") else ""))
        self.words_box.placeholder = "Your city or mine. One round."
        self.recorder.start(self._keep_call, allow_secs=True, keep_label="Send the call-out")

    def _keep_call(self, rnd):
        res = self._send("create_challenge", self.fighter["id"], rnd, self.words_box.text or "")
        if not res:
            return
        if res["bout"]["status"] == "done":
            self._reveal(res["bout"])
        else:
            self._sent("Call-out sent", "Your round is sealed in %s's Mail. They have 7 days to fight back; the result lands in your Mail."
                       % self.fighter["ring"])

    def _open(self):
        me = state.me() or {}
        self._plain("Open call-out", "Record a round and pin it to the board. The first fighter who takes it fights your round. "
                    "Ranked, like any bout.", "Anyone. Any city.")
        self.city_only_box.visible = True
        self.city_only_box.text = "Only fighters from " + (me.get("city") or "my city")
        self.recorder.start(self._keep_open, allow_secs=True, keep_label="Post the call-out")

    def _keep_open(self, rnd):
        if self._send("create_open_call", rnd, self.words_box.text or "", bool(self.city_only_box.checked)):
            self._sent("Call-out posted", "It's on the board under Find, Open call-outs, for 7 days. You'll get the result in your Mail.")

    def _invite(self):
        self._plain("Invite a friend", "Record your round, get a link, send it. Your friend fights back from their own phone or laptop, "
                    "no account needed. You get points; it doesn't touch your rating.", "Loser buys the protein shakes.")
        self.friend_field.visible = True
        self.recorder.start(self._keep_invite, allow_secs=True, keep_label="Make the link")

    def _keep_invite(self, rnd):
        friend = (self.friend_box.text or "").strip()
        res = self._send("create_invite", rnd, self.words_box.text or "", friend)
        if not res:
            return
        url = ss.invite_url(res["token"])
        msg = "I just threw %s punches on Subsudo. Your turn: one round, your phone or your camera." % rnd["stats"]["punches"]
        self._url, self._msg = url, msg
        self._sent("Your link is ready", "Send it to %s. When they fight back, the result lands in your Mail." % (friend or "your friend"))
        self.share_part.visible = True
        self.link_box.text = url
        state.set_control_attr(self.link_box, "readonly", "")
        state.set_control_attr(self.link_box, "aria-label", "Invite link")
        enc = window.encodeURIComponent
        state.set_attr(self.wa_link, "href", "https://wa.me/?text=" + enc(msg + " " + url))
        state.set_attr(self.sms_link, "href", "sms:?&body=" + enc(msg + " " + url))
        state.set_attr(self.mail_link, "href", "mailto:?subject=" + enc("You've been called out") + "&body=" + enc(msg + "\n\n" + url))

    def _train(self):
        self._plain("Bag work", "A round just for you. Learn how the counting feels before a real bout. 1 point per round, up to 5 a day.")
        self.setup_card.visible = False
        self._train_again()

    def _train_again(self):
        self._parts("setup")
        self.recorder.start(self._keep_train, allow_secs=True, devices=("phone", "camera", "pads"), keep_label="Save the round")

    def _keep_train(self, rnd):
        res = self._send("save_training", rnd)
        if not res:
            return
        self._parts("trained")
        best = bool(res.get("personal_best"))
        self.trained_icon.classes["ic-trophy"] = best
        self.trained_icon.classes["ic-bag"] = not best
        self.trained_title.text = "Personal best!" if best else "Round saved"
        state.heading(self.trained_title, 1)
        self.trained_score.text = str(res["score"])
        s = res["stats"]
        self.trained_text.text = "%s punches · %s blocks · top %.1f m/s · best ever %s · %s" % (
            s["punches"], s["blocks"], s["top_speed"], res["best"],
            ("+%s point" % res["points"]) if res.get("points") else "no more training points today")
        if best:
            ss.bell(2)

    @handle("again_button", "click")
    def again_button_click(self, **event_args):
        self._train_again()

    # ---- the screens after a round
    def _closed(self, text, bout_id):
        self._parts("closed")
        self.closed_text.text = text
        self.closed_link.visible = bool(bout_id)
        if bout_id:
            state.set_attr(self.closed_link, "href", router.href("bout", bout_id))

    def _reveal(self, b):
        self._parts("reveal")
        self.reveal_poster.bout = b
        self.reveal_result.bout = b
        self.reveal_bars.bout = b
        state.set_attr(self.reveal_log, "href", router.href("bout", b["id"]))
        other = b["b"] if b.get("my_side") == "a" else b["a"]
        f = other.get("fighter")
        self.reveal_rematch.visible = bool(f and not f.get("me"))
        if f:
            state.set_attr(self.reveal_rematch, "href", router.href("fight", "call", f["id"]))
        if b.get("outcome") == "win":
            ss.bell(3)
            ss.say("Knockout!" if b["result"].get("method") == "ko" else "Winner!")

    def _sent(self, title, text):
        self._parts("sent")
        self.sent_title.text, self.sent_text.text = title, text
        state.heading(self.sent_title, 1)
        self.share_part.visible = False

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        ss.copy(self._url)

    @handle("native_button", "click")
    def native_button_click(self, **event_args):
        ss.share(self._url, self._msg)
