"""壓力測試腳本共用的量測工具與路徑基準。

效能驗收需要的是「哪一段花了多久、吃了多少記憶體」，而非一個總數字——三攻擊
內部會再跑一次完整去識別，若把整段包成單一計時，量到的數字無從解釋。故以階段
為單位量測，並各自取行程記憶體峰值（連結性攻擊在全量資料上建索引樹時最吃記憶體）。

資料集與產出檔的位置一律由此處的 SCRATCH_DIR 推得。以本檔位置回推專案根目錄，
而非依賴當下的工作目錄或寫死某台機器的絕對路徑，換一台機器或換一個目錄執行都
會落在同一處。
"""
import platform
import sys
import threading
import time
import tomllib
from datetime import datetime
from pathlib import Path
from typing import Any

import psutil

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRATCH_DIR = PROJECT_ROOT / "scratch"


def project_version() -> str:
    """受測版本號取自 pyproject.toml，避免壓測腳本為了讀版本而載入 API 應用程式。"""
    with open(PROJECT_ROOT / "pyproject.toml", "rb") as f:
        return tomllib.load(f)["project"]["version"]


def describe_environment() -> dict[str, Any]:
    """量測環境快照：效能數據脫離機器規格就無從判讀，故與數據一同留存。"""
    mem = psutil.virtual_memory()
    return {
        "measured_at": datetime.now().isoformat(timespec="seconds"),
        "project_version": project_version(),
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "processor": platform.processor(),
        "cpu_count_physical": psutil.cpu_count(logical=False),
        "cpu_count_logical": psutil.cpu_count(logical=True),
        "total_memory_gb": round(mem.total / (1024**3), 1),
    }


class StageRecorder:
    """逐階段量測耗時與行程記憶體峰值（RSS），量完即印，長時間執行時可看進度。"""

    def __init__(self, sample_interval: float = 0.2):
        self._sample_interval = sample_interval
        self._process = psutil.Process()
        self.stages: list[dict[str, Any]] = []

    def measure(self, label: str) -> "_Stage":
        return _Stage(self, label)

    def _rss_mb(self) -> float:
        return self._process.memory_info().rss / (1024 * 1024)

    def to_dict(self) -> dict[str, Any]:
        return {
            "stages": self.stages,
            "total_seconds": round(sum(s["seconds"] for s in self.stages), 2),
            "peak_rss_mb": max((s["peak_rss_mb"] for s in self.stages), default=0.0),
        }


class _Stage:
    """單一階段的量測；以背景執行緒定期取樣，記錄該階段內的記憶體峰值。"""

    def __init__(self, recorder: StageRecorder, label: str):
        self._recorder = recorder
        self._label = label
        self._stop = threading.Event()
        self._peak = 0.0
        self._thread = None
        self._start = 0.0

    def _sample(self):
        while not self._stop.is_set():
            self._peak = max(self._peak, self._recorder._rss_mb())
            self._stop.wait(self._recorder._sample_interval)

    def __enter__(self):
        print(f"[*] {self._label} ...")
        self._peak = self._recorder._rss_mb()
        self._stop.clear()
        self._thread = threading.Thread(target=self._sample, daemon=True)
        self._thread.start()
        self._start = time.time()
        return self

    def __exit__(self, exc_type, exc, tb):
        seconds = time.time() - self._start
        self._stop.set()
        self._thread.join()
        self._peak = max(self._peak, self._recorder._rss_mb())
        self._recorder.stages.append(
            {
                "label": self._label,
                "seconds": round(seconds, 2),
                "peak_rss_mb": round(self._peak, 1),
            }
        )
        print(
            f"[OK] {self._label}：耗時 {seconds / 60:.2f} 分鐘"
            f"（{seconds:.1f} 秒），記憶體峰值 {self._peak:.1f} MB"
        )
        return False
