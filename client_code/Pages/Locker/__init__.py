from anvil import *
from anvil.js import window

from ._anvil_designer import LockerTemplate
from ... import ss, state

GROUPS = [("g_head", ["skin", "face", "marks"]), ("g_hair", ["hair", "hairColor", "brows", "beard"]),
          ("g_face", ["eyes", "eyeColor", "nose", "mouth"]), ("g_kit", ["headgear", "outfit", "kit", "gloves", "pose", "bg"])]
HURTS = {"none": None, "fresh": {"level": 1.7, "age": 1, "hours_left": 23, "label": "Bruised"},
         "war": {"level": 3.3, "age": 2, "hours_left": 22, "label": "Battered"},
         "ko": {"level": 3.8, "age": 0.5, "hours_left": 24, "ko": True, "label": "Battered"},
         "heal": {"level": 1.2, "age": 17, "hours_left": 7, "label": "Bruised"}}


class Locker(LockerTemplate):
    """#locker: the avatar builder. A big mirror with the live portrait (the JS face engine), a row per part with ‹ ›
    arrows (← → on a focused row), grouped Head / Hair / Face / Kit; the glove colour is a row too. Random, a damage
    preview (now / fresh / bout today / after a war / knocked out / healing) and Save. Calls: get_fighter, update_avatar.
    The part names and colours come from the engine (SS.AVATAR), so they always match the drawing."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.prev, self.dirty = "now", False
        self.gloves = [str(k) for k in window.Object.keys(window.SS.GLOVES)]
        r = state.call("get_fighter", state.me()["id"])
        if not r:
            return
        self.f = r["fighter"]
        self.spec = dict(self.f.get("avatar") or ss.py(window.SS.defaultFace(self.f["id"])))
        self.glove = self.f.get("glove") or "oxblood"
        self.plate_ring.text = self.f["ring"]
        self.plate_place.fighter = self.f
        self.plate_rating.text = " · %s" % self.f["rating"]
        self.panels = {}
        for panel_name, keys in GROUPS:
            panel = getattr(self, panel_name)
            panel.items = [self._row(k) for k in keys]
            panel.add_event_handler("x-step", self._step)
            self.panels[panel_name] = panel
        self._mirror()

    def _part(self, key):
        if key == "gloves":
            return {"label": "Gloves", "names": [str(window.SS.GLOVE_NAMES[g]) for g in self.gloves],
                    "colors": [str(window.SS.GLOVES[g]) for g in self.gloves]}
        p = window.SS.AVATAR[key]
        colors = p.colors if "colors" in window.Object.keys(p) else None
        return {"label": str(p.label), "names": [str(n) for n in p.names], "colors": [str(c) for c in colors] if colors else None}

    def _value(self, key):
        if key == "gloves":
            return self.gloves.index(self.glove) if self.glove in self.gloves else 0
        return int(self.spec.get(key) or 0)

    def _row(self, key):
        p = self._part(key)
        p.update({"key": key, "value": self._value(key)})
        return p

    def _rows(self):
        for panel in self.panels.values():
            for c in panel.get_components():
                yield c

    def _step(self, key, d, **event_args):
        n = len(self._part(key)["names"])
        v = (self._value(key) + d) % n
        if key == "gloves":
            self.glove = self.gloves[v]
        else:
            self.spec[key] = v
        self.dirty = True
        for c in self._rows():
            if c.item["key"] == key:
                c.show(v)
        self._mirror()

    def _hurt(self):
        return self.f.get("hurt") if self.prev == "now" else HURTS[self.prev]

    def _mirror(self):
        h = self._hurt()
        self.mirror.fighter = {"id": self.f["id"], "avatar": self.spec, "glove": self.glove, "hurt": h}
        if self.prev == "now":
            self.hurt_note.text = (ss.hurt_text(h) + ". Bruises fade over 24 hours after a bout.") if h else \
                "No marks right now. Every bout leaves some for 24 hours."
        elif h:
            what = "knocked out minutes ago" if h.get("ko") else ("a bout %s hours ago, healing" % h["age"]) if h["age"] > 12 else "just after a bout"
            self.hurt_note.text = "Preview: %s." % what
        else:
            self.hurt_note.text = "Preview: no marks."
        for name, el in (("now", self.pv_now), ("none", self.pv_none), ("fresh", self.pv_fresh), ("war", self.pv_war),
                         ("ko", self.pv_ko), ("heal", self.pv_heal)):
            el.classes["on"] = name == self.prev
        self.save_button.enabled = self.dirty

    def prev_click(self, event):
        self.prev = event.currentTarget.getAttribute("data-prev")
        self._mirror()

    @handle("random_button", "click")
    def random_button_click(self, **event_args):
        self.spec = ss.py(window.SS.defaultFace(str(window.Math.random())))
        self.glove = self.gloves[int(window.Math.floor(window.Math.random() * len(self.gloves)))]
        self.dirty = True
        for c in self._rows():
            c.show(self._value(c.item["key"]))
        self._mirror()

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        r = state.call("update_avatar", self.spec, self.glove)
        if r:
            self.f.update(r["fighter"])
            self.dirty = False
            self._mirror()
            state.toast("Looking sharp. Saved.", "ok")
