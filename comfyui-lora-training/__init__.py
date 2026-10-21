"""LoraTraining contract nodes for ComfyUI.

Install by copying this folder into ComfyUI `custom_nodes/`, then restart.

Nodes: LT · Prompt, LT · Seed, LT · Style Index, LT · Model, LT · Output Folder,
LT · Output Filename.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
