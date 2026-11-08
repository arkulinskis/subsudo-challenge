from anvil import *
from anvil.js import window

from ._anvil_designer import ProfileTemplate
from ... import auth, router, ss, state


class Profile(ProfileTemplate):
    """#profile: your fighter card (ring name, city + country, stance, gloves, a line for opponents, open to fights) with
    a live preview, then the account: name, light/dark, sounds, password reset, Privacy & Terms, feedback, sign out.
    Calls: get_fighter (prefill), update_fighter, update_profile."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.card = {}
        self.stance, self.glove = "orthodox", "oxblood"
        for box, n in ((self.ring_box, 30), (self.city_box, 40), (self.bio_box, 160), (self.name_box, 60)):
            state.set_control_attr(box, "maxlength", n)
        state.set_control_attr(self.city_box, "autocomplete", "address-level2")
        state.set_control_attr(self.name_box, "autocomplete", "name")
        codes = [str(c) for c in window.SS.COUNTRY_CODES]
        names = sorted([(ss.country(c), c) for c in codes], key=lambda x: x[0])
        self.country_box.items = [("Country…", "")] + names
        self.gloves.add_event_handler("x-glove", self._pick_glove)
        p = ss.prefs()
        self.sound_box.checked, self.voice_box.checked, self.music_box.checked = p["sound"], p["voice"], p["music"]
        self._show_me()
        self._show_theme()
        r = state.call("get_fighter", state.me()["id"])
        if r:
            self._fill(r["fighter"])

    def _show_me(self):
        me = state.me()
        joined = state.month_year(me.get("joined"))
        self.email_line.text = (me.get("email") or "") + (" · member since " + joined if joined else "")
        self.name_box.text = me.get("name") or ""
        self.admin_link.visible = bool(me.get("is_admin"))

    def _fill(self, f):
        self.card = f
        me = state.me()
        has_card = bool(f.get("city")) or f["ring"] != f["name"]
        self.head_av.fighter = f
        self.ring_title.text = f["ring"]
        state.heading(self.ring_title, 1)
        state.set_attr(self.public_link, "href", router.href("fighter", f["id"]))
        self.ring_box.text = f["ring"] if has_card else ""
        self.city_box.text = f.get("city") or ""
        self.country_box.selected_value = f.get("country") or ""
        state.set_control_attr(self.country_box, "aria-label", "Country")
        self.stance = f.get("stance") or "orthodox"
        self.glove = f.get("glove") or "oxblood"
        self.bio_box.text = f.get("bio") or ""
        self.open_box.checked = bool(f.get("open"))
        self._preview()

    def _values(self):
        return {"ring_name": (self.ring_box.text or "").strip(), "city": (self.city_box.text or "").strip(),
                "country": self.country_box.selected_value or "", "stance": self.stance, "glove": self.glove,
                "bio": (self.bio_box.text or "").strip(), "open": bool(self.open_box.checked)}

    def _preview(self):
        v, me = self._values(), state.me()
        f = {"ring": v["ring_name"] or me.get("name"), "glove": v["glove"], "city": v["city"], "country": v["country"],
             "id": self.card.get("id"), "avatar": self.card.get("avatar"), "hurt": self.card.get("hurt")}
        self.prev_av.fighter = f
        self.prev_ring.text = f["ring"] or ""
        self.prev_place.fighter = f
        self.prev_stance.text = v["stance"]
        self.prev_bio.text = "\u201c%s\u201d" % v["bio"] if v["bio"] else ""
        self.prev_bio.visible = bool(v["bio"])
        self.st_orthodox.classes["on"] = self.stance == "orthodox"
        self.st_southpaw.classes["on"] = self.stance == "southpaw"
        names = window.SS.GLOVE_NAMES
        self.gloves.items = [{"key": str(g), "name": str(names[g]), "on": str(g) == self.glove} for g in window.Object.keys(window.SS.GLOVES)]

    @handle("ring_box", "change")
    def ring_box_change(self, **event_args):
        self._preview()

    @handle("city_box", "change")
    def city_box_change(self, **event_args):
        self._preview()

    @handle("bio_box", "change")
    def bio_box_change(self, **event_args):
        self._preview()

    @handle("country_box", "change")
    def country_box_change(self, **event_args):
        self._preview()

    def stance_click(self, event):
        self.stance = event.currentTarget.getAttribute("data-st")
        self._preview()

    def _pick_glove(self, key, **event_args):
        focused = state.focus_key()
        self.glove = key
        self._preview()
        state.refocus(self.gloves, focused)

    @handle("save_card_button", "click")
    def save_card_button_click(self, **event_args):
        r = state.call("update_fighter", self._values())
        if r:
            state.toast("Fighter card saved", "ok")
            self.ring_title.text = r["fighter"]["ring"]
            self.card.update(r["fighter"])
            self.head_av.fighter = self.card

    @handle("name_box", "pressed_enter")
    def name_box_pressed_enter(self, **event_args):
        self.save_name_button_click()

    @handle("save_name_button", "click")
    def save_name_button_click(self, **event_args):
        name = (self.name_box.text or "").strip()
        if len(name) < 2:
            state.toast("Please tell us your name.", "error")
            return
        r = state.call("update_profile", name)
        if r:
            state.set_me(r["me"])
            self._show_me()
            self._preview()
            state.toast("Saved", "ok")

    def _show_theme(self):
        t = state.theme()
        for name, el in (("auto", self.theme_auto), ("light", self.theme_light), ("dark", self.theme_dark)):
            el.classes["on"] = name == t

    def theme_click(self, event):
        state.set_theme(event.currentTarget.getAttribute("data-theme-pick"))
        self._show_theme()
        shell = getattr(self, "layout", None)
        if shell is not None and hasattr(shell, "refresh"):
            shell.refresh("profile")

    @handle("sound_box", "change")
    def sound_box_change(self, **event_args):
        ss.set_pref("sound", self.sound_box.checked)

    @handle("voice_box", "change")
    def voice_box_change(self, **event_args):
        ss.set_pref("voice", self.voice_box.checked)

    @handle("music_box", "change")
    def music_box_change(self, **event_args):
        ss.set_pref("music", self.music_box.checked)

    @handle("reset_button", "click")
    def reset_button_click(self, **event_args):
        r = auth.reset(state.me()["email"])
        state.toast(r["message"], "ok")

    def feedback_click(self, event):
        state.feedback()

    def sign_out_click(self, event):
        auth.sign_out()
        state.toast("Signed out. See you soon!")
        router.go("landing")
