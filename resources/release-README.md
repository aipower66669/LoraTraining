# LoraTraining 0.5.0

Windows app for **Krea 2 text-to-image LoRA** dataset management and job queues. Training runs in [AI Toolkit](https://github.com/ostris/ai-toolkit). Previews run in [ComfyUI](https://github.com/comfyanonymous/ComfyUI). This app does not train by itself, and it does not install those tools.

**Provided AS-IS.** Free noncommercial software. No warranty and no direct support. There is no commitment to answer questions, fix bugs, or add features.

**Licence:** [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/). Noncommercial use only. Commercial use needs a separate licence from the copyright holder.

**Models:** Krea 2 only. Flux, SDXL, Wan, and other bases are not supported.

---

## What is in this upload

| File | What it is |
| --- | --- |
| `LoraTraining Setup 0.5.0.exe` | The Windows installer |
| `comfyui-lora-training.zip` | The **LT** ComfyUI custom nodes. Required for Validation, Upscale, and Diversify. Not required to train |
| `comfyui-custom-save-node.zip` | The **SaveImageToFolder** node used by the shipped preview workflows |
| `README.md` | This file |

The installer is **unsigned**. SmartScreen may say **Windows protected your PC**. Choose **More info → Run anyway** only if you trust this download.

---

## Before you install

You already need these working **on their own**. This download does not set them up.

| Tool | Needed for |
| --- | --- |
| [AI Toolkit](https://github.com/ostris/ai-toolkit) | Training. Confirm a Krea 2 run finishes outside LoraTraining |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | Validation, Upscale, and Diversify. Confirm a Krea 2 graph runs outside LoraTraining |
| A CUDA Python environment for the bundled JoyCaption script | Automatic captions only. Hand-written `.txt` captions do not need it |

ComfyUI Manager packs, checkpoints, VAEs, CLIP, and upscalers are **not** in this upload. Install those in ComfyUI yourself. The LT zip is only the small inject-node pack.

---

## Install the app

1. Run `LoraTraining Setup 0.5.0.exe`.
2. Open **LoraTraining**.
3. **Settings → External tools → Library** → choose **Library root** and wait until it says **Settings saved**. Until this is set, the library reports `Library root is not configured`.

---

## Install the ComfyUI custom nodes

Do this if you want Validation, Upscale, or Diversify. Skip it if you only train.

Each zip’s folder name is part of the path. `__init__.py` must sit directly inside that folder.

| Zip | Install to |
| --- | --- |
| `comfyui-lora-training.zip` | `ComfyUI\custom_nodes\comfyui-lora-training\` |
| `comfyui-custom-save-node.zip` | `ComfyUI\custom_nodes\comfyui-custom-save-node\` |

Restart ComfyUI. The LT nodes show under **Lora Training** (LT · Prompt, LT · Seed, LT · Model, and the others). **SaveImageToFolder** comes from the second zip. The app’s **Install LT Comfy package** copies only the LT pack, so install the save-node zip by hand.

**From the app** (the LT zip only; the save-node zip is still installed by hand):

1. **Settings → External tools → ComfyUI**.
2. Set **Comfy root** to the ComfyUI folder that contains `custom_nodes`. Set **LoRAs** to `models\loras`.
3. Click **Install LT Comfy package**. That copies the nodes and, if you do not already have them, seeds the shipped workflows. It does not overwrite a workflow you already saved.
4. Restart ComfyUI, start it, then click **Test ComfyUI**.

**From the zips:**

1. Unzip `comfyui-lora-training.zip` and `comfyui-custom-save-node.zip`.
2. Move each folder into `ComfyUI\custom_nodes\`.
3. Restart ComfyUI.

Other missing nodes in a graph still come from ComfyUI Manager. These zips do not include them.

---

## Point the app at your tools

**Settings → External tools**

| Section | What to set |
| --- | --- |
| AI Toolkit | **Work dir**, **Python**, and **Script** (`run.py`). **Test AI Toolkit** until it reports OK |
| Training model | Your Krea 2 checkpoint. This applies to every job |
| JoyCaption | **Work dir**, **Python**, **Script**, and **Mode**, if you want automatic captions. **Test JoyCaption** until it reports OK |
| ComfyUI | Host and port (default `127.0.0.1:8188`), **Comfy root**, and **LoRAs**. ComfyUI must be running for **Test ComfyUI** |

Jobs, Queue, and the Comfy preview screens stay hidden until the matching path is filled. Settings stays available so you can fill them.

---

## A first training run

1. **Datasets → Categories…** and create a category. Its folder is under the library root.
2. Add a dataset. Images sit in that dataset folder’s root, not in subfolders. Each caption is a `.txt` file with the same name as the image.
3. **Jobs → New job**, set steps and the LoRA name, wait for **Saved**, then **Enqueue**.
4. **Queue → Start**. Checkpoints are written under that dataset’s `output` folder.

---

## What this download does not include

- AI Toolkit, ComfyUI, Python, CUDA, or model files
- ComfyUI Manager packs other than the LT nodes in the zip
- Support, setup help, or a promise of updates

The full guide and FAQ are one file in the project repository: [docs/all-in-one.md](https://github.com/aipower66669/LoraTraining/blob/main/docs/all-in-one.md). Upload that file to an AI assistant if you want answers limited to what the app actually does. A GitHub issue is a public note, not a support request.
