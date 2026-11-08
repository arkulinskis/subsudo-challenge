from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import FindTemplate
from ... import ss, state

SCOPES = ("world", "city", "near")


class Find(FindTemplate):
    """#find (fighters to call out: world, your city or near your rating; search by name or city; open to fights only)
    and #find/calls (the open call-outs anyone can take). Calls: find_fighters. The filters are remembered in the
    browser ('find', same key as the JavaScript version)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.tab = "calls" if args and args[0] == "calls" else "fighters"
        st = ss.store_dict("find", {})
        self.st = {"scope": st.get("scope") if st.get("scope") in SCOPES else "world", "q": st.get("q") or "", "open": st.get("open", True) is not False}
        self.fighters_part.visible = self.tab == "fighters"
        self.calls_part.visible = self.tab == "calls"
        self.tab_fighters.classes["on"] = self.tab == "fighters"
        self.tab_calls.classes["on"] = self.tab == "calls"
        state.set_attr(self.tab_fighters if self.tab == "fighters" else self.tab_calls, "aria-current", "page")
        self.q_box.text = self.st["q"]
        self.open_box.checked = self.st["open"]
        state.set_control_attr(self.q_box, "aria-label", "Search by ring name or city")
        self._timer = None
        self._later = anvil.js.report_exceptions(self._typed)
        self.load()

    def load(self):
        d = state.call("find_fighters", self.st["q"] or None, self.st["scope"], self.st["open"])
        if not d:
            return
        self.n_calls.text = str(len(d["calls"]))
        self.calls.items = [{"b": b} for b in d["calls"]]
        self.no_calls.visible = not d["calls"]
        self.sc_city_label.text = d.get("my_city") or "My city"
        for name, el in zip(SCOPES, (self.sc_world, self.sc_city, self.sc_near)):
            el.classes["on"] = name == self.st["scope"]
        self.total.text = state.plural(d["total"], "fighter")
        self.city_note.visible = self.st["scope"] == "city" and not d.get("has_city")
        self.fighters.items = d["fighters"]
        self.no_fighters.visible = not d["fighters"]

    def _save(self):
        state.store_set("find", self.st)

    def scope_click(self, event):
        self.st["scope"] = event.currentTarget.getAttribute("data-scope")
        self._save()
        self.load()

    @handle("open_box", "change")
    def open_box_change(self, **event_args):
        self.st["open"] = bool(self.open_box.checked)
        self._save()
        self.load()

    @handle("q_box", "change")
    def q_box_change(self, **event_args):
        if self._timer is not None:
            window.clearTimeout(self._timer)
        self._timer = window.setTimeout(self._later, 350)

    @handle("q_box", "pressed_enter")
    def q_box_pressed_enter(self, **event_args):
        if self._timer is not None:
            window.clearTimeout(self._timer)
        self._typed()

    def _typed(self, *args):
        self._timer = None
        if (self.q_box.text or "") == self.st["q"]:
            return
        self.st["q"] = self.q_box.text or ""
        self._save()
        self.load()

    @handle("", "hide")
    def form_hide(self, **event_args):
        if self._timer is not None:
            window.clearTimeout(self._timer)
            self._timer = None
