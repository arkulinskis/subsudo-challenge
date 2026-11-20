from anvil import *
from anvil.js import window

from ._anvil_designer import ShareBoutTemplate
from ... import ss, state


class ShareBout(ShareBoutTemplate):
    """Share a finished bout: the fight poster (a 1080x1350 PNG drawn in the browser by ss-poster.js, shown here as a
    preview) and the bout's public link (<site>/b/<id>: a link preview with the names, then the read-only bout page).
    Phones get the share sheet with the picture; desktops download it and copy the link."""

    def __init__(self, **properties):
        self._bout, self._ready, self._shown, self._drawn = None, False, False, ""
        super().__init__(**properties)
        self._ready = True
        self.share_button.enabled = False
        self._draw()

    def _draw(self):
        if not self._ready or not self._bout:
            return
        b = self._bout
        self.visible = b.get("status") == "done"
        if not self.visible:
            return
        self.lead.text = "A fight poster of this bout and a link anyone can open, no account needed."
        self.note.text = "The poster is made on your device. The link shows the bout, never anyone's email."
        key = "%s:%s" % (b.get("id"), b.get("finished"))
        if not self._shown:
            window.setTimeout(self._late, 600)  # in case "show" came before the bout arrived
            return
        if self._drawn != key:
            self._drawn = key
            self.dom_nodes["wait"].textContent = "Drawing the poster…"
            self.dom_nodes["pic_box"].classList.remove("ready")
            window.SS.posterStart(ss.js(b), self.dom_nodes["thumb"], self._poster_done)

    def _poster_done(self, size):
        ok = (size or 0) > 0
        self.share_button.enabled = True  # sharing draws it again if this attempt failed
        self.dom_nodes["pic_box"].classList.toggle("ready", ok)
        self.dom_nodes["wait"].textContent = "" if ok else "The preview didn't draw. Sharing will try again."
        self.dom_nodes["thumb"].setAttribute("alt", "Fight poster: " + ss.headline(self._bout) if ok else "")
        window.SS_POSTER_BYTES = size  # tests read it

    @handle("", "show")
    def form_show(self, **event_args):
        self._shown = True
        self._draw()

    def _late(self):
        if not self._shown and window.document.body.contains(self.dom_nodes["thumb"]):
            self._shown = True
            self._draw()

    @handle("share_button", "click")
    def share_button_click(self, **event_args):
        b = self._bout
        if not b:
            return
        how = ss.share_poster(b, ss.headline(b) + " on Subsudo. Think you'd beat them?")
        if how.startswith("downloaded"):
            state.toast("Poster saved." + (" Link copied too." if how == "downloaded" else ""), "ok")
        elif how == "shared":
            state.toast("Shared. Good luck in the rematch.", "ok")

    @handle("link_button", "click")
    def link_button_click(self, **event_args):
        if self._bout:
            ss.copy(ss.bout_url(self._bout["id"]))

    @property
    def bout(self):
        return self._bout

    @bout.setter
    def bout(self, value):
        self._bout = value
        self._draw()
