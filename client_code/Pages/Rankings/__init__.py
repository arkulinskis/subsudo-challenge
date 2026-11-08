from anvil import *

from ._anvil_designer import RankingsTemplate
from ... import router, ss, state


class Rankings(RankingsTemplate):
    """#rankings, #rankings/city[/<city_key>], #rankings/week: the boards. World and city rank by rating (Elo) among
    fighters with enough ranked bouts lately; "This week" ranks by points earned in 7 days. A podium for the top 3,
    your own row highlighted, or what it takes to get on the board. Calls: get_rankings (public)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.scope = args[0] if args and args[0] in ("city", "week") else "world"
        city_key = args[1] if len(args) > 1 else None
        for name, el in (("world", self.tab_world), ("city", self.tab_city), ("week", self.tab_week)):
            el.classes["on"] = name == self.scope
            if name == self.scope:
                state.set_attr(el, "aria-current", "page")
        self.lead.text = ("Points earned in the last 7 days: bouts, house challenges and bag work." if self.scope == "week"
                          else "By rating. Win against stronger fighters to climb faster.")
        d = state.call("get_rankings", self.scope, city_key)
        if d:
            self._draw(d)

    def _draw(self, d):
        me = state.me()
        self.city_bar.visible = self.scope == "city"
        if self.scope == "city":
            opts = [("Pick a city…", "")] + [("%s%s (%s)" % (c["city"], ", " + ss.country(c["country"]) if c.get("country") else "", c["fighters"]), c["key"])
                                            for c in d.get("cities") or []]
            self.city_pick.items = opts
            self.city_pick.selected_value = (d.get("city") or {}).get("key") or ""
            state.set_control_attr(self.city_pick, "aria-label", "City")
            name = (d.get("city") or {}).get("name")
            self.city_belt.visible = bool(name)
            self.city_belt.text = "%s belt" % name if name else ""
        rows = d.get("rows") or []
        need_city = self.scope == "city" and bool(d.get("need_city"))
        self.need_city.visible = need_city
        self.need_city_text.text = "Pick one above" + (", or add yours to your fighter card." if me else ".")
        self.empty.visible = not need_city and not rows
        self.empty_text.text = ("No points earned this week yet." if self.scope == "week"
                                else "Nobody here has %s ranked bouts yet. The belt is up for grabs." % d.get("min_fights", 3))
        show = rows and not need_city
        top = len(rows) >= 3 and show
        self.podium.visible = bool(top)
        self.podium.items = [{"r": r, "i": r["rank"] - 1} for r in [rows[1], rows[0], rows[2]]] if top else []
        unit = "pts" if self.scope == "week" else "rating"
        self.rows.items = [{"r": r, "unit": unit, "tier": self.scope != "week"} for r in (rows[3:] if top else rows)] if show else []
        self.mine_note.visible = bool(me and not d.get("me") and d.get("my_status"))
        self.mine_text.text = "You're not on this board yet: %s." % (d.get("my_status") or "")
        self.how_board.text = "You appear on the boards after %s ranked bouts, and stay while you fought in the last %s days." % (
            d.get("min_fights", 3), d.get("active_days") or 120)
        self.tiers.items = list(reversed(d.get("tiers") or []))

    @handle("city_pick", "change")
    def city_pick_change(self, **event_args):
        if self.city_pick.selected_value:
            router.go("rankings", "city", self.city_pick.selected_value)
