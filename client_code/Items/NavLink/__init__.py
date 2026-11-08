from anvil import *

from ._anvil_designer import NavLinkTemplate
from ... import router, state


class NavLink(NavLinkTemplate):
    """A main-menu link (header and phone tab bar). item = {page, label, icon, on} from router.NAV."""

    def __init__(self, **properties):
        super().__init__(**properties)
        state.set_attr(self, "href", router.href(self.item["page"]))
        self.icon.classes.add("ic-" + self.item["icon"])
        self.classes["on"] = bool(self.item.get("on"))
        n = self.item.get("dot") or 0
        self.dot_box.visible = n > 0
        self.dot.text = "9+" if n > 9 else str(n)
        state.set_attr(self.dot_box, "aria-label", "%d new" % n if n else None)
