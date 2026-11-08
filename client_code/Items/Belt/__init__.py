from anvil import *

from ._anvil_designer import BeltTemplate


class Belt(BeltTemplate):
    """A title belt badge. item = {text}."""

    def __init__(self, **properties):
        super().__init__(**properties)
