from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import AdminTemplate
from ... import state

TABS = ["overview", "challenges", "log", "feedback", "users", "demo"]
CSV_COLS = ["id", "created", "finished", "kind", "status", "a", "b", "a_device", "b_device", "a_score", "b_score", "a_punches",
            "b_punches", "winner", "method", "city", "flags", "demo"]


class Admin(AdminTemplate):
    """#admin/<tab> (admins only): overview counts; house challenges (a bout from a house fighter to everyone / idle members
    / people who never fought / a city / picked fighters, with a points bonus; cancel); the fight log (every bout, both
    devices, scores, method, flags; CSV); the old feedback inbox; users (admin / active switches); demo data.
    Each tab is its own address, so the browser's back button works."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.tab = args[0] if args and args[0] in TABS else "overview"
        self._filter = "new"
        self._picked, self._log_rows = [], []
        self._aud_timer = self._member_timer = None
        self._count_later = anvil.js.report_exceptions(self._count_audience)
        self._find_later = anvil.js.report_exceptions(self._find_members)
        parts = {"overview": self.overview_part, "challenges": self.challenges_part, "log": self.log_part,
                 "feedback": self.feedback_part, "users": self.users_part, "demo": self.demo_part}
        tabs = {"overview": self.tab_overview, "challenges": self.tab_challenges, "log": self.tab_log,
                "feedback": self.tab_feedback, "users": self.tab_users, "demo": self.tab_demo}
        for name in TABS:
            parts[name].visible = name == self.tab
            tabs[name].classes["on"] = name == self.tab
            if name == self.tab:
                state.set_attr(tabs[name], "aria-current", "page")
        self.feedback_panel.add_event_handler("x-changed", self._feedback_changed)
        self.campaigns.add_event_handler("x-changed", self._campaigns_changed)
        self.found.add_event_handler("x-pick", self._pick)
        self.picked.add_event_handler("x-unpick", self._unpick)
        getattr(self, "_" + self.tab)()

    # ---- overview
    def _overview(self):
        d = state.call("admin_overview")
        if not d:
            return
        self.s_users.text, self.s_admins.text = str(d["users"]), str(d["admins"])
        self.s_admins_label.text = "admin" if d["admins"] == 1 else "admins"
        self.s_feedback.text, self.s_fights.text, self.s_waiting.text = str(d["feedback_new"]), str(d["fights"]), str(d["waiting"])
        self.s_rounds.text, self.s_flagged.text, self.s_campaigns.text = str(d["rounds"]), str(d["flagged"]), str(d["campaigns"])
        self.demo_line.text = "Demo data is %s (%d demo people). Manage it in the Demo data tab." % (
            d["demo"]["state"], d["demo"]["counts"].get("users", 0))

    # ---- house challenges
    def _challenges(self):
        d = state.call("admin_campaigns")
        if not d:
            return
        if not self.c_house.items:
            self.c_house.items = d["house_fighters"]
            self.c_house.selected_value = d["house_fighters"][0] if d["house_fighters"] else None
            self.c_level.items = [("%s · ~%s/min, %s m/s" % (l["name"], l["ppm"], l["speed"]), l["key"]) for l in d["levels"]]
            self.c_level.selected_value = "club" if any(l["key"] == "club" for l in d["levels"]) else None
            self.c_secs.items = [("30 seconds", 30), ("60 seconds", 60), ("90 seconds", 90)]
            self.c_secs.selected_value = 60
            self.city_key.items = [("%s (%s)" % (c["city"], c["fighters"]), c["key"]) for c in d["cities"]]
            for box, label in ((self.c_house, "House fighter"), (self.c_level, "How hard they hit"), (self.c_secs, "Round"),
                               (self.city_key, "City"), (self.idle_days, "Days without a bout"), (self.member_box, "Find members")):
                state.set_control_attr(box, "aria-label", label)
            for rb in (self.a_all, self.a_idle, self.a_never, self.a_city, self.a_picked):
                rb.add_event_handler("change", self._aud_changed)
        self.campaigns.items = d["campaigns"]
        self.no_campaigns.visible = not d["campaigns"]
        self._aud_changed()

    def _aud_type(self):
        for rb in (self.a_all, self.a_idle, self.a_never, self.a_city, self.a_picked):
            if rb.selected:
                return rb.value
        return "all"

    def _audience(self):
        t = self._aud_type()
        a = {"type": t}
        if t == "idle":
            try:
                a["days"] = int(self.idle_days.text or 14)
            except (TypeError, ValueError):
                a["days"] = 14
        if t == "city":
            a["city_key"] = self.city_key.selected_value
        if t == "picked":
            a["ids"] = [p["id"] for p in self._picked]
        return a

    def _aud_changed(self, **event_args):
        self.pick_part.visible = self._aud_type() == "picked"
        self.picked.items = [{"m": p, "picked": True} for p in self._picked]
        if self._aud_timer is not None:
            window.clearTimeout(self._aud_timer)
        self._aud_timer = window.setTimeout(self._count_later, 200)

    @handle("idle_days", "change")
    def idle_days_change(self, **event_args):
        self._aud_changed()

    @handle("city_key", "change")
    def city_key_change(self, **event_args):
        self._aud_changed()

    def _count_audience(self, *args):
        self._aud_timer = None
        r = state.call_quiet("admin_audience", self._audience())
        if not isinstance(r, dict):
            return
        self.aud_count.text = state.plural(r["count"], "fighter")
        self.aud_sample.text = ", ".join(r["sample"]) + ("…" if r["count"] > len(r["sample"]) else "")
        self.aud_sample.visible = bool(r["sample"])
        self.send_button.enabled = bool(r["count"])
        self.send_button.text = "Send to " + state.plural(r["count"], "fighter")

    @handle("member_box", "change")
    def member_box_change(self, **event_args):
        if self._member_timer is not None:
            window.clearTimeout(self._member_timer)
        self._member_timer = window.setTimeout(self._find_later, 250)

    def _find_members(self, *args):
        self._member_timer = None
        r = state.call_quiet("admin_find_members", self.member_box.text or "")
        if isinstance(r, dict):
            self.found.items = [{"m": m, "picked": False} for m in r["members"]]

    def _pick(self, member, **event_args):
        if not any(p["id"] == member["id"] for p in self._picked):
            self._picked.append({"id": member["id"], "ring": member["ring"]})
        self._aud_changed()

    def _unpick(self, member, **event_args):
        self._picked = [p for p in self._picked if p["id"] != member["id"]]
        self._aud_changed()

    def _campaigns_changed(self, **event_args):
        self._challenges()

    @handle("send_button", "click")
    def send_button_click(self, **event_args):
        v = {"title": (self.c_title.text or "").strip(), "house_name": self.c_house.selected_value, "level": self.c_level.selected_value,
             "secs": self.c_secs.selected_value, "bonus": self.c_bonus.text, "days": self.c_days.text,
             "message": self.c_message.text or "", "audience": self._audience()}
        if not confirm("Each fighter in the audience gets a bout from %s in their Mail." % v["house_name"], title='Send "%s"?' % v["title"],
                       buttons=[("Cancel", False), ("Send it", True)], role="app-dialog"):
            return
        r = state.call("admin_send_campaign", v)
        if r:
            state.toast("Sent to " + state.plural(r["sent"], "fighter"), "ok")
            self._picked = []
            self._challenges()

    # ---- fight log
    def _log(self):
        if not self.log_status.items:
            self.log_status.items = [("Any status", "")] + [(s, s) for s in ["done", "pending", "open", "declined", "cancelled", "expired"]]
            self.log_kind.items = [("Any kind", "")] + [(k, k) for k in ["ranked", "open", "invite", "house"]]
            state.set_control_attr(self.log_status, "aria-label", "Status")
            state.set_control_attr(self.log_kind, "aria-label", "Kind")
            state.set_control_attr(self.log_q, "aria-label", "Fighter name")
        d = state.call("admin_fight_log", self.log_q.text or None, self.log_status.selected_value or None, self.log_kind.selected_value or None)
        if not d:
            return
        self._log_rows = d["fights"]
        self.log_rows.items = d["fights"]
        self.log_count.text = "%s · %s rounds in all" % (state.plural(d["total"], "bout"), d["rounds"])

    @handle("log_button", "click")
    def log_button_click(self, **event_args):
        self._log()

    @handle("log_q", "pressed_enter")
    def log_q_pressed_enter(self, **event_args):
        self._log()

    @handle("csv_button", "click")
    def csv_button_click(self, **event_args):
        def q(v):
            v = "" if v is None else "; ".join(str(x) for x in v) if isinstance(v, list) else str(v)
            return '"' + v.replace('"', '""') + '"' if any(ch in v for ch in ',"\n') else v
        text = ",".join(CSV_COLS) + "\n" + "\n".join(",".join(q(r.get(c)) for c in CSV_COLS) for r in self._log_rows)
        media = BlobMedia("text/csv", text.encode("utf-8"), name="subsudo-fights-%s.csv" % str(window.Date().toISOString())[:10])
        download(media)

    # ---- feedback
    def _feedback(self):
        d = state.call("list_feedback", None)
        if not d:
            return
        items = [i for i in d["items"] if self._filter == "all" or i["status"] == self._filter]
        self.feedback_panel.items = items
        self.no_feedback.visible = not items
        labels = {"new": "New", "read": "Read", "done": "Done", "all": "All"}
        for key, el in (("new", self.f_new), ("read", self.f_read), ("done", self.f_done), ("all", self.f_all)):
            n = len(d["items"]) if key == "all" else d["counts"].get(key, 0)
            el.text = "%s (%d)" % (labels[key], n)
            el.role = ["seg", "on"] if key == self._filter else ["seg"]

    def _set_filter(self, value):
        self._filter = value
        self._feedback()

    @handle("f_new", "click")
    def f_new_click(self, **event_args):
        self._set_filter("new")

    @handle("f_read", "click")
    def f_read_click(self, **event_args):
        self._set_filter("read")

    @handle("f_done", "click")
    def f_done_click(self, **event_args):
        self._set_filter("done")

    @handle("f_all", "click")
    def f_all_click(self, **event_args):
        self._set_filter("all")

    def _feedback_changed(self, **event_args):
        self._feedback()

    # ---- users
    def _users(self, query=None):
        d = state.call("list_users", query or None)
        if not d:
            return
        self.users_panel.items = d["users"]
        self.users_count.text = state.plural(d["total"], "person", "people")

    @handle("search_box", "pressed_enter")
    def search_box_pressed_enter(self, **event_args):
        self._users(self.search_box.text)

    @handle("search_button", "click")
    def search_button_click(self, **event_args):
        self._users(self.search_box.text)

    # ---- demo data
    def _demo(self):
        d = state.call("admin_overview")
        if not d:
            return
        d = d["demo"]
        counts = ", ".join("%s %s" % (v, k) for k, v in d["counts"].items())
        self.demo_status.text = "Status: %s · %s" % (d["state"], counts)
        self.demo_load_button.text = "Reload demo data" if d["state"] == "loaded" else "Load demo data"

    @handle("demo_load_button", "click")
    def demo_load_button_click(self, **event_args):
        if confirm("Demo people and content are added (any old demo rows are replaced).", title="Load the demo data?",
                   buttons=[("Cancel", False), ("Load", True)], role="app-dialog"):
            if state.call("demo_load") is not None:
                state.toast("Done", "ok")
                self._demo()

    @handle("demo_remove_button", "click")
    def demo_remove_button_click(self, **event_args):
        if confirm("Every demo row is deleted. Real data stays.", title="Remove the demo data?",
                   buttons=[("Cancel", False), ("Remove", True)], role="app-dialog"):
            if state.call("demo_remove") is not None:
                state.toast("Done", "ok")
                self._demo()

    @handle("", "hide")
    def form_hide(self, **event_args):
        for t in (self._aud_timer, self._member_timer):
            if t is not None:
                window.clearTimeout(t)
