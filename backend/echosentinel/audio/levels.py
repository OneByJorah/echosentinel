"""Level metering from real decoded PCM."""

from __future__ import annotations

import numpy as np

WINDOW = 320  # 20 ms @ 16 kHz


def pcm_to_float(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def peaks_and_rms(samples: np.ndarray) -> tuple[list[float], float]:
    n = len(samples) // WINDOW
    if n == 0:
        return [], 0.0
    win = np.abs(samples[: n * WINDOW]).reshape(n, WINDOW)
    peaks = np.round(win.max(axis=1), 4).tolist()
    rms = float(np.sqrt(np.mean(samples**2))) if len(samples) else 0.0
    return peaks, round(rms, 5)
