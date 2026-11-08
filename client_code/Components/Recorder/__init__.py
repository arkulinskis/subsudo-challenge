from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import RecorderTemplate
from ... import ss, state


class Recorder(RecorderTemplate):
    """Wraps the JS round recorder. The page calls start(on_keep, secs=..., devices=[...], allow_secs=..., keep_label=...);
    when the fighter keeps a round, on_keep(round) runs with a real dict {device, secs, events, score, stats}. If it
    returns False (or raises), the summary stays so they can try again. Leaving the page stops the camera, the motion
    listeners, the wake lock and the music (hide event)."""

    def __init__(self, **properties):
        self._rec, self._on_keep = None, ss.loose(None)
        super().__init__(**properties)

    def start(self, on_keep, secs=None, devices=("phone", "camera"), allow_secs=False, keep_label="Keep the round"):
        self.stop()
        self._on_keep = on_keep
        opts = {"devices": list(devices), "allowSecs": bool(allow_secs), "keepLabel": keep_label}
        if secs:
            opts["secs"] = secs
        o = ss.js(opts)
        o.onKeep = self._keep
        self._rec = window.SS.recorder(self.dom_nodes["host"], o)

    def _keep(self, round_js):
        """Called by the engine (a Promise in JS while the server call runs)."""
        try:
            self._on_keep(ss.py(round_js))
        except Exception as e:
            state.toast(str(e) or "That did not go through.", "error")

    def stop(self):
        if self._rec is not None:
            self._rec.destroy()
            self._rec = None

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.stop()
