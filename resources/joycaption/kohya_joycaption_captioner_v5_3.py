import argparse
import ctypes
import gc
import json
import re
import sys
import time
from pathlib import Path

import colorama
from colorama import Fore, Style
from PIL import Image, ImageFile
from tqdm import tqdm

import torch
from transformers import AutoProcessor, LlavaForConditionalGeneration, BitsAndBytesConfig

# Be tolerant of imperfect dataset images.
ImageFile.LOAD_TRUNCATED_IMAGES = True
colorama.init(autoreset=True)

MODEL_NAME = "fancyfeast/llama-joycaption-beta-one-hf-llava"
SCRIPT_VERSION = "V5.3.1 - direct prefix text + no-json + dedupe + context-file"
DEFAULT_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# Windows: keep the machine awake while a long batch is running.
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002



def keep_awake() -> None:
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
        )
    except Exception:
        pass


DEFAULT_CAPTION_RULES = """Write a single plain Stable Diffusion training caption line.
Use concise comma-separated natural-language tags/phrases.
Describe only visible image content: subject, clothing, pose, expression, composition, setting, lighting, style, camera/framing.
Do not output JSON. Do not output Markdown. Do not output key/value fields. Do not output explanations.
""".strip()

def load_optional_prompt(prompt_path: str | None) -> str:
    if not prompt_path:
        return DEFAULT_CAPTION_RULES

    path = Path(prompt_path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {path}")

    prompt = path.read_text(encoding="utf-8").strip()
    if not prompt:
        raise ValueError(f"Prompt file is empty: {path}")

    return prompt


def load_optional_context(context_path: str | None) -> str:
    """Extra dataset guidance appended under USER CAPTIONING RULES (does not replace them)."""
    if not context_path:
        return ""

    path = Path(context_path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Context file not found: {path}")

    return path.read_text(encoding="utf-8").strip()


def apply_dataset_context(rules: str, context: str) -> str:
    ctx = context.strip()
    if not ctx:
        return rules
    return f"{rules.rstrip()}\n\nDATASET CONTEXT:\n{ctx}"


def collect_images(root: Path, recursive: bool, extensions: set[str]) -> list[Path]:
    pattern_iter = root.rglob("*") if recursive else root.glob("*")
    return sorted(
        p for p in pattern_iter
        if p.is_file() and p.suffix.lower() in extensions
    )


def caption_path_for(image_path: Path, caption_extension: str) -> Path:
    if not caption_extension.startswith("."):
        caption_extension = "." + caption_extension
    return image_path.with_suffix(caption_extension)


def _flatten_caption_parts(value) -> list[str]:
    """Flatten possible model JSON values into caption fragments, never JSON text."""
    parts: list[str] = []

    if value is None:
        return parts

    if isinstance(value, str):
        v = value.strip()
        if v:
            parts.append(v)

    elif isinstance(value, list):
        for item in value:
            parts.extend(_flatten_caption_parts(item))

    elif isinstance(value, dict):
        for key in ("caption", "tags", "style", "subject", "description"):
            if key in value:
                parts.extend(_flatten_caption_parts(value[key]))

    else:
        v = str(value).strip()
        if v:
            parts.append(v)

    return parts


def clean_caption(raw: str) -> str:
    """Normalize any model output into one Kohya-friendly plain-text caption.

    This function intentionally refuses to write raw JSON. If the model returns
    JSON anyway, it extracts useful caption-like fields and writes only those.
    """
    if not raw:
        return ""

    text = str(raw).strip()

    # Remove common chat/model artifacts and Markdown fences.
    text = text.replace("```json", "").replace("```text", "").replace("```", "").strip()
    text = text.replace("<|eot_id|>", "").replace("<|end_of_text|>", "").strip()

    # If a JSON object is present, parse it and extract fields instead of saving JSON.
    match = re.search(r"(\{.*\})", text, flags=re.DOTALL)
    if match:
        json_text = match.group(1)
        try:
            parsed = json.loads(json_text)
            parts = []

            # Prefer caption first, then useful tag-like fields.
            for key in ("caption", "tags", "style", "subject", "description"):
                if isinstance(parsed, dict) and key in parsed:
                    parts.extend(_flatten_caption_parts(parsed[key]))

            if not parts:
                parts = _flatten_caption_parts(parsed)

            text = ", ".join(parts)

        except Exception:
            # Do not write JSON-looking output. Strip braces as a last resort.
            text = re.sub(r"[{}\[\]\"]", " ", json_text)

    # If the model insists on labels, strip one obvious leading label.
    text = re.sub(
        r"^(caption|tags|output|description)\s*:\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()

    # Keep one line. Kohya caption sidecars should be plain caption text.
    text = " ".join(line.strip() for line in text.splitlines() if line.strip())

    # Convert JSON-ish separators after fallback into caption-ish comma phrases.
    text = text.replace("_", " ")
    text = re.sub(r"\s*[:=]\s*", ", ", text)
    text = re.sub(r"\s*;\s*", ", ", text)
    text = re.sub(r"\s*,\s*", ", ", text)
    text = re.sub(r",\s*,+", ", ", text)
    text = re.sub(r"\s+", " ", text).strip(" ,")

    # Remove matching wrapping quotes.
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        text = text[1:-1].strip()

    return text


def add_trigger_token(caption: str, trigger_token: str | None, mode: str) -> str:
    if not trigger_token:
        return caption

    token = trigger_token.strip()
    if not token:
        return caption

    # Avoid duplicating the trigger token if the model already used it.
    if re.search(rf"(?<!\w){re.escape(token)}(?!\w)", caption):
        return caption

    if mode == "append":
        return f"{caption}, {token}" if caption else token

    return f"{token}, {caption}" if caption else token


def prepend_caption_text(caption: str, prepend: str | None) -> str:
    """Prepend fixed text to every caption, adding a comma if needed."""
    if not prepend:
        return caption

    prefix = prepend.strip()
    if not prefix:
        return caption

    if caption:
        if prefix.endswith(","):
            return f"{prefix} {caption}"
        return f"{prefix}, {caption}"

    return prefix


def dedupe_comma_tags(caption: str) -> str:
    """Remove duplicate comma-separated caption tags while preserving order.

    The comparison is case-insensitive and whitespace-normalized, but the first
    original spelling/capitalization is preserved in the final caption.
    """
    if not caption:
        return ""

    unique_parts: list[str] = []
    seen: set[str] = set()

    for part in caption.split(","):
        tag = re.sub(r"\s+", " ", part.strip())
        if not tag:
            continue

        key = tag.casefold()
        if key in seen:
            continue

        seen.add(key)
        unique_parts.append(tag)

    return ", ".join(unique_parts)


def build_instruction(img_token: str, custom_prompt: str, trigger_token: str | None) -> str:
    instruction = f"{img_token}\n"
    instruction += "TASK: Generate one concise Stable Diffusion LoRA training caption for this image.\n"
    instruction += "Return ONLY one plain caption line. ABSOLUTELY DO NOT return JSON, Markdown, explanations, bullet points, or key/value fields.\n"
    instruction += "The caption should describe visible subject, clothing, pose, composition, environment, style, and important visual attributes.\n"

    if trigger_token:
        instruction += f"Use this trigger token naturally if appropriate: {trigger_token}\n"

    instruction += "\nUSER CAPTIONING RULES:\n"
    instruction += custom_prompt
    return instruction


def generate_caption(
    processor,
    model,
    image: Image.Image,
    custom_prompt: str,
    trigger_token: str | None,
    sample: bool,
) -> str:
    img_token = getattr(processor, "image_token", "<image>")
    final_instruction = build_instruction(img_token, custom_prompt, trigger_token)

    conversation = [{"role": "user", "content": final_instruction}]
    prompt = processor.apply_chat_template(
        conversation,
        tokenize=False,
        add_generation_prompt=True,
    )

    inputs = processor(
        text=prompt,
        images=image,
        return_tensors="pt",
        padding=True,
    ).to(model.device)

    if "pixel_values" in inputs:
        inputs["pixel_values"] = inputs["pixel_values"].to(torch.bfloat16)

    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=384,
            do_sample=sample,
            temperature=0.7 if sample else 1.0,
            num_beams=1,
            pad_token_id=processor.tokenizer.eos_token_id,
        )

    full_text = processor.decode(output[0], skip_special_tokens=False)
    assistant_header = "<|start_header_id|>assistant<|end_header_id|>"
    generated = full_text.split(assistant_header)[-1] if assistant_header in full_text else full_text

    return clean_caption(generated)


def load_model():
    print(f"{Fore.YELLOW}Loading JoyCaption with NF4...{Style.RESET_ALL}")

    quant_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
        llm_int8_skip_modules=["vision_tower", "multi_modal_projector"],
    )

    processor = AutoProcessor.from_pretrained(MODEL_NAME)

    if processor.tokenizer.pad_token is None:
        processor.tokenizer.pad_token = processor.tokenizer.eos_token

    # Required for this JoyCaption/LLaVA processor combination.
    processor.patch_size = 14
    processor.vision_feature_select_strategy = "default"

    model = LlavaForConditionalGeneration.from_pretrained(
        MODEL_NAME,
        quantization_config=quant_config,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
    )

    print(f"{Fore.GREEN}Model loaded successfully.{Style.RESET_ALL}\n")
    return processor, model


def process_folder(args) -> None:
    root = Path(args.folder).resolve()

    if not root.exists() or not root.is_dir():
        raise NotADirectoryError(f"Folder does not exist: {root}")

    custom_prompt = apply_dataset_context(
        load_optional_prompt(args.prompt),
        load_optional_context(getattr(args, "context_file", None)),
    )
    caption_prefix = args.prefix.strip()

    extensions = {
        ext if ext.startswith(".") else "." + ext
        for ext in args.extensions
    }
    extensions = {ext.lower() for ext in extensions}

    print(f"{Fore.CYAN}================================================{Style.RESET_ALL}")
    print(f"{Fore.CYAN}  Kohya SS caption generator - {SCRIPT_VERSION}{Style.RESET_ALL}")
    print(f"{Fore.CYAN}================================================{Style.RESET_ALL}")
    print(f"Folder            : {root}")

    print(f"Caption prefix    : {caption_prefix if caption_prefix else 'none'}")

    print(f"Prompt source     : {Path(args.prompt).resolve() if args.prompt else 'built-in plain-caption prompt'}")
    print(
        f"Context file      : {Path(args.context_file).resolve() if args.context_file else 'none'}"
    )
    print(f"Caption extension : {args.caption_extension}")
    print(f"Dedupe tags       : yes")
    print(f"Recursive         : {args.recursive}")
    print(f"Redo              : {args.redo}")

    if args.trigger_token:
        print(f"Trigger token     : {args.trigger_token} ({args.trigger_position})")

    print()

    all_images = collect_images(root, args.recursive, extensions)

    if args.redo:
        work_items = all_images
    else:
        work_items = [
            p for p in all_images
            if not caption_path_for(p, args.caption_extension).exists()
        ]

    print(f"{Fore.YELLOW}Images found      : {len(all_images)}")
    print(f"Already captioned : {len(all_images) - len(work_items)}")
    print(f"To process        : {len(work_items)}{Style.RESET_ALL}\n")

    if not work_items:
        print(f"{Fore.GREEN}Nothing to do.{Style.RESET_ALL}")
        return

    processor, model = load_model()

    processed = 0
    errors = 0
    start_time = time.time()

    for image_path in tqdm(work_items, desc="Captioning", unit="img", dynamic_ncols=True):
        target_txt = caption_path_for(image_path, args.caption_extension)

        try:
            with Image.open(image_path) as img:
                img.load()
                image = img.convert("RGB")
        except Exception as e:
            tqdm.write(f"{Fore.RED}[BAD IMAGE] {image_path.name}: {e}{Style.RESET_ALL}")
            errors += 1
            continue

        caption = ""

        for attempt in range(1, args.max_attempts + 1):
            try:
                caption = generate_caption(
                    processor=processor,
                    model=model,
                    image=image,
                    custom_prompt=custom_prompt,
                    trigger_token=args.trigger_token,
                    sample=(attempt > 1),
                )

                caption = add_trigger_token(
                    caption,
                    args.trigger_token,
                    args.trigger_position,
                )

                caption = prepend_caption_text(caption, caption_prefix)
                caption = dedupe_comma_tags(caption)

                if caption:
                    break

            except Exception as e:
                if attempt == args.max_attempts:
                    tqdm.write(f"{Fore.RED}[FAILED] {image_path.name}: {e}{Style.RESET_ALL}")

        del image
        gc.collect()

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        if not caption:
            errors += 1
            continue

        try:
            target_txt.write_text(caption + "\n", encoding="utf-8")
            processed += 1

            try:
                display_path = image_path.relative_to(root)
            except ValueError:
                display_path = image_path.name

            tqdm.write(f"{Fore.GREEN}[OK] {display_path} -> {target_txt.name}{Style.RESET_ALL}")
            tqdm.write(f"     {caption}")

        except Exception as e:
            tqdm.write(f"{Fore.RED}[WRITE FAILED] {target_txt}: {e}{Style.RESET_ALL}")
            errors += 1

    elapsed = time.time() - start_time

    print("\n" + "=" * 72)
    print(f"{Fore.GREEN}Done.{Style.RESET_ALL}")
    print(f"Captions written : {processed}")
    print(f"Errors           : {errors}")

    if processed:
        print(f"Average speed    : {elapsed / processed:.2f}s/image")

    print("=" * 72)


def parse_args():
    parser = argparse.ArgumentParser(
        prog="kohya_joycaption_captioner.py",
        description=(
            f"Kohya SS caption generator - {SCRIPT_VERSION}. "
            "Generates plain .txt sidecar captions for LoRA training. "
            "Use --prefix to prepend fixed text to every generated caption."
        ),
    )

    parser.add_argument(
        "folder",
        help="Dataset folder containing training images.",
    )

    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {SCRIPT_VERSION}",
    )

    parser.add_argument(
        "--prompt",
        help=(
            "Optional path to a custom plain-caption prompt. "
            "By default, the script uses its built-in non-JSON Kohya prompt."
        ),
    )

    parser.add_argument(
        "--context-file",
        default="",
        help=(
            "Optional path to a short dataset-context file. "
            "Appended under USER CAPTIONING RULES as DATASET CONTEXT "
            "(does not replace --prompt / built-in rules)."
        ),
    )

    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Process images in subfolders too.",
    )

    parser.add_argument(
        "--redo",
        action="store_true",
        help="Overwrite existing caption files.",
    )

    parser.add_argument(
        "--caption-extension",
        default=".txt",
        help="Caption sidecar extension. Kohya commonly uses .txt.",
    )


    parser.add_argument(
        "--prefix",
        default="",
        help=(
            "Optional fixed text prepended to every caption. "
            "Example: --prefix \"mallow_person\""
        ),
    )

    parser.add_argument(
        "--trigger-token",
        default="",
        help="Optional LoRA trigger token to force into every caption.",
    )

    parser.add_argument(
        "--trigger-position",
        choices=["prepend", "append"],
        default="prepend",
        help="Where to place the trigger token.",
    )

    parser.add_argument(
        "--max-attempts",
        type=int,
        default=3,
        help="Retry count per image.",
    )

    parser.add_argument(
        "--extensions",
        nargs="+",
        default=sorted(DEFAULT_IMAGE_EXTENSIONS),
        help="Image extensions to process. Default: .jpg .jpeg .png .webp",
    )

    return parser.parse_args()

if __name__ == "__main__":
    keep_awake()

    try:
        process_folder(parse_args())

    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Interrupted by user.{Style.RESET_ALL}")
        sys.exit(130)

    except Exception as e:
        print(f"{Fore.RED}Error: {e}{Style.RESET_ALL}")
        sys.exit(1)