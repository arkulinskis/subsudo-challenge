from anvil import *

from ._anvil_designer import TagsTemplate
from ... import ss, state


class Tags(TagsTemplate):
    """Tier badge (Champion, Contender ...), the belts a fighter holds, and today's bout damage ('Bruised · 20h to heal')."""

    def __init__(self, **properties):
        self._fighter, self._tier, self._ready = None, True, False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready:
            return
        f = self._fighter or {}
        self.tier_label.visible = bool(self._tier and f.get("tier"))
        self.tier_label.text = f.get("tier") or ""
        self.tier_label.role = ["tier", ss.tier_role(f.get("tier"))]
        self.belts.items = [{"text": ss.belt_text(b)} for b in (f.get("belts") or [])]
        h = f.get("hurt")
        self.hurt_box.visible = bool(h)
        if h:
            heal = h.get("age", 0) >= 14
            self.hurt.text = ss.hurt_text(h)
            self.hurt_box.classes["heal"] = heal
            self.hurt_icon.classes["ic-heart"] = heal
            self.hurt_icon.classes["ic-bolt"] = not heal
            state.set_attr(self.hurt_box, "title", "From a bout %dh ago" % round(h.get("age", 0)))

    @property
    def fighter(self):
        return self._fighter

    @fighter.setter
    def fighter(self, value):
        self._fighter = value
        self._draw()

    @property
    def tier(self):
        return self._tier

    @tier.setter
    def tier(self, value):
        self._tier = bool(value)
        self._draw()
