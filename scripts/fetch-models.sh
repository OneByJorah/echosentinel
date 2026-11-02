#!/usr/bin/env bash
# Download local AI models once. Everything runs offline afterwards.
set -euo pipefail
DEST="${1:-${ES_DATA_DIR:-./data}/models}"
STT_MODEL="${ES_STT_MODEL:-base}"
mkdir -p "$DEST"

echo "==> YAMNet acoustic event classifier (TFLite, 521 AudioSet classes, labels embedded)"
YAMNET_URL="https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite"
if [[ ! -f $DEST/yamnet.tflite ]]; then
  curl -fL --retry 3 -o "$DEST/yamnet.tflite.part" "$YAMNET_URL"
  mv "$DEST/yamnet.tflite.part" "$DEST/yamnet.tflite"
fi
python3 - "$DEST/yamnet.tflite" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); labels = [n for n in z.namelist() if n.endswith('.txt')]
print("   labels file:", labels[0], "-", len(z.read(labels[0]).splitlines()), "classes")
PY

echo "==> faster-whisper '$STT_MODEL' weights"
PY=${PYTHON:-python3}
"$PY" - "$DEST/whisper" "$STT_MODEL" <<'PY'
import sys
try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.exit("faster-whisper not installed (pip install 'echosentinel[stt]'); skipping")
WhisperModel(sys.argv[2], device="cpu", compute_type="int8", download_root=sys.argv[1])
print("   cached in", sys.argv[1])
PY
echo "Done. Restart EchoSentinel to load the models."
