"""Host metrics (real values only; GPU reported only when nvidia-smi is present)."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import psutil

from .db import iso, utcnow


def gpu_info() -> dict | None:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = (
            subprocess.run(
                [exe, "--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            .stdout.strip()
            .splitlines()
        )
        if not out:
            return None
        name, util, used, total = [x.strip() for x in out[0].split(",")]
        return {"name": name, "util_pct": float(util), "mem_used_bytes": int(float(used) * 1024**2), "mem_total_bytes": int(float(total) * 1024**2)}
    except Exception:
        return None


def collect(disk_path: Path) -> dict:
    vm = psutil.virtual_memory()
    du = shutil.disk_usage(disk_path)
    return {
        "cpu_pct": psutil.cpu_percent(interval=None),
        "ram_used_bytes": vm.total - vm.available,
        "ram_total_bytes": vm.total,
        "disk_used_bytes": du.total - du.free,
        "disk_total_bytes": du.total,
        "disk_path": str(disk_path),
        "gpu": gpu_info(),
        "load_avg": list(os.getloadavg()) if hasattr(os, "getloadavg") else None,
        "at": iso(utcnow()),
    }
