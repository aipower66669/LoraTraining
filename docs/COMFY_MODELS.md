# ComfyUI fixed models (bundled + library workflows)

LoraTraining **does not download** these files. This page lists every **fixed** model filename baked into the Comfy graphs shipped with the app (not values injected at run time via **LT ·** nodes).

**Shipped graphs:** [`resources/comfy-workflows/`](../resources/comfy-workflows/) — copied into `{libraryRoot}/` on install/seed when missing. Re-scan after you change a saved library graph:

```bash
npm run list:comfy-models
# or: npm run list:comfy-models -- --library "D:\Your-Library"
```

**Install once:** download each file → place in the ComfyUI `models/…` sub-folder shown → restart ComfyUI. Missing **custom node packs** are separate — use ComfyUI Manager (see [SETUP.md](SETUP.md#5-comfyui-validation--preview-tools)).

---

## Not fixed in the graph (injected by LoraTraining)

These change per job / Settings and are **not** listed as one-time downloads here:

| Input | LT node | Source |
| --- | --- | --- |
| Krea 2 diffusion UNET | **LT · Model** → `UNETLoader.unet_name` | **Settings → External tools → ComfyUI → Model**, or per-set **validationModel** (Validation / Weight / Stress / Upscale) |
| LoRA file + prompt | **LT · Prompt** | Dataset `output/` checkpoint + validation set prompt |
| Seed, style index, denoise, max size | **LT · Seed**, **LT · Style Index**, etc. | Per-tool UI fields |
| Input image path | **LT · Input Image** | Selected dataset image |
| Output folder / filename | **LT · Output Folder**, **LT · Output Filename** | App-computed paths |

Your diffusion checkpoint is typically a Krea 2 file from [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) (e.g. `krea2_raw_fp8_scaled.safetensors` in `models/diffusion_models/`). Point **Settings → External tools → ComfyUI → Model** at the same filename Comfy shows in **Load Diffusion Model**.

---

## One-time download checklist (all workflows)

| File | ComfyUI folder | Used by | Hugging Face |
| --- | --- | --- | --- |
| `qwen3vl_4b_fp8_scaled.safetensors` | `models/text_encoders/` | Validation, Weight, Stress, Upscale | [Download](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors) · [Repo](https://huggingface.co/Comfy-Org/Krea-2/tree/main/text_encoders) |
| `Wan2_1_VAE_fp32.safetensors` | `models/vae/` | Validation, Weight, Stress, Upscale | [Download](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_fp32.safetensors) · [Repo](https://huggingface.co/Kijai/WanVideo_comfy/tree/main) |
| `4x_foolhardy_Remacri.pth` | `models/upscale_models/` | Upscale | [Download](https://huggingface.co/FacehugmanIII/4x_foolhardy_Remacri/resolve/main/4x_foolhardy_Remacri.pth) · [Repo](https://huggingface.co/FacehugmanIII/4x_foolhardy_Remacri) |
| `Qwen-Image-Edit-2509-Q5_0.gguf` | `models/unet/` | Diversify · Context | [Download](https://huggingface.co/QuantStack/Qwen-Image-Edit-2509-GGUF/resolve/main/Qwen-Image-Edit-2509-Q5_0.gguf) · [Repo](https://huggingface.co/QuantStack/Qwen-Image-Edit-2509-GGUF) |
| `qwen_image_vae.safetensors` | `models/vae/` | Diversify · Context | [Download](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) · [Repo](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/tree/main/split_files/vae) |
| `qwen_2.5_vl_7b_nvfp4.safetensors` | `models/text_encoders/` | Diversify · Context | [Download](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_nvfp4.safetensors) · [Repo](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/tree/main/split_files/text_encoders) |
| `Edit\Qwen-Image-Lightning-4steps-V1.0-bf16.safetensors` | `models/loras/Edit/` | Diversify · Context | [ModelTC/Qwen-Image-Lightning](https://huggingface.co/ModelTC/Qwen-Image-Lightning/tree/main) — create subfolder `Edit/` if needed; file may appear as `Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors` in the repo (rename or adjust the graph to match) |

**Diversify · Expression** has **no fixed `.safetensors` / `.pth` / `.gguf` filenames** in the saved graph. It uses **ExpressionEditor** (Advanced Live Portrait). Install **ComfyUI-AdvancedLivePortrait** + **ComfyUI-LivePortraitKJ** via Manager; weights usually auto-download to `models/liveportrait/` from [Kijai/LivePortrait_safetensors](https://huggingface.co/Kijai/LivePortrait_safetensors/tree/main) on first run.

---

## Per workflow file

### `comfy-workflow-validation.json`

Shared by **Validation Steps**, **Validation Weight**, and **Model Stress-Testing**.

| Node | Input | Fixed value |
| --- | --- | --- |
| `CLIPLoader` | `clip_name` | `qwen3vl_4b_fp8_scaled.safetensors` |
| `VAELoader` | `vae_name` | `Wan2_1_VAE_fp32.safetensors` |
| `UNETLoader` | `unet_name` | *(wired from **LT · Model** — not fixed)* |

### `comfy-workflow-upscale.json`

| Node | Input | Fixed value |
| --- | --- | --- |
| `CLIPLoader` | `clip_name` | `qwen3vl_4b_fp8_scaled.safetensors` |
| `VAELoader` | `vae_name` | `Wan2_1_VAE_fp32.safetensors` |
| `UpscaleModelLoader` | `model_name` | `4x_foolhardy_Remacri.pth` |
| `UNETLoader` | `unet_name` | *(wired from **LT · Model** — not fixed)* |

### `comfy-workflow-context.json`

| Node | Input | Fixed value |
| --- | --- | --- |
| `LoaderGGUF` | `gguf_name` | `Qwen-Image-Edit-2509-Q5_0.gguf` |
| `VAELoader` | `vae_name` | `qwen_image_vae.safetensors` |
| `CLIPLoader` | `clip_name` | `qwen_2.5_vl_7b_nvfp4.safetensors` |
| `LoraLoaderModelOnly` | `lora_name` | `Edit\Qwen-Image-Lightning-4steps-V1.0-bf16.safetensors` |

Requires **ComfyUI-GGUF** (or equivalent) for `LoaderGGUF`.

### `comfy-workflow-expression.json`

| Node | Role |
| --- | --- |
| `ExpressionEditor` | Face expression warp (Live Portrait stack) |
| `RandomNumber` × 10 | Expression ranges driven by **LT · Seed** |
| `SaveImageToFolder` | Writes `{stem}_dNN` siblings |

No checkpoint/VAE/CLIP filenames are stored in this graph.

---

## Custom node packs (not models)

These workflows also expect node packs installable via **ComfyUI Manager** (names vary by fork):

| Workflow | Typical missing nodes |
| --- | --- |
| Validation / Upscale | **Dynamic Prompts** (`LoraTagLoader`, wildcards), **Save** nodes tied to LT outputs |
| Context | **ComfyUI-GGUF** (`LoaderGGUF`), Qwen-Image-Edit loaders |
| Expression | **ComfyUI-AdvancedLivePortrait**, **ComfyUI-LivePortraitKJ**, **SaveImageToFolder** |

Open **Edit Workflow** → install whatever Comfy marks red → restart once.

---

## Related

- [SETUP.md §5 ComfyUI](SETUP.md#5-comfyui-validation--preview-tools)
- [VALIDATION.md](VALIDATION.md)
- [comfyui-lora-training/README.md](../comfyui-lora-training/README.md)

