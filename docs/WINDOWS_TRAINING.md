# Windows training reliability

**Applies to:** AI Toolkit training on Windows with large Krea 2 `.safetensors` checkpoints (multi‑GB).

---

## OSError 1455 — “paging file is too small”

This is usually **not** “install more RAM” or “grow the pagefile forever.”

On Windows, safetensors’ default **mmap** backend reserves **commit charge** (RAM + pagefile reservation) for the entire weight file up front. Loading a multi‑GB checkpoint can exhaust **system commit** even when plenty of physical RAM appears free. After several failed loads or overnight jobs, **other apps** (including unrelated Python tools) may fail to allocate until you kill leftover processes or reboot.

LoraTraining mitigates this by spawning training through `train_bootstrap.py`, which patches safetensors to prefer **`pread`** / streaming reads instead of mmap. See **D28** in [DECISIONS.md](DECISIONS.md).

---

## What you should see in the train log

Near the start of a job log (`!Jobs/{id}/logs/train-*.log`):

```
[LoraTraining] training via train_bootstrap.py (safetensors 1455 workaround)
[LoraTraining] safetensors Windows shim ACTIVE (safetensors X.Y.Z; ...)
```

Shim status lines log **once** per path — not every training step.

---

## If training still fails

1. **Kill leftover `python.exe`** from crashed training / Comfy before retrying (Task Manager). Reboot if commit is already exhausted.
2. **Close ComfyUI** and other GPU-heavy apps before loading Krea 2–sized bases.
3. **Do not retry in a tight loop** — each failed mmap attempt can make the session worse. The shim **aborts immediately** on 1455 instead of falling through to heavier loaders.
4. **Upgrade safetensors** in your AI Toolkit venv if very old (`pip install -U safetensors`).
5. Opt out only for debugging: set env `LORA_TRAINING_ALLOW_SAFETENSORS_MMAP=1` on the training spawn (restores native mmap behaviour).

---

## Overnight queues & commit charge

Training one job releases most memory when the process exits, but:

- Failed jobs that leave Python children running hold commit
- Comfy previews overlapping training compete for VRAM and RAM
- Windows commit fragmentation builds across a long queue

LoraTraining already:

- Waits **~10 s** before an auto-advanced next job after success, or after failure when continuation is enabled (GPU/VRAM settle)
- After a **failure**, starts the next job only when `continueOnFailure` is true (the stored default) and **Stop** / **Stop after this** was not used. **Stop** itself does not start the next job
- Holds a wake lock and raises toolkit process priority during runs

If daily reboots were required before v0.3, ensure you are on a build with the bootstrap shim and avoid enqueueing the next Krea job while commit is already low.

---

## Memory probe line

At shim activation you may see:

```
[LoraTraining] memory before load: phys … GB free, commit(pagefile) … GB free
```

If **commit remaining** is under ~8 GB, Krea 2 loads are likely to fail — free commit first.

---

## Related

- [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md) — AI Toolkit spawn contract
- [JOB_QUEUE.md](JOB_QUEUE.md) — queue behaviour between jobs
- [DECISIONS.md](DECISIONS.md) D22 (priority / wake lock), D28 (safetensors shim)
- Upstream context: [transformers #48285](https://github.com/huggingface/transformers/issues/48285)
