# Release notes — LoraTraining v0.1.0

**Release date:** 27 July 2026  
**Channel:** Initial public/feature milestone (`0.1.0`)

---

## Summary

LoraTraining **v0.1.0** is the first packaged milestone of a Windows desktop app for LoRA dataset preparation, JoyCaption captioning, AI Toolkit training queues, and ComfyUI validation previews. The app orchestrates your existing tools; it does not replace them.

---

## Highlights

### Dataset library that tracks your folders
Point a **category** at a root directory and LoraTraining discovers image subfolders as datasets, keeps the library in sync, and avoids duplicate cards for the same path.

### Fast image workflow
Virtualized grid, cached thumbs, bulk caption ops, convert/shrink tools, JoyCaption with cancel, and Recycle Bin / permanent delete shortcuts designed for rapid cleanup.

### Serious training queue
Enqueue jobs, drag to reorder, watch live logs and metrics, and see **how long each job takes** vs **when it will finish** (including everything ahead). Estimates start conservative (~7 s/step) and tighten using live toolkit rate while training.

### Validation across every set
Configure multiple validation sets per dataset, then **Run all sets** to fill missing Comfy previews in order—no more clicking Run once per set.

---

## Requirements

| Requirement | Notes |
| --- | --- |
| Windows 10/11 | Primary supported OS |
| Node 20+ (from source) | For `npm run dev` / build |
| JoyCaption (optional) | For automated captions |
| AI Toolkit (optional) | For training |
| ComfyUI + LT nodes (optional) | For validation Run |

---

## Install

**From source**

```bash
npm install
npm run dev
```

**Installer**

```bash
npm run build:win
```

Artifacts land in `release/`.

---

## Upgrade / data

App metadata lives under `%APPDATA%\lora-training\` (settings, dataset JSON, jobs, thumbs). Your image folders are untouched unless you delete images or use **Delete dataset…**.

There is no prior stable release; treat v0.1.0 as a fresh install.

---

## Known limitations

- Non-Windows packaging is not a v0.1 focus.
- Pause/resume depends on AI Toolkit checkpoint behavior (process is killed on pause).
- Validation requires a saved Comfy workflow and reachable ComfyUI.
- ETA is an estimate (7 s/step and/or blended live rate), not a guarantee.
- One training job process at a time; one validation run at a time.

---

## Documentation

- [User guide](USER_GUIDE.md)
- [Changelog](../CHANGELOG.md)
- [README](../README.md)
- [Development](DEVELOPMENT.md)

---

## Thank you

v0.1.0 bundled the vertical slice from dataset hygiene through train + validate. Superseded by [v0.2.0](RELEASE_NOTES_v0.2.0.md) for the full-featured production line.
