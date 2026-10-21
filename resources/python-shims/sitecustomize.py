"""
LoraTraining Python startup shim (injected via PYTHONPATH).

Prefer train_bootstrap.py as the training entrypoint — this file is a backup for
JoyCaption and other spawns that only set PYTHONPATH.
"""

from __future__ import annotations

import builtins
import sys

_ORIG_IMPORT = builtins.__import__


def _apply() -> None:
    if sys.platform != "win32":
        return
    try:
        from lora_safetensors_patch import apply

        if apply(force_log=False):
            return
    except Exception:
        pass

    def _import_hook(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
        mod = _ORIG_IMPORT(name, globals, locals, fromlist, level)
        if name == "safetensors" or name.startswith("safetensors."):
            try:
                from lora_safetensors_patch import apply

                apply(force_log=True)
            except Exception as e:
                print(
                    f"[LoraTraining] safetensors Windows shim failed: {e}",
                    file=sys.stderr,
                    flush=True,
                )
        return mod

    if builtins.__import__ is _ORIG_IMPORT:
        builtins.__import__ = _import_hook  # type: ignore[assignment]
        print(
            "[LoraTraining] safetensors Windows shim: waiting for first safetensors import",
            file=sys.stderr,
            flush=True,
        )


_apply()
