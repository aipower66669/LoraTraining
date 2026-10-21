"""
Windows training entrypoint: patch safetensors, then run the real toolkit script.

Spawned as:
  python train_bootstrap.py <run.py> <job.yaml> [extra args…]

sitecustomize alone is unreliable (venv -S, import order, old safetensors with no
backend=). This wrapper always applies the patch before AI Toolkit starts.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


def main() -> None:
    here = Path(__file__).resolve().parent
    if str(here) not in sys.path:
        sys.path.insert(0, str(here))

    print(
        f"[LoraTraining] train_bootstrap: {Path(sys.argv[0]).name}",
        file=sys.stderr,
        flush=True,
    )

    try:
        from lora_safetensors_patch import apply

        apply(force_log=True)
    except Exception as e:
        print(
            f"[LoraTraining] safetensors patch failed to apply: {e}",
            file=sys.stderr,
            flush=True,
        )

    if len(sys.argv) < 2:
        print(
            "[LoraTraining] train_bootstrap usage: train_bootstrap.py <script.py> [args…]",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)

    script = sys.argv[1]
    sys.argv = [script, *sys.argv[2:]]
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
