import datetime

from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import ShellTemplate
from ... import auth, router, state

THEMES = ["auto", "light", "dark"]


class Shell(ShellTemplate):
    """The frame around every page: header (menu for members, Sign in / Get started for visitors), the account menu,
    the footer and the phone tab bar. Pages use it with <anvil-form layout="Subsudo.Layouts.Shell">.

    Anvil keeps ONE Shell while pages come and go (open_form only swaps the "content" slot when the layout matches),
    so everything that depends on who is signed in or which page is open is drawn in refresh(), which router.show()
    calls after every page change. Never only in __init__."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.copyright_label.text = "© %d Subsudo" % datetime.date.today().year
        self._outside = anvil.js.report_exceptions(self._close_menu_outside)
        self._keys = anvil.js.report_exceptions(self._key)
        self._poll_js = anvil.js.report_exceptions(self._poll)
        self._unread, self._page, self._last_poll, self._timer = 0, "", 0, None
        self.refresh("")

    def refresh(self, page):
        me = state.me()
        self.classes.update({"signed-in": bool(me), "signed-out": not me})
        self.member_actions.visible = bool(me)
        self.guest_actions.visible = not me and page != "auth"
        self.tabbar.visible = bool(me)
        self.menu.visible = False
        state.set_attr(self.brand, "href", "#home" if me else "#landing")
        self._page = page
        self._draw_nav()
        self.tab_profile.classes["on"] = page == "profile"
        if me:
            self.avatar_button.text = state.initials(me.get("name"))
            self.menu_name.text = me.get("name") or ""
            self.menu_email.text = me.get("email") or ""
            self.admin_link.visible = bool(me.get("is_admin"))
        self._show_theme()
        if not me:
            self._unread = 0
        elif window.Date.now() - self._last_poll > 20000:
            self._last_poll = window.Date.now()
            window.setTimeout(self._poll_js, 1200)  # after the page is drawn

    def _draw_nav(self):
        me = state.me()
        links = [{"page": p, "label": label, "icon": icon, "on": p == self._page, "dot": self._unread if p == "mail" else 0}
                 for p, label, icon in router.NAV] if me else []
        self.nav_panel.items = links
        self.tab_panel.items = links

    # ---- the red dot on Mail (unread messages), polled quietly
    def set_unread(self, n):
        """Pages that know the count (Mail) set it straight away."""
        n = int(n or 0)
        if n != self._unread:
            self._unread = n
            self._draw_nav()

    def _poll(self, *args):
        if not state.me() or window.document.hidden:
            return
        self._last_poll = window.Date.now()
        r = state.call_quiet("unread_count")
        if isinstance(r, dict):
            self.set_unread(r.get("total") or 0)

    # ---- account menu
    @handle("avatar_button", "click")
    def avatar_button_click(self, **event_args):
        self.menu.visible = not self.menu.visible

    def _close_menu_outside(self, event):
        if self.menu.visible and not event.target.closest(".anvil-role-avatar, .ui-menu .ui-seg"):
            self.menu.visible = False

    def _key(self, event):
        if event.key == "Escape":
            self.menu.visible = False

    @handle("", "show")
    def form_show(self, **event_args):
        window.document.addEventListener("click", self._outside, True)
        window.document.addEventListener("keydown", self._keys)
        if self._timer is None:
            self._timer = window.setInterval(self._poll_js, 60000)

    @handle("", "hide")
    def form_hide(self, **event_args):
        window.document.removeEventListener("click", self._outside, True)
        window.document.removeEventListener("keydown", self._keys)
        if self._timer is not None:
            window.clearInterval(self._timer)
            self._timer = None

    def theme_click(self, event):
        state.set_theme(event.currentTarget.getAttribute("data-theme-set"))
        self._show_theme()

    def _show_theme(self):
        t = state.theme()
        for name, el in zip(THEMES, [self.theme_auto, self.theme_light, self.theme_dark]):
            el.classes["on"] = name == t

    def feedback_click(self, event):
        self.menu.visible = False
        state.feedback()

    def sign_out_click(self, event):
        auth.sign_out()
        state.toast("Signed out. See you soon!")
        router.go("landing")
