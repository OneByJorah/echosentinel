"""Utterance segmentation.

Stage 1 (always): adaptive energy gate with hangover -> candidate utterances (cheap, per chunk).
Stage 2 (when available): Silero VAD (bundled with faster-whisper, ONNX) confirms the candidate
actually contains speech before it is queued for transcription — this is what keeps traffic,
wind and HVAC noise from burning STT time or producing hallucinated text.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

RATE = 16000


@dataclass
class Utterance:
    channel_id: int
    start_ts: float  # epoch seconds of first sample
    audio: np.ndarray  # float32 mono 16 kHz


class EnergySegmenter:
    def __init__(
        self,
        channel_id: int,
        *,
        min_speech_s: float = 0.4,
        hangover_s: float = 0.8,
        max_utt_s: float = 15.0,
        pre_roll_s: float = 0.3,
        ratio: float = 3.0,
        abs_floor: float = 0.004,
    ):
        self.channel_id = channel_id
        self.min_speech_s, self.hangover_s, self.max_utt_s = min_speech_s, hangover_s, max_utt_s
        self.pre_roll = int(pre_roll_s * RATE)
        self.ratio, self.abs_floor = ratio, abs_floor
        self.noise_floor = 0.003
        self._buf: list[np.ndarray] = []
        self._pre: np.ndarray = np.zeros(0, dtype=np.float32)
        self._active = False
        self._start_ts = 0.0
        self._silence_s = 0.0
        self._voiced_s = 0.0
        self._len = 0

    @property
    def active(self) -> bool:
        return self._active

    def feed(self, samples: np.ndarray, ts: float) -> Utterance | None:
        """Feed a chunk (e.g. 100 ms). Returns a finished utterance when one closes."""
        dur = len(samples) / RATE
        rms = float(np.sqrt(np.mean(samples**2))) if len(samples) else 0.0
        threshold = max(self.abs_floor, self.noise_floor * self.ratio)
        loud = rms > threshold
        if not loud and not self._active:
            # slow-adapting noise floor estimate (only while idle)
            self.noise_floor = 0.95 * self.noise_floor + 0.05 * max(rms, 1e-5)
        if not self._active:
            if loud:
                self._active = True
                self._start_ts = ts - len(self._pre) / RATE
                self._buf = [self._pre, samples]
                self._len = len(self._pre) + len(samples)
                self._silence_s, self._voiced_s = 0.0, dur
            else:
                self._pre = np.concatenate([self._pre, samples])[-self.pre_roll :]
            return None
        self._buf.append(samples)
        self._len += len(samples)
        if loud:
            self._silence_s = 0.0
            self._voiced_s += dur
        else:
            self._silence_s += dur
        if self._silence_s >= self.hangover_s or self._len / RATE >= self.max_utt_s:
            return self._close()
        return None

    def _close(self) -> Utterance | None:
        audio = np.concatenate(self._buf) if self._buf else np.zeros(0, np.float32)
        voiced = self._voiced_s
        self._buf, self._len, self._active = [], 0, False
        self._pre = np.zeros(0, dtype=np.float32)
        if voiced < self.min_speech_s:
            return None
        return Utterance(self.channel_id, self._start_ts, audio)


class SileroConfirm:
    """Wraps faster-whisper's bundled Silero VAD if importable."""

    def __init__(self) -> None:
        self.available = False
        self.engine = "energy"
        try:
            from faster_whisper.vad import VadOptions, get_speech_timestamps  # noqa: F401

            self._get = get_speech_timestamps
            self._opts = VadOptions(min_speech_duration_ms=250, min_silence_duration_ms=300)
            self.available = True
            self.engine = "silero"
        except Exception:  # noqa: S110 - optional dependency
            self.available = False

    def speech_seconds(self, audio: np.ndarray) -> float | None:
        if not self.available:
            return None
        ts = self._get(audio, self._opts)
        return sum((t["end"] - t["start"]) for t in ts) / RATE
