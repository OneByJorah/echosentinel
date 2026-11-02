"""Acoustic event classification with YAMNet (TFLite, AudioSet 521 classes).

Runtime: `ai-edge-litert` (or legacy `tflite-runtime`). The model is fetched once by
`scripts/fetch-models.sh`; if it is absent the classifier reports `not_configured` and produces
no events — never synthetic ones.
"""

from __future__ import annotations

import csv
import io
import logging
import threading
import zipfile
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

WINDOW = 15600  # 0.975 s @ 16 kHz, YAMNet's native patch

# AudioSet display-name keywords -> EchoSentinel categories. Order matters (first match wins).
CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("gunshot_like", ("gunshot", "gunfire", "machine gun", "cap gun", "fusillade", "artillery", "explosion")),
    ("glass_break", ("glass", "shatter")),
    ("alarm_siren", ("siren", "alarm", "smoke detector", "buzzer", "foghorn", "civil defense")),
    ("distress", ("scream", "shout", "yell", "crying, sobbing", "wail", "whimper")),
    ("barking", ("bark", "bow-wow", "dog", "howl", "growling", "yip")),
    ("knock", ("knock", "door", "doorbell", "tap")),
    ("vehicle", ("vehicle", "car", "truck", "motorcycle", "bus", "engine", "traffic", "tire squeal", "skidding", "honk")),
    ("speech", ("speech", "conversation", "narration", "babbling")),
]


def label_category(label: str) -> str | None:
    lab = label.lower()
    for cat, keys in CATEGORY_RULES:
        if any(k in lab for k in keys):
            return cat
    return None


class Classifier:
    def __init__(self, model_path: Path, enabled: bool):
        self.model_path = model_path
        self.enabled = enabled
        self.state = "disabled" if not enabled else "loading"
        self.detail: str | None = None
        self.model_version = "yamnet-tflite"
        self.labels: list[str] = []
        self._interp = None
        self._lock = threading.Lock()
        self._label_cat: list[str | None] = []

    def load(self) -> None:
        if not self.enabled:
            return
        Interpreter = None
        try:
            from ai_edge_litert.interpreter import Interpreter  # type: ignore
        except Exception:
            try:
                from tflite_runtime.interpreter import Interpreter  # type: ignore
            except Exception:
                self.state, self.detail = "not_installed", "pip install 'echosentinel[classifier]'"
                return
        if not self.model_path.exists():
            self.state = "not_configured"
            self.detail = f"Model not found at {self.model_path.name}; run scripts/fetch-models.sh"
            return
        try:
            self.labels = self._load_labels()
            interp = Interpreter(model_path=str(self.model_path))
            inp = interp.get_input_details()[0]
            if list(inp["shape"]) != [WINDOW] and list(inp["shape"]) != [1, WINDOW]:
                interp.resize_tensor_input(inp["index"], [WINDOW], strict=False)
            interp.allocate_tensors()
            self._interp = interp
            self._label_cat = [label_category(lab) for lab in self.labels]
            self.model_version = f"yamnet-tflite:{self.model_path.stat().st_size}"
            self.state, self.detail = "ready", f"{len(self.labels)} classes"
        except Exception as e:
            self.state, self.detail = "error", f"Load failed: {str(e)[:200]}"
            log.warning("classifier load failed: %s", e)

    def _load_labels(self) -> list[str]:
        csv_path = self.model_path.with_name("yamnet_class_map.csv")
        if csv_path.exists():
            with csv_path.open() as f:
                return [row["display_name"] for row in csv.DictReader(f)]
        # The TFLite Task Library model embeds its label list in a zip appended to the flatbuffer.
        with zipfile.ZipFile(self.model_path) as z:
            name = next(n for n in z.namelist() if n.endswith(".txt"))
            return [ln.strip() for ln in io.TextIOWrapper(z.open(name)).readlines() if ln.strip()]

    @property
    def ready(self) -> bool:
        return self.state == "ready" and self._interp is not None

    def classify(self, window: np.ndarray, top_k: int = 5) -> list[tuple[str, str | None, float]]:
        """Return top-k (label, category, score) for one 0.975 s window."""
        if not self.ready:
            return []
        x = window.astype(np.float32)
        with self._lock:
            interp = self._interp
            inp = interp.get_input_details()[0]  # type: ignore[union-attr]
            if len(inp["shape"]) == 2:
                x = x.reshape(1, -1)
            interp.set_tensor(inp["index"], x)  # type: ignore[union-attr]
            interp.invoke()  # type: ignore[union-attr]
            out = interp.get_output_details()[0]  # type: ignore[union-attr]
            scores = np.asarray(interp.get_tensor(out["index"]))  # type: ignore[union-attr]
        if scores.ndim > 1:
            scores = scores.mean(axis=0)
        idx = np.argsort(scores)[::-1][:top_k]
        return [(self.labels[i], self._label_cat[i], float(scores[i])) for i in idx]
