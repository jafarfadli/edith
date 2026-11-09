from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EDITH_")

    data_dir: Path = Path(".data")
    fonts_dir: Path = REPO_ROOT / "packages" / "fonts"
    ttl_seconds: int = 3600
    tombstone_seconds: int = 86400
    cleanup_interval_seconds: int = 300
    max_upload_bytes: int = 50 * 1024 * 1024
    max_pages: int = 500
    max_asset_bytes: int = 10 * 1024 * 1024
    max_asset_pixels: int = 50_000_000
    cors_origins: list[str] = ["http://localhost:3000"]
    # OCR (POST /documents/{id}/pages/{n}/ocr): the tesseract command (none: found on PATH), how many pages the server
    # reads at once (one more request gets 429 ocr_busy, as does a second one for a document being read) and how long
    # one page may take.
    tesseract_cmd: str | None = None
    ocr_slots: int = 2
    ocr_timeout_seconds: float = 30.0
