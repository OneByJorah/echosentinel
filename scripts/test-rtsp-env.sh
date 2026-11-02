#!/usr/bin/env bash
# Spin up a real local RTSP server (mediamtx) with one authenticated audio stream for integration tests.
#   ./scripts/test-rtsp-env.sh            -> starts server + publisher in the background
#   ES_TEST_RTSP_URL=rtsp://cam:s3cretPass@127.0.0.1:8554/ch1 pytest backend/tests/test_integration_rtsp.py
set -euo pipefail
VER=${MEDIAMTX_VERSION:-v1.15.3}
DIR=${RTSP_DIR:-$(mktemp -d)}
cd "$DIR"
if [[ ! -x mediamtx ]]; then
  curl -fsSL -o m.tgz "https://github.com/bluenviron/mediamtx/releases/download/$VER/mediamtx_${VER}_linux_amd64.tar.gz"
  tar xzf m.tgz mediamtx
fi
cat > test.yml <<'YML'
logLevel: warn
rtspAddress: :8554
rtmp: no
hls: no
webrtc: no
srt: no
api: no
authInternalUsers:
- user: any
  ips: ['127.0.0.1', '::1']
  permissions: [{action: publish}]
- user: cam
  pass: s3cretPass
  permissions: [{action: read}]
paths:
  all_others:
YML
./mediamtx test.yml > mediamtx.log 2>&1 &
sleep 1
ffmpeg -hide_banner -loglevel error -re -f lavfi \
  -i "aevalsrc='0.4*sin(2*PI*300*t)*gt(sin(2*PI*0.25*t),0)+0.02*(random(0)-0.5)':s=16000" \
  -c:a aac -b:a 32k -ar 16000 -ac 1 -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/ch1 > publisher.log 2>&1 &
sleep 2
echo "RTSP test stream: rtsp://cam:s3cretPass@127.0.0.1:8554/ch1 (workdir $DIR)"
