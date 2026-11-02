# Known limitations

Stated plainly so nobody mistakes what EchoSentinel does and doesn't do.

## Not verified in the build environment

* **Real Whisper transcription and real YAMNet classification were not exercised end-to-end during development.** The build sandbox could not download model weights (Hugging Face / Google storage blocked). The code paths are implemented against the published APIs (faster-whisper 1.2, ai-edge-litert 2.3) and the surrounding pipeline (segmentation, queues, thresholds, cooldowns, persistence, publishing) is covered by tests with stand-in engines. Run `scripts/fetch-models.sh` on your host and check **System**: both should report `ready`. If they don't, the UI says so — it never substitutes fake output.
* **Ollama** was not reachable in the build environment; summary generation is tested with a mocked Ollama HTTP API (including the prompt-injection guards).
* **No physical cameras.** RTSP handling was validated against a real RTSP server (mediamtx) with an authenticated AAC stream plus genuinely failing endpoints (wrong password, missing path, refused port). Camera-specific quirks (odd codecs such as G.726, ONVIF back-channels) may need testing on your hardware.

## By design

* **Audio only.** No video, thumbnails or camera footage.
* **Speaker diarization is not implemented.** Speaker labels are always empty and the UI shows diarization as *unavailable*.
* **No interim (partial) transcripts.** faster-whisper transcribes complete utterances (≤15 s); text appears ~1–3 s after a phrase ends on CPU with `base`.
* **Acoustic detection is probabilistic.** YAMNet is trained on YouTube audio (AudioSet); expect false positives (e.g. door slams vs. gunshots) and misses at distance. It is a triage aid, not forensic evidence.
* **Single node.** SQLite is appropriate for a handful of channels on one host; there is no clustering.
* **Live listening** sends uncompressed 16 kHz PCM (~256 kbit/s per listener). Fine on LAN/tailnet; heavy over mobile data.
* **Transcript ↔ recording alignment** is within about ±1 s.
* **Clip export spanning a gap** stitches the available audio; the gap is not padded with silence (the metadata header carries the requested start/end).
* **Quiet hours** use the server's local time zone.

## Browser support

Modern Chromium, Firefox and Safari (MP3 playback, Web Audio, WebSockets). Live listening requires a user click to start (autoplay policy).
