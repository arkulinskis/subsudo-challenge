from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import TryTemplate
from ... import router, ss, state


class Try(TryTemplate):
    """#try (Persuade, anyone): one round with no account. The safe-swing card, then Components/Recorder (phone, camera
    or pads; 30 s by default), then try_round (public: scored with the ref and judged against the house at Rookie,
    Club, Pro and Champion; it writes nothing). The round stays in this browser (storage 'try_round', 24 hours):
    after sign-up Pages/Home saves it once as bag work, and #fight/invite offers it as a ready call-out (phone or
    camera rounds). Signed-in visitors can save it straight away."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.rnd = ss.loose(None)
        self.res = ss.loose(None)
        self._show("setup")
        waiting = ss.try_round_saved()
        self.waiting.visible = bool(waiting and not state.me() and not waiting.get("claimed"))
        if self.waiting.visible:
            self.waiting.text = "Your last try-out round (%s points) is waiting in this browser. Sign up and it goes on your record." % (
                waiting.get("score", 0))
        self._start()

    def _show(self, which):
        self.setup_part.visible = which == "setup"
        self.result_part.visible = which == "result"
        if which != "setup":
            self.recorder.stop()
            window.scrollTo(0, 0)

    def _start(self):
        self._show("setup")
        self.recorder.start(self._keep, secs=30, allow_secs=True, devices=("phone", "camera", "pads"), keep_label="See my score")

    def _keep(self, rnd):
        r = state.call("try_round", {"device": rnd.get("device"), "secs": rnd.get("secs"), "events": rnd.get("events") or []})
        if not r:
            return
        self.rnd, self.res = rnd, r
        state.store_set(ss.TRY_KEY, {"round": {"device": rnd.get("device"), "secs": rnd.get("secs"), "events": rnd.get("events") or []},
                                        "at": window.Date.now(), "score": r["score"], "punches": r["stats"]["punches"],
                                        "device": r["device"], "claimed": False, "invited": False})
        self._result(r)

    def _result(self, r):
        self._show("result")
        s = r["stats"]
        self.score_label.text = "Your round · %s seconds · %s" % (r["secs"], {"phone": "phone", "camera": "camera"}.get(r["device"], "pads"))
        self.score.text = str(r["score"])
        state.heading(self.score, 1)
        self.stats_line.text = "%s punches · %s blocks · %s combos · top %.1f m/s" % (s["punches"], s["blocks"], s["combos"], s["top_speed"])
        ref = r.get("ref") or {}
        self.ref_line.text = ref.get("line") or ""
        self.ref_line.role = ["ss-ref-line", "fg-ref", "ref-" + (ref.get("verdict") or "none")]
        self.house.items = r["house"]
        self.verdict.text = r["verdict"]
        state.live(self.verdict)
        self.pads_note.visible = r["device"] == "pads"
        me = state.me()
        real = r["device"] in ("phone", "camera")
        self.guest_next.visible = not me
        self.member_next.visible = bool(me)
        self.friend_button.visible = real
        self.member_friend_button.visible = real
        if any(h.get("beat") for h in r["house"]):
            ss.bell(2)

    @handle("join_button", "click")
    def join_button_click(self, **event_args):
        router.remember_after("#home")  # the gym page saves the round as bag work
        router.go("auth", "signup")

    @handle("friend_button", "click")
    def friend_button_click(self, **event_args):
        router.remember_after("#fight/invite")  # after sign-up: the invite page offers this round as the call-out
        router.go("auth", "signup")

    @handle("member_friend_button", "click")
    def member_friend_button_click(self, **event_args):
        router.go("fight", "invite")

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        t = ss.try_round_saved()
        if not t or t.get("claimed"):
            state.toast("This round is already in your bag work.", "ok")
            return
        ss.try_round_mark(claimed=True)
        res = state.call("save_training", t["round"])
        if res:
            state.toast("+%s point: saved to your bag work" % res["points"] if res.get("points") else "Saved to your bag work", "ok")
            self.save_button.enabled = False

    @handle("again_button", "click")
    def again_button_click(self, **event_args):
        self._start()
