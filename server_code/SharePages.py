"""Share links for finished bouts: https://subsudo.com/b/<code> (the poster's link).

The code is the bout's row id "[a,b]" written "a-b". The route serves a tiny HTML page whose og:/twitter: tags make
the link preview read "Kofi beat Ana by knockout | Subsudo", then sends the browser on to /#bout/<id>, where
Pages/Bout shows the read-only bout to visitors (get_public_bout). Only finished bouts get a headline; anything else
(or a bad code) gets the app's own preview and the same redirect, so the page decides. noindex: bouts aren't for search.
"""
import html
import json
import re

import anvil
import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Fights

GENERIC = ("Subsudo: the virtual fight club", "Shadow-box one round with your phone or laptop camera and send it to anyone. "
           "Three judges decide. Think you'd beat them? Try a round, no account needed.")


def bout_code(row_id):
    """'[123,456]' -> '123-456' (short and safe in a URL); anything else is URL-escaped by the caller."""
    m = re.fullmatch(r"\[(\d+),(\d+)\]", str(row_id or ""))
    return "%s-%s" % (m.group(1), m.group(2)) if m else ""


def row_id(code):
    m = re.fullmatch(r"(\d+)-(\d+)", str(code or ""))
    return "[%s,%s]" % (m.group(1), m.group(2)) if m else ""


def _origin():
    try:
        from . import seo_routes
        return seo_routes.origin()
    except Exception:
        return anvil.server.get_app_origin().rstrip("/")


def preview(code):
    """(title, description, row id or '') for a share code."""
    rid = row_id(code)
    f = C.row_by_id(app_tables.fights, rid) if rid else None
    if f is None or f["status"] != "done":
        return GENERIC[0], GENERIC[1], rid
    a, b = f["a_round"], f["b_round"]
    secs = int((f["rules"] or {}).get("secs") or 60)
    sa, sb = int(f["a_score"] or 0), int(f["b_score"] or 0)
    pa = (a["stats"] or {}).get("punches", 0) if a is not None else 0
    pb = (b["stats"] or {}).get("punches", 0) if b is not None else 0
    desc = ("One %d-second round each, judged by three judges. Scores %d to %d, %d punches to %d. "
            "Think you'd beat them? Try a round on Subsudo, no account needed." % (secs, sa, sb, pa, pb))
    return Fights.public_headline(f) + " | Subsudo", desc, rid


def page_html(code):
    title, desc, rid = preview(code)
    o = _origin()
    e = html.escape
    target = "/#bout/" + (rid.replace("[", "%5B").replace("]", "%5D").replace(",", "%2C") if rid else "")
    if not rid:
        target = "/#try"
    return """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t}</title><meta name="description" content="{d}"><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:site_name" content="Subsudo">
<meta property="og:title" content="{t}"><meta property="og:description" content="{d}">
<meta property="og:url" content="{o}/b/{c}"><meta property="og:image" content="{o}/_/theme/og-image.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}"><meta name="twitter:image" content="{o}/_/theme/og-image.png">
<meta http-equiv="refresh" content="0; url={u}">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#1c1a18;color:#f3ece0;
font:17px/1.5 system-ui,sans-serif;text-align:center;padding:24px}}a{{color:#dba84a}}h1{{font-size:1.5rem;margin:0 0 8px}}</style>
</head><body><main><h1>{t}</h1><p>{d}</p><p><a href="{u}">Open the bout</a></p></main>
<script>location.replace({uj});</script></body></html>""".format(
        t=e(title), d=e(desc), o=e(o), c=e(code or ""), u=e(target), uj=json.dumps(target))


def _page(code):
    return anvil.server.HttpResponse(200, anvil.BlobMedia("text/html; charset=utf-8", page_html(code).encode("utf-8")),
                                     headers={"Cache-Control": "public, max-age=300"})


ROUTE = getattr(anvil.server, "route", None)
if ROUTE:
    @ROUTE("/b/:code")
    def share_bout(code="", **params):
        return _page(code)

# The same page under /_/api/b/<code>, for runtimes without @anvil.server.route
@anvil.server.http_endpoint("/b/:code")
def share_bout_api(code="", **params):
    return _page(code)
