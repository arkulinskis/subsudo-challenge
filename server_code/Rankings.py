"""Rankings: by rating (Elo) worldwide and per city, and by points earned this week.

Who is ranked: at least B.PROVISIONAL_FIGHTS ranked bouts, the last one within B.ACTIVE_DAYS, account active.
Ties: more wins first. #1 in the world holds the World belt; #1 in each city holds that city's belt.
"""
import datetime as dt

import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Boxing as B
from . import Fighters as F

SCOPES = ("world", "city", "week")


@anvil.server.callable
def get_rankings(scope="world", city_key=None):
    from . import DemoData
    DemoData.ensure_loaded()
    me = C.me()
    scope = scope if scope in SCOPES else "world"
    rows = F.ranked_rows()
    bm = F.belts(rows)
    key = city_key or (me["city_key"] if me is not None else None)
    city_name = None
    out = []
    if scope == "week":
        since = C.now() - dt.timedelta(days=7)
        totals = {}
        for p in app_tables.points_log.search():
            if p["created"] is not None and p["created"] >= since and F.active(p["user"]):
                t = totals.setdefault(p["user"].get_id(), [p["user"], 0])
                t[1] += p["points"] or 0
        ordered = sorted(totals.values(), key=lambda t: -t[1])
        for i, (u, pts) in enumerate(ordered):
            out.append({"rank": i + 1, "fighter": F.fighter(u, me, bm), "value": int(pts)})
    else:
        if scope == "city":
            if not key:
                return {"scope": scope, "rows": [], "me": None, "city": None, "cities": F.list_cities(),
                        "min_fights": B.PROVISIONAL_FIGHTS, "need_city": True}
            rows = [u for u in rows if u["city_key"] == key]
            any_u = app_tables.users.search(city_key=key)
            city_name = any_u[0]["city"] if len(any_u) else None
        for i, u in enumerate(rows):
            out.append({"rank": i + 1, "fighter": F.fighter(u, me, bm), "value": F.rating_of(u)})
    mine = next((r for r in out if r["fighter"]["me"]), None)
    my_status = None
    if me is not None and mine is None and scope != "week":
        n = me["ranked_fights"] or 0
        my_status = ("%d more ranked bout%s to get ranked" % (B.PROVISIONAL_FIGHTS - n, "" if B.PROVISIONAL_FIGHTS - n == 1 else "s")
                     if n < B.PROVISIONAL_FIGHTS else "Fight a ranked bout to get back in the rankings")
    return {"scope": scope, "rows": out[:100], "total": len(out), "me": mine, "my_status": my_status,
            "city": {"key": key, "name": city_name} if scope == "city" else None,
            "cities": F.list_cities()[:40], "min_fights": B.PROVISIONAL_FIGHTS, "active_days": B.ACTIVE_DAYS,
            "tiers": [{"name": n, "from": f} for f, n in B.TIERS]}
