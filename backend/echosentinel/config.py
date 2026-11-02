"""Runtime configuration (environment / .env driven). Secrets never get defaults."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ES_", env_file=".env", extra="ignore")

    # Network — loopback by default; put a TLS reverse proxy in front for remote access.
    host: str = "127.0.0.1"
    port: int = 8640
    trusted_proxies: list[str] = Field(default_factory=lambda: ["127.0.0.1", "::1"])
    secure_cookies: bool = False  # set true when served over HTTPS
    session_hours: int = 12

    # Paths
    data_dir: Path = Path("./data")
    recordings_dir: Path | None = None  # default: <data_dir>/recordings
    frontend_dist: Path | None = None  # default: ../frontend/dist relative to package

    # Secret used to encrypt RTSP credentials / bot tokens at rest (Fernet key or any long string).
    secret_key: str | None = None

    # Channels
    channel_slots: int = 4
    rtsp_allowed_networks: list[str] = Field(
        default_factory=lambda: [
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "100.64.0.0/10",
            "127.0.0.0/8",
            "fc00::/7",
            "::1/128",
        ]
    )
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    connect_timeout_s: float = 10.0
    reconnect_base_s: float = 2.0
    reconnect_max_s: float = 120.0

    # Recording
    record_sample_rate: int = 22050
    record_bitrate: str = "48k"

    # Speech-to-text
    stt_enabled: bool = True
    stt_model: str = "base"
    stt_device: str = "auto"  # auto|cpu|cuda
    stt_compute_type: str = "auto"
    stt_model_dir: Path | None = None

    # Acoustic classifier (YAMNet TFLite with embedded labels)
    classifier_enabled: bool = True
    classifier_model_path: Path | None = None  # default: <data_dir>/models/yamnet.tflite

    # Webhook SSRF allowlist (hostnames or CIDRs explicitly permitted even if private)
    webhook_allow: list[str] = Field(default_factory=list)

    # Demo mode — synthetic data, isolated database, loud UI banner
    demo_mode: bool = False

    log_level: str = "INFO"

    @property
    def rec_dir(self) -> Path:
        return (self.recordings_dir or self.data_dir / "recordings").resolve()

    @property
    def db_path(self) -> Path:
        return (self.data_dir / ("demo.db" if self.demo_mode else "echosentinel.db")).resolve()

    @property
    def model_dir(self) -> Path:
        return (self.data_dir / "models").resolve()

    @property
    def yamnet_path(self) -> Path:
        return (self.classifier_model_path or self.model_dir / "yamnet.tflite").resolve()

    @property
    def dist_dir(self) -> Path:
        if self.frontend_dist:
            return self.frontend_dist.resolve()
        return (Path(__file__).resolve().parent.parent.parent / "frontend" / "dist").resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
