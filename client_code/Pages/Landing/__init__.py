from anvil import *

from ._anvil_designer import LandingTemplate
from ... import state

# The app's video on the Addanapp YouTube channel (APP_MAKER/youtube/manifest.json), shown in the Watch section.
YT_VIDEO = "ECTqEf17FOg"
TICKER_EXTRA = [{"k": "Three judges", "t": "power · volume · ring craft", "v": ""}]


class Landing(LandingTemplate):
    """#landing (Persuade): the fight-night title card (red corner vs blue corner, CSS counters) over the world-board
    ticker, the Watch section (the YouTube video), how it works, the gym bag, the live world top 5, questions, the band.
    Static copy lives in the template; the ticker and the board come from get_rankings (public)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        me = state.me()
        self.guest_cta.visible = self.band_join.visible = not me
        self.member_cta.visible = self.band_gym.visible = bool(me)
        self.dom_nodes["yt_cover"].addEventListener("click", self._play)
        d = state.call_quiet("get_rankings", "world")
        rows = (d or {}).get("rows") or []
        tick = [{"k": "#%s" % r["rank"], "t": r["fighter"]["ring"], "v": str(r["value"])} for r in rows[:8]]
        if not tick:
            tick = [{"k": "World belt", "t": "up for grabs", "v": ""}, {"k": "City belts", "t": "waiting in every city", "v": ""}]
        tick = tick + TICKER_EXTRA
        self.ticker.items = tick + tick  # doubled, so the loop has no gap
        self.board.items = [{"r": r, "unit": ""} for r in rows[:5]]
        self.board_empty.visible = not rows

    def _play(self, event):
        """Swap the video's cover for YouTube's player (privacy-enhanced); nothing loads from YouTube before this click."""
        self.dom_nodes["yt_frame"].innerHTML = (
            '<iframe src="https://www.youtube-nocookie.com/embed/' + YT_VIDEO + '?autoplay=1&rel=0&playsinline=1" '
            'title="Subsudo video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen '
            'referrerpolicy="strict-origin-when-cross-origin"></iframe>')
