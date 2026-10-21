# Training configuration

Canonical sample (kept in-repo):
[`../reference/config-sample.yaml`](../reference/config-sample.yaml).

After AI Toolkit **Work dir** is set, Settings shows **Default training config**.
It and each **Job config** use the same
schema and the same six visible form sections. Jobs start as a deep clone of
defaults, then specialize the dataset path, output path, trigger, name, Steps,
and Save every. When the live FIFO has jobs, Steps and Save every come from its
last job; otherwise they come from Settings (fallback 2000 / 250).

For end-user steps see [USER_GUIDE.md](USER_GUIDE.md) and [JOB_QUEUE.md](JOB_QUEUE.md).
`train.steps` also feeds queue ETA planning ([JOB_QUEUE.md](JOB_QUEUE.md)).

Once the dataset has a real on-disk `.safetensors` checkpoint, the Jobs form locks LoRA name, dataset, trigger, resolution, dtype, and network fields. Steps and other train settings remain editable until the job is running. Synthetic Pending output rows do not trigger this lock.

## Design principles

1. Visible form fields map to YAML keys under `config.process[0]`. The schema
   also preserves supported keys that have no visible control.  
2. Round-trip: form → Zod object → YAML → Zod parse ≈ identity (ignore comment
   loss).  
3. There is no advanced-YAML editor or arbitrary-key escape hatch in the UI.
4. Template tokens are resolved at **job materialisation**, not stored resolved in
   defaults (defaults may keep placeholders or sensible machine-local paths).

## Field map (from sample)

### Top level

| YAML | Behavior |
| --- | --- |
| `job` | Hidden and fixed to `extension` |
| `meta.name` | Hidden; generated from the LoRA name |
| `meta.version` | Hidden; `1.0` |

### Process root (`sd_trainer`)

| YAML | Visible control / behavior |
| --- | --- |
| `name` | **LoRA name**. Sanitized to letters, numbers, `_`, and `-`. Prefill: existing output checkpoint stem, otherwise `Category_Dataset` (`Uncategorized` fallback). Checkpoints: `{name}_NNNNNNNNN.safetensors` |
| `training_folder` | No control; always `{dataset}/output` |
| `device` | **Device** (`cuda:0` default) |
| `performance_log_every` | Stored only; no control |
| `trigger_word` | **Trigger word** (normally from the dataset) |

### `network`

| YAML | UI |
| --- | --- |
| `type` | Stored as `lora`; no select |
| `linear` | **Rank (linear)** |
| `linear_alpha` | **Alpha** |

### `save`

| YAML | UI |
| --- | --- |
| `dtype` | **Data Type**: BF16, FP16, or FP32 |
| `save_every` | **Save every** |
| `max_step_saves_to_keep` | Stored only; no control |
| `save_format` | Stored only; no control |
| `push_to_hub` | Stored only; no control |

### `datasets[0]`

| YAML | UI |
| --- | --- |
| `folder_path` | **Dataset** on a job; **Folder path** on defaults |
| `caption_ext` | Stored as `txt`; no control |
| `default_caption` | Stored only; no control |
| `caption_dropout_rate` | **Caption dropout** |
| `shuffle_tokens` | **Shuffle tokens** |
| `cache_latents_to_disk` | **Cache latents to disk** |
| `resolution` | **Resolution (comma)**; default `[512]` |
| `is_reg` | Stored only; no control |
| `network_weight` | Stored only; no control |
| `flip_x` / `flip_y` | Stored only; no controls |
| `recursive` | Stored only; default `false`, so AI Toolkit trains the flat dataset root and does not include `output` or nested images |

### `train`

| YAML | UI |
| --- | --- |
| `batch_size` | **Batch size** |
| `cache_text_embeddings` | **Cache text embeddings** |
| `unload_text_encoder` | Stored only |
| `steps` | **Steps**; also feeds queue ETA |
| `gradient_accumulation` | Stored only |
| `train_unet` / `train_text_encoder` | Stored only |
| `gradient_checkpointing` | **Gradient checkpointing** |
| `noise_scheduler`, `timestep_type`, `content_or_style`, `loss_type` | Stored only |
| `optimizer` | **Optimizer** |
| `optimizer_params.weight_decay` | Stored only |
| `lr` | **Learning rate** (scientific notation accepted) |
| `ema_config.*` | Stored only |
| `skip_first_sample` | **Skip first sample** |
| `disable_sampling` | **Disable sampling** |
| `dtype` | Written with **Data Type** in Save |
| `diff_output_preservation*` | Stored only |

### `model` (library-wide)

Edited in **Settings → External tools → Training model**, stored on
`settings.defaultTrainingConfig.model`. Stamped onto every job’s `config.yaml` at
start / export. **Krea 2 only**.

| YAML | UI |
| --- | --- |
| `name_or_path` | **Checkpoint path** |
| `arch` | **Architecture**: Krea 2 (raw), Krea 2 Turbo (w/ Training Adapter), and the Edit Training variant of each |
| `quantize` | **Quantize** |
| `qtype` | Stored only; no selector |
| `quantize_te` / `qtype_te` | Stored only; no controls |
| `low_vram` | **Low VRAM** |
| `layer_offloading` | Driven by **Layer offloading**; 0% disables it |
| `layer_offloading_transformer_percent` | **Layer offloading** slider, 0–100% in 5% steps |
| `layer_offloading_text_encoder_percent` | Stored only; no control |
| `model_kwargs` | Stored only; no advanced JSON editor |

### `sample` (often unused when sampling disabled)

| YAML | UI |
| --- | --- |
| `sampler`, `sample_every`, `width`, `height` | Stored only |
| `prompts` | **Prompts (one per line)** |
| `neg`, `seed`, `walk_seed`, `guidance_scale`, `sample_steps` | Stored only |

### `logging`

| YAML | Behavior |
| --- | --- |
| `log_every` | Stored only |
| `use_ui_logger` | Stored only |

There is no Logging section on the form.

Stored sample width and height default to 1024. Dataset **Resolution (comma)** defaults to 512; it does not resize or enlarge source images.

## Form UX

- Six collapsible sections: **Job / process**, **Network**, **Save**, **Dataset**,
  **Train**, and **Sample**.
- There is no “Apply 16 GB smoke defaults” button and no Logging section.
- LoRA name is sanitized to letters, numbers, `_`, and `-`.
- Jobs autosave after about 450 ms and show **Saving…** / **Saved**. **Enqueue** flushes pending edits. There is no separate Save button.

Data Type choices are **BF16**, **FP16**, and **FP32**.

Optimizer choices, exactly as shown: **AdamW 8-bit (bitsandbytes)**, **Adam 8-bit (bitsandbytes)**, **AdEMAMix 8-bit (bitsandbytes)**, **Lion 8-bit (bitsandbytes)**, **AdamW 8-bit (toolkit)**, **Adam 8-bit (toolkit)**, **Prodigy 8-bit**, **Prodigy**, **AdamW**, **Adam**, **Lion**, **Adafactor**, **Adagrad**, **Automagic**, **Automagic 2**, **Automagic 3**, and **DAdaptation (legacy)**.

## Materialisation algorithm

```
defaults = settings.defaultTrainingConfig
jobConfig = deepClone(defaults)
jobConfig.name = sanitize(suggestedOrEditedLoraName)
# suggested = existing output stem, else Category_Dataset (see D19)
jobConfig.trigger_word = dataset.trigger || jobConfig.trigger_word
jobConfig.datasets[0].folder_path = dataset.folderPath
jobConfig.training_folder = path.join(dataset.folderPath, 'output')
jobConfig.train.steps = lastQueuedJob.steps ?? settings.steps ?? 2000
jobConfig.save.save_every = lastQueuedJob.saveEvery ?? settings.saveEvery ?? 250
# replace CONCEPT_* placeholders if any remain
# apply any other job-level overrides already edited in UI
persist job.config = jobConfig                 // D4 JSON source of truth (except model)
writeYaml(jobs/{id}/config.yaml, wrapProcess({
  ...jobConfig,
  model: settings.defaultTrainingConfig.model   // D26 library-wide
}))
```

Exact YAML envelope (`job: extension`, `config.process: [...]`, `meta`) must
match what AI Toolkit expects.

**Fixture note:** `reference/config-sample.yaml` uses template tokens such as
`steps: CONCEPT_STEPS`. That is documentation/template form — for golden parse
tests, use a resolved copy with an integer `steps` and real paths
(see `docs/DEVELOPMENT.md`).

