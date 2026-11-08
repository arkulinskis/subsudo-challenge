"""The app starts here (anvil.yaml: startup module). One server call to learn who is signed in (Anvil's loading
spinner shows meanwhile), the Privacy & Terms kit, the engine's link back to Python (toasts), then the page for the
address in the browser bar."""
import anvil.server
from anvil.js import window

from . import legal, router, state

LEGAL_THEME = {"accent": "#8e1b1b"}  # colours for the Privacy & Terms page (match --c-brand in app.css)


def _toast(message, kind=""):
    state.toast(message, kind or None)


# The JS engine (ss-core.js / ss-motion.js) shows its messages through Python's toasts.
window.SS_HOST = window.Object()
window.SS_HOST.toast = _toast

legal.setup(LEGAL_THEME)
state.set_me(anvil.server.call("get_me"))
if state.me():
    legal.refresh_soon()
router.start()
