# JoyCaption captioner script (LoraTraining)

LoraTraining ships `kohya_joycaption_captioner_v5_3.py` — a **standalone** batch captioner (`--redo`, `--context-file`, `--trigger-token`, …).

It does **not** import or require [fpgaminer/joycaption](https://github.com/fpgaminer/joycaption). Runtime deps are ordinary PyTorch / Hugging Face packages plus the HF model below.

| You install | LoraTraining ships |
| --- | --- |
| CUDA Python venv (`torch`, `transformers`, `bitsandbytes`, `Pillow`, `tqdm`, `colorama`, …) + HF weights | This captioner script (via installer `extraResources`) |

**Fixed model** (`MODEL_NAME` in the script):

| Model id | Hugging Face |
| --- | --- |
| `fancyfeast/llama-joycaption-beta-one-hf-llava` | [Repo](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava) · [Files](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava/tree/main) |

LoraTraining does not download weights. First caption run usually pulls them into the Hugging Face cache via `from_pretrained`. See [docs/SETUP.md](../../docs/SETUP.md#4-joycaption-captions).

**Settings:** set **Work dir** to your caption venv folder. Leave **Script** as `kohya_joycaption_captioner_v5_3.py` (or blank) to use the bundled copy. A same-named file in the work dir overrides the bundle.

Packaged path: `{install}/resources/joycaption/kohya_joycaption_captioner_v5_3.py`.
