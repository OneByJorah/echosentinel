"""Pipeline logic with stand-in engines (real model weights are not available in CI)."""

from __future__ import annotations

import zipfile

import numpy as np

from echosentinel.audio.classifier import Classifier
from echosentinel.audio.pipeline import Pipeline
from echosentinel.audio.stt import SttSegment
from echosentinel.bus import AudioFanout, Bus
from echosentinel.db import Database
from echosentinel.settings_store import SettingsStore


class FakeClassifier:
    ready = True
    model_version = "fake-1"

    def __init__(self, results):
        self.results = results

    def classify(self, window):
        return self.results


class FakeStt:
    ready = True

    def transcribe(self, audio, language):
        return [SttSegment(0.1, 1.2, "keep an eye on the front", "speech", 0.81, "en")]


class NoStt:
    ready = False


def make(tmp_path, cls=None, stt=None):
    db = Database(tmp_path / "p.db")
    bus = Bus()
    sub = bus.subscribe()
    events = []
    p = Pipeline(
        db, bus, AudioFanout(), SettingsStore(db), stt or NoStt(), cls or FakeClassifier([]), on_peak_second=lambda *a: None, on_event=events.append
    )
    return p, db, sub, events


async def test_threshold_and_cooldown(tmp_path):
    p, db, sub, events = make(tmp_path, FakeClassifier([("Dog", "barking", 0.9), ("Music", None, 0.99), ("Car", "vehicle", 0.3)]))
    await p._handle_scores(1, 1000.0, p.classifier.classify(None), 12)
    await p._handle_scores(1, 1010.0, p.classifier.classify(None), 12)  # within 60 s cooldown -> suppressed
    await p._handle_scores(1, 1100.0, p.classifier.classify(None), 12)
    rows = db.query("SELECT category, score FROM events")
    assert [r["category"] for r in rows] == ["barking", "barking"]  # vehicle below threshold, music unmapped
    assert len(events) == 2


async def test_disabled_category_never_fires(tmp_path):
    p, db, *_ = make(tmp_path, FakeClassifier([("Speech", "speech", 0.95)]))
    await p._handle_scores(1, 0.0, p.classifier.classify(None), 5)  # speech disabled by default
    assert db.query("SELECT * FROM events") == []


async def test_stt_utterance_persisted_and_published(tmp_path):
    from echosentinel.audio.vad import Utterance

    p, db, sub, _ = make(tmp_path, stt=FakeStt())
    p.vad.available = False
    await p._handle_utterance(Utterance(1, 1_700_000_000.0, np.zeros(16000, np.float32)))
    row = db.one("SELECT * FROM segments")
    assert row["text"] == "keep an eye on the front" and row["confidence"] == 0.81
    msg = sub.queue.get_nowait()
    assert msg["type"] == "transcript" and msg["speaker"] is None


async def test_hot_path_levels_and_windows(tmp_path):
    p, db, sub, _ = make(tmp_path, FakeClassifier([]))
    pcm = (np.sin(np.arange(1600) * 0.3) * 8000).astype("<i2").tobytes()
    for i in range(12):
        p.on_pcm(1, pcm, 1000 + i * 0.1)
    assert sub.queue.get_nowait()["type"] == "levels"
    assert p.cls_q.qsize() >= 1  # 1.2 s buffered -> at least one 0.975 s window queued


async def test_queue_backpressure_drops_oldest(tmp_path):
    p, *_ = make(tmp_path)
    for i in range(20):
        p._enqueue(p.cls_q, (1, float(i), np.zeros(1)), "cls")
    assert p.cls_q.qsize() == 16 and p.cls_dropped == 4
    assert p.cls_q.get_nowait()[1] == 4.0


def test_classifier_not_configured_is_honest(tmp_path):
    c = Classifier(tmp_path / "missing.tflite", enabled=True)
    c.load()
    assert c.state in ("not_configured", "not_installed") and not c.ready
    assert c.classify(np.zeros(15600)) == []


def test_classifier_reads_embedded_labels(tmp_path):
    f = tmp_path / "yamnet.tflite"
    with zipfile.ZipFile(f, "w") as z:
        z.writestr("yamnet_label_list.txt", "Speech\nDog\nGlass\n")
    assert Classifier(f, True)._load_labels() == ["Speech", "Dog", "Glass"]


def test_stt_without_package_or_weights_reports_state(tmp_path):
    from echosentinel.audio.stt import SttEngine

    s = SttEngine("tiny", "cpu", "int8", str(tmp_path / "nomodels"), enabled=True)
    s.load()
    assert s.state in ("ready", "error", "not_installed")
    if s.state != "ready":
        assert s.transcribe(np.zeros(16000, np.float32), None) == []


async def test_indexer_does_not_finalise_growing_segment(tmp_path):
    """Regression: on startup the newest file must stay 'writing' even before the worker reports recording."""
    import os
    import subprocess
    import time as _t

    from echosentinel.recorder import Recorder

    db = Database(tmp_path / "r.db")
    rec_dir = tmp_path / "rec"
    (rec_dir / "ch01").mkdir(parents=True)
    f = rec_dir / "ch01" / "ch01_20261102T060000Z.mp3"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=2", "-c:a", "libmp3lame", str(f)], check=True)
    r = Recorder(
        db,
        rec_dir,
        SettingsStore(db),
        "ffmpeg",
        "ffprobe",
        slot_to_channel=lambda s: s,
        is_recording=lambda ch: False,
        notify=lambda *a: None,
        on_record_allowed_change=lambda a: None,
    )
    await r.index_once()
    assert db.one("SELECT status FROM recordings")["status"] == "writing"  # fresh mtime
    old = _t.time() - 120
    os.utime(f, (old, old))
    await r.index_once()
    row = db.one("SELECT status, duration_s FROM recordings")
    assert row["status"] == "complete" and 1.9 < row["duration_s"] < 2.2
    with f.open("ab") as fh:  # file grows again (e.g. same-name restart) -> re-examined
        fh.write(f.read_bytes()[:4096])
    await r.index_once()
    assert db.one("SELECT status FROM recordings")["status"] == "writing"
