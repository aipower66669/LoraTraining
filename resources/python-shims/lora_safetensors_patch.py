"""
Force non-mmap safetensors loads on Windows (OSError 1455 / commit charge).

Used by sitecustomize.py and train_bootstrap.py.

Strategy:
1. Prefer native `backend=pread|read_file` / `mmap=False` when the installed
   safetensors supports them (0.5+/newer).
2. Otherwise stream tensors with plain file seek/read (never CreateFileMapping,
   never `f.read()` of the whole multi‑GB file).

System Python / AI Toolkit often ship safetensors 0.4.x with no backend kwarg —
that path used to hit MemoryError on a full-file bytes load.
"""

from __future__ import annotations

import json
import os
import struct
import sys
from typing import Any

_PATCHED = False
_ALLOW_MMAP = os.environ.get("LORA_TRAINING_ALLOW_SAFETENSORS_MMAP", "").strip().lower() in (
    "1",
    "true",
    "yes",
)
_LOGGED_ONCE: set[str] = set()


def _log(msg: str) -> None:
    print(f"[LoraTraining] {msg}", file=sys.stderr, flush=True)


def _log_once(key: str, msg: str) -> None:
    if key in _LOGGED_ONCE:
        return
    _LOGGED_ONCE.add(key)
    _log(msg)


def _strip_mmap_kwargs(kwargs: dict) -> dict:
    cleaned = dict(kwargs)
    cleaned.pop("backend", None)
    cleaned.pop("mmap", None)
    return cleaned


def _prefer_non_mmap() -> list[dict]:
    return [
        {"backend": "pread"},
        {"backend": "read_file"},
        {"mmap": False},
    ]


# --- Streaming safetensors reader (no mmap, no full-file buffer) ----------------

_TORCH_DTYPES: dict[str, str] = {
    "F64": "float64",
    "F32": "float32",
    "F16": "float16",
    "BF16": "bfloat16",
    "I64": "int64",
    "I32": "int32",
    "I16": "int16",
    "I8": "int8",
    "U8": "uint8",
    "BOOL": "bool",
}

_NUMPY_DTYPES: dict[str, str] = {
    "F64": "float64",
    "F32": "float32",
    "F16": "float16",
    # BF16: handled specially
    "I64": "int64",
    "I32": "int32",
    "I16": "int16",
    "I8": "int8",
    "U8": "uint8",
    "BOOL": "bool",
}


def _parse_header(f) -> tuple[dict, int]:
    size_bytes = f.read(8)
    if len(size_bytes) != 8:
        raise OSError("truncated safetensors header size")
    header_size = struct.unpack("<Q", size_bytes)[0]
    header_bytes = f.read(header_size)
    if len(header_bytes) != header_size:
        raise OSError("truncated safetensors header")
    header = json.loads(header_bytes)
    data_start = 8 + header_size
    return header, data_start


def _tensor_entries(header: dict) -> dict[str, dict]:
    return {k: v for k, v in header.items() if k != "__metadata__" and isinstance(v, dict)}


def _read_tensor_bytes(f, info: dict, data_start: int) -> bytes:
    start, end = info["data_offsets"]
    nbytes = end - start
    if nbytes < 0:
        raise OSError(f"invalid data_offsets: {info['data_offsets']}")
    f.seek(data_start + start)
    buf = f.read(nbytes)
    if len(buf) != nbytes:
        raise OSError(f"truncated tensor payload ({len(buf)}/{nbytes} bytes)")
    return buf


def _bytes_to_torch(buf: bytes, info: dict, device: Any):
    import torch

    dtype_key = info["dtype"]
    shape = tuple(info["shape"])
    torch_name = _TORCH_DTYPES.get(dtype_key)
    if torch_name is None:
        raise TypeError(f"unsupported safetensors dtype: {dtype_key}")
    dtype = getattr(torch, torch_name)

    # Copy into a fresh bytearray so frombuffer does not retain a view of `buf`
    # after we drop it (avoids holding two copies longer than needed).
    storage = bytearray(buf)
    del buf
    tensor = torch.frombuffer(storage, dtype=dtype)
    if shape:
        tensor = tensor.reshape(shape)
    # Detach from the bytearray backing store.
    tensor = tensor.clone()
    del storage

    if device is not None and device != "cpu":
        tensor = tensor.to(device)
    return tensor


def _bytes_to_numpy(buf: bytes, info: dict):
    import numpy as np

    dtype_key = info["dtype"]
    shape = tuple(info["shape"])
    if dtype_key == "BF16":
        # numpy has no bfloat16 until recent; view as uint16 then let caller handle.
        arr = np.frombuffer(buf, dtype=np.uint16).copy().reshape(shape)
        return arr
    np_name = _NUMPY_DTYPES.get(dtype_key)
    if np_name is None:
        raise TypeError(f"unsupported safetensors dtype: {dtype_key}")
    arr = np.frombuffer(buf, dtype=np.dtype(np_name)).copy()
    if shape:
        arr = arr.reshape(shape)
    return arr


def load_file_streaming_torch(filename: str, device: Any = "cpu") -> dict:
    """Load a .safetensors file one tensor at a time via seek/read (no mmap)."""
    out: dict = {}
    with open(filename, "rb") as f:
        header, data_start = _parse_header(f)
        entries = _tensor_entries(header)
        for name, info in entries.items():
            buf = _read_tensor_bytes(f, info, data_start)
            out[name] = _bytes_to_torch(buf, info, device)
            del buf
    return out


def load_file_streaming_numpy(filename: str) -> dict:
    out: dict = {}
    with open(filename, "rb") as f:
        header, data_start = _parse_header(f)
        for name, info in _tensor_entries(header).items():
            buf = _read_tensor_bytes(f, info, data_start)
            out[name] = _bytes_to_numpy(buf, info)
            del buf
    return out


class _StreamingSafeOpenTorch:
    """safe_open stand-in: get_tensor() seek/reads one tensor (no mmap)."""

    def __init__(self, filename: str, device: Any = "cpu"):
        self._filename = filename
        self._device = device
        self._f = None
        self._header: dict = {}
        self._data_start = 0
        self._entries: dict[str, dict] = {}
        self._metadata = None

    def __enter__(self):
        self._f = open(self._filename, "rb")
        self._header, self._data_start = _parse_header(self._f)
        self._entries = _tensor_entries(self._header)
        meta = self._header.get("__metadata__")
        self._metadata = meta if isinstance(meta, dict) else None
        return self

    def __exit__(self, *exc):
        if self._f is not None:
            self._f.close()
            self._f = None
        return False

    def keys(self):
        return self._entries.keys()

    def offset_keys(self):
        """Names ordered by file offset (safetensors ≥0.5)."""
        return sorted(
            self._entries.keys(),
            key=lambda n: self._entries[n]["data_offsets"][0],
        )

    def get_tensor(self, name: str):
        if self._f is None:
            raise RuntimeError("safe_open handle is closed")
        info = self._entries[name]
        buf = _read_tensor_bytes(self._f, info, self._data_start)
        return _bytes_to_torch(buf, info, self._device)

    def get_tensors(self):
        """safetensors ≥0.5 / AI Toolkit: load every tensor (streaming, no mmap)."""
        return {name: self.get_tensor(name) for name in self._entries}

    def get_slice(self, name: str):
        raise NotImplementedError(
            "get_slice is unavailable under the LoraTraining streaming safetensors shim"
        )

    def metadata(self):
        return self._metadata


class _LoadedSafeOpen:
    """In-memory stand-in after a full streaming load_file."""

    def __init__(self, tensors: dict, metadata: dict | None = None):
        self._tensors = tensors
        self._metadata = metadata

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._tensors = {}
        return False

    def keys(self):
        return self._tensors.keys()

    def offset_keys(self):
        return list(self._tensors.keys())

    def get_tensor(self, name: str):
        return self._tensors[name]

    def get_tensors(self):
        return dict(self._tensors)

    def get_slice(self, name: str):
        raise NotImplementedError(
            "get_slice is unavailable under the LoraTraining non-mmap safetensors shim"
        )

    def metadata(self):
        return self._metadata


_COMMIT_HELP = (
    "Windows commit charge exhausted (OSError 1455). "
    "This is system-wide — close/kill leftover python.exe / Comfy / training processes, "
    "or reboot. Do not keep retrying loads; each attempt makes it worse. "
    "LoraTraining will not fall through to a heavier loader after 1455."
)


def _is_commit_exhausted(err: BaseException) -> bool:
    if isinstance(err, MemoryError):
        return True
    if not isinstance(err, OSError):
        return False
    if getattr(err, "winerror", None) == 1455:
        return True
    text = str(err)
    return "1455" in text or "paging file is too small" in text.lower()


def _raise_commit_exhausted(where: str, err: BaseException | None = None) -> None:
    _log(f"ABORT {where}: {_COMMIT_HELP}")
    raise OSError(1455, _COMMIT_HELP) from err


def _log_windows_commit() -> None:
    """Best-effort commit / virtual-memory snapshot for the train log."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import wintypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", wintypes.DWORD),
                ("dwMemoryLoad", wintypes.DWORD),
                ("ullTotalPhys", ctypes.c_uint64),
                ("ullAvailPhys", ctypes.c_uint64),
                ("ullTotalPageFile", ctypes.c_uint64),
                ("ullAvailPageFile", ctypes.c_uint64),
                ("ullTotalVirtual", ctypes.c_uint64),
                ("ullAvailVirtual", ctypes.c_uint64),
                ("ullAvailExtendedVirtual", ctypes.c_uint64),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return
        gb = 1024**3
        _log(
            "memory before load: "
            f"phys {stat.ullAvailPhys / gb:.1f}/{stat.ullTotalPhys / gb:.1f} GB free, "
            f"commit(pagefile) {stat.ullAvailPageFile / gb:.1f}/{stat.ullTotalPageFile / gb:.1f} GB free, "
            f"load={stat.dwMemoryLoad}%"
        )
        # AvailPageFile is remaining commit charge — when this is small, Krea cannot load.
        if stat.ullAvailPageFile < 8 * gb:
            _log(
                "WARNING: less than 8 GB commit remaining — loading Krea/Flux will likely "
                "fail with OSError 1455. Kill leftover python.exe processes or reboot first."
            )
    except Exception as e:
        _log(f"memory probe skipped ({e})")


def _patch_module_load_file(mod, kind: str) -> str | None:
    orig = getattr(mod, "load_file", None)
    if not callable(orig) or getattr(orig, "_lora_training_patched", False):
        return None

    def load_file(filename, device="cpu", *args, **kwargs):  # noqa: ANN001
        if _ALLOW_MMAP:
            return orig(filename, device, *args, **kwargs)

        cleaned = _strip_mmap_kwargs(kwargs)
        for extra in _prefer_non_mmap():
            try:
                result = orig(filename, device, *args, **{**cleaned, **extra})
                _log_once("load_file_backend", f"safetensors load_file via {extra}")
                return result
            except TypeError:
                continue
            except Exception as e:
                if _is_commit_exhausted(e):
                    _raise_commit_exhausted(f"load_file {extra}", e)
                raise

        # No backend=/mmap= API (e.g. 0.4.x) — stream without mmap. Never after 1455.
        _log_once("load_file_stream", f"safetensors load_file streaming ({kind})")
        try:
            if kind == "torch":
                return load_file_streaming_torch(filename, device)
            return load_file_streaming_numpy(filename)
        except Exception as e:
            if _is_commit_exhausted(e):
                _raise_commit_exhausted("load_file streaming", e)
            raise

    load_file._lora_training_patched = True  # type: ignore[attr-defined]
    mod.load_file = load_file
    return kind


def _patch_load_model(st) -> bool:
    orig = getattr(st, "load_model", None)
    if not callable(orig) or getattr(orig, "_lora_training_patched", False):
        return False

    def load_model(model, filename, *args, **kwargs):  # noqa: ANN001
        if _ALLOW_MMAP:
            return orig(model, filename, *args, **kwargs)
        load_file = getattr(st, "load_file", None)
        device = kwargs.get("device", "cpu")
        strict = kwargs.get("strict", True)
        try:
            if callable(load_file) and getattr(load_file, "_lora_training_patched", False):
                state = load_file(filename, device=device)
            else:
                state = load_file_streaming_torch(filename, device)
        except Exception as e:
            if _is_commit_exhausted(e):
                _raise_commit_exhausted("load_model", e)
            raise
        return model.load_state_dict(state, strict=strict)

    load_model._lora_training_patched = True  # type: ignore[attr-defined]
    st.load_model = load_model
    return True


def _call_safe_open_native(orig, filename, framework, device, args, cleaned, extra):
    """Try keyword and positional forms — safetensors 0.4–0.8 differ."""
    attempts = [
        lambda: orig(
            filename, framework=framework, device=device, *args, **{**cleaned, **extra}
        ),
        lambda: orig(filename, framework, device=device, **{**cleaned, **extra}),
        lambda: orig(filename, framework, **{**cleaned, **extra}),
    ]
    last_type = None
    for attempt in attempts:
        try:
            return attempt()
        except TypeError as e:
            last_type = e
            continue
    if last_type:
        raise last_type
    raise TypeError("safe_open native call failed")


def _patch_safe_open(root) -> bool:
    orig = getattr(root, "safe_open", None)
    if not callable(orig) or getattr(orig, "_lora_training_patched", False):
        return False

    def safe_open(filename, framework=None, device="cpu", *args, **kwargs):  # noqa: ANN001
        if _ALLOW_MMAP:
            return orig(filename, framework=framework, device=device, *args, **kwargs)

        cleaned = _strip_mmap_kwargs(kwargs)
        for extra in _prefer_non_mmap():
            try:
                result = _call_safe_open_native(
                    orig, filename, framework, device, args, cleaned, extra
                )
                _log_once("safe_open_backend", f"safetensors safe_open via {extra}")
                return result
            except TypeError:
                continue
            except Exception as e:
                if _is_commit_exhausted(e):
                    # Do NOT stream after 1455 — that allocates more and can brick the session.
                    _raise_commit_exhausted(f"safe_open {extra}", e)
                raise

        fw = (framework or "pt").lower()
        _log_once("safe_open_stream", f"safetensors safe_open streaming ({fw})")
        if fw in ("pt", "torch", "pytorch"):
            return _StreamingSafeOpenTorch(filename, device)
        if fw in ("np", "numpy"):
            return _LoadedSafeOpen(load_file_streaming_numpy(filename))

        raise RuntimeError(
            f"Cannot open {filename!r} without mmap for framework={framework!r}; "
            "upgrade safetensors (pip install -U 'safetensors>=0.5')"
        )

    safe_open._lora_training_patched = True  # type: ignore[attr-defined]
    root.safe_open = safe_open
    return True


def apply(*, force_log: bool = False) -> bool:
    """Patch safetensors entry points. Safe to call multiple times."""
    global _PATCHED
    if sys.platform != "win32":
        if force_log:
            _log("safetensors shim skipped (not Windows)")
        return False
    if _ALLOW_MMAP:
        if force_log:
            _log("safetensors shim disabled (LORA_TRAINING_ALLOW_SAFETENSORS_MMAP=1)")
        return False
    if _PATCHED:
        if force_log:
            _log("safetensors Windows shim already active")
        return True

    _log_windows_commit()

    try:
        import safetensors as root
    except Exception as e:
        _log(f"safetensors Windows shim: cannot import safetensors ({e})")
        return False

    ver = getattr(root, "__version__", "unknown")
    changed = _patch_safe_open(root)

    try:
        import safetensors.torch as st

        changed = bool(_patch_module_load_file(st, "torch")) or changed
        changed = _patch_load_model(st) or changed
    except Exception as e:
        _log(f"safetensors.torch not patchable ({e})")

    try:
        import safetensors.numpy as sn

        changed = bool(_patch_module_load_file(sn, "numpy")) or changed
    except Exception:
        pass

    if changed:
        _PATCHED = True
        _log(
            f"safetensors Windows shim ACTIVE (safetensors {ver}; "
            "prefer pread; stream only if API missing; ABORT on OSError 1455 — no heavier fallback)"
        )
    else:
        _log(f"safetensors Windows shim: nothing patched (safetensors {ver})")
    return changed
