"""Local speech-to-text with faster-whisper (optional dependency).

Honest status reporting: `not_installed` when the package is missing, `error` when the model
cannot be loaded (e.g. offline host without cached weights), `ready` only after a real load.
"""

from __future__ import annotations

import logging
import math
import os
import re
import shutil
import threading
from dataclasses import dataclass

import numpy as np

log = logging.getLogger(__name__)

# Phrases Whisper is known to hallucinate on non-speech audio.
_HALLUCINATIONS = {
    "thank you.",
    "thanks for watching!",
    "thank you for watching.",
    "you",
    "bye.",
    "subtitles by the amara.org community",
    "please subscribe.",
    ".",
    "",
}


@dataclass
class SttSegment:
    rel_start: float
    rel_end: float
    text: str
    kind: str  # speech | unintelligible
    confidence: float | None
    language: str | None


class SttEngine:
    def __init__(self, model: str, device: str, compute_type: str, model_dir: str | None, enabled: bool):
        self.model_name = model
        self.req_device = device
        self.req_compute = compute_type
        self.model_dir = model_dir
        self.enabled = enabled
        self.state = "disabled" if not enabled else "loading"
        self.detail: str | None = None
        self.device = "cpu"
        self._model = None
        self._lock = threading.Lock()

    def load(self) -> None:
        if not self.enabled:
            return
        try:
            from faster_whisper import WhisperModel
        except Exception:
            self.state, self.detail = "not_installed", "pip install 'echosentinel[stt]' to enable"
            return
        device = self.req_device
        if device == "auto":
            device = "cuda" if shutil.which("nvidia-smi") else "cpu"
        compute = self.req_compute
        if compute == "auto":
            compute = "float16" if device == "cuda" else "int8"
        try:
            self._model = WhisperModel(
                self.model_name,
                device=device,
                compute_type=compute,
                download_root=self.model_dir,
                cpu_threads=max(1, (os.cpu_count() or 2) - 1),
            )
            self.device = device
            self.state, self.detail = "ready", f"{self.model_name} on {device}/{compute}"
        except Exception as e:  # network-less host without cached model, etc.
            msg = str(e).splitlines()[0][:200]
            if "snapshot" in msg or "offline" in msg.lower() or "connect" in msg.lower():
                self.state, self.detail = "error", f"Whisper '{self.model_name}' weights not cached — run scripts/fetch-models.sh"
            else:
                self.state, self.detail = "error", f"Model load failed: {msg}"
            log.warning("STT model load failed: %s", msg)

    @property
    def ready(self) -> bool:
        return self.state == "ready" and self._model is not None

    def transcribe(self, audio: np.ndarray, language: str | None) -> list[SttSegment]:
        if not self.ready:
            return []
        with self._lock:
            segments, info = self._model.transcribe(  # type: ignore[union-attr]
                audio,
                language=None if language in (None, "auto") else language,
                beam_size=1 if self.device == "cpu" else 5,
                vad_filter=False,
                condition_on_previous_text=False,
                temperature=0.0,
            )
            out: list[SttSegment] = []
            for s in segments:
                text = re.sub(r"\s+", " ", s.text).strip()
                conf = math.exp(s.avg_logprob) if s.avg_logprob is not None else None
                if s.no_speech_prob > 0.6 or (s.no_speech_prob > 0.3 and text.lower() in _HALLUCINATIONS):
                    continue
                if not text:
                    continue
                kind = "speech"
                if conf is not None and conf < 0.35 or s.compression_ratio > 2.6:
                    # Too uncertain to present as verbatim speech.
                    kind, text = "unintelligible", "[unintelligible speech]"
                out.append(SttSegment(s.start, s.end, text, kind, round(conf, 3) if conf else None, info.language))
            return out
