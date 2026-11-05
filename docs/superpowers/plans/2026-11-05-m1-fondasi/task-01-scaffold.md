# Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `.nvmrc`
- Create: `apps/api/pyproject.toml`, `apps/api/edith/__init__.py`, `apps/api/edith/settings.py`, `apps/api/edith/main.py`, `apps/api/tests/__init__.py`, `apps/api/tests/conftest.py`, `apps/api/tests/test_health.py`
- Create (generated): `apps/web/**` via create-next-app, then `apps/web/vitest.config.ts`, `apps/web/src/lib/strings.ts`, `apps/web/src/lib/strings.test.ts`

**Interfaces:**
- Produces: `edith.settings.Settings` (fields below), `edith.main.create_app(settings: Settings | None = None) -> FastAPI`, module-level `app`. pytest fixtures `settings` (tmp data dir) and `client` (`fastapi.testclient.TestClient`). Web: `@/lib/strings` exporting `t` object.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "edith",
  "private": true,
  "workspaces": ["apps/web", "packages/*"],
  "scripts": {
    "dev:web": "npm run dev -w apps/web",
    "dev:api": "cd apps/api && uv run uvicorn edith.main:app --reload --port 8000",
    "test:web": "npm run test -w apps/web",
    "test:api": "cd apps/api && uv run pytest -q"
  }
}
```

`.gitignore`:
```
node_modules/
.next/
out/
apps/api/.venv/
apps/api/.data/
__pycache__/
*.pyc
.pytest_cache/
apps/web/public/fonts/
test-results/
playwright-report/
.env*.local
.DS_Store
```

`.nvmrc`: `22`

- [ ] **Step 2: API project**

`apps/api/pyproject.toml`:
```toml
[project]
name = "edith-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "python-multipart>=0.0.9",
  "pymupdf>=1.26",
  "pydantic>=2.8",
  "pydantic-settings>=2.4",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.uv]
package = false

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

`apps/api/edith/__init__.py`: empty.

`apps/api/edith/settings.py`:
```python
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
    cors_origins: list[str] = ["http://localhost:3000"]
```

`apps/api/edith/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from edith.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="Edith API")
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    return app


app = create_app()
```

`apps/api/tests/__init__.py`: empty.

`apps/api/tests/conftest.py`:
```python
import pytest
from fastapi.testclient import TestClient

from edith.main import create_app
from edith.settings import Settings


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data")


@pytest.fixture
def client(settings) -> TestClient:
    with TestClient(create_app(settings)) as c:
        yield c
```

`apps/api/tests/test_health.py`:
```python
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
```

- [ ] **Step 3: Run API test**

Run: `cd apps/api && uv sync && uv run pytest -q`
Expected: `1 passed`

- [ ] **Step 4: Next.js app**

Run from repo root:
```bash
npx --yes create-next-app@16 apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --skip-install --yes
rm -f apps/web/package-lock.json
rm -rf apps/web/.git
npm install
npm install -w apps/web -D vitest@^3
```
If create-next-app rejects a flag, rerun without it and accept defaults matching: TypeScript, Tailwind, ESLint, App Router, `src/` dir, alias `@/*`.

Add to `apps/web/package.json` `scripts`: `"test": "vitest run"`.

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 5: Strings module + test**

`apps/web/src/lib/strings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { t, errorMessage } from "@/lib/strings";

describe("strings", () => {
  it("has Indonesian app name tagline", () => {
    expect(t.appName).toBe("Edith");
  });
  it("maps known error codes and falls back", () => {
    expect(errorMessage("pdf_encrypted")).toContain("terkunci");
    expect(errorMessage("nope")).toBe(t.errors.generic);
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL (module not found).

`apps/web/src/lib/strings.ts`:
```ts
export const t = {
  appName: "Edith",
  tagline: "Edit PDF langsung di browser",
  upload: {
    title: "Edit PDF dengan mudah",
    drop: "Tarik & lepas PDF di sini",
    or: "atau",
    choose: "Pilih file",
    limit: "Maksimal 50 MB atau 500 halaman",
    processing: "Memproses dokumen…",
  },
  editor: {
    download: "Unduh",
    downloading: "Menyiapkan file…",
    undo: "Urungkan",
    redo: "Ulangi",
    select: "Pilih",
    text: "Teks",
    erase: "Penghapus",
    whiteout: "Whiteout",
    redact: "Redaksi",
    draw: "Gambar Bebas",
    image: "Gambar",
    shape: "Bentuk",
    rect: "Persegi",
    ellipse: "Elips",
    line: "Garis",
    arrow: "Panah",
    page: "Halaman",
    zoomIn: "Perbesar",
    zoomOut: "Perkecil",
    pan: "Mode geser",
    rotateLeft: "Putar kiri",
    rotateRight: "Putar kanan",
    deletePage: "Hapus halaman",
    insertBlank: "Sisipkan halaman kosong",
    moveUp: "Pindah ke atas",
    moveDown: "Pindah ke bawah",
    pages: "Halaman",
    color: "Warna",
    fill: "Isi",
    noFill: "Tanpa isi",
    strokeWidth: "Tebal garis",
    font: "Font",
    fontSize: "Ukuran",
    alignLeft: "Rata kiri",
    alignCenter: "Rata tengah",
    alignRight: "Rata kanan",
    delete: "Hapus",
    fileName: "Nama file",
    preview: "Preview akurat",
    restored: "Perubahan sebelumnya dipulihkan",
  },
  errors: {
    generic: "Terjadi kesalahan. Coba lagi.",
    pdf_corrupt: "File ini bukan PDF yang valid atau rusak.",
    pdf_encrypted: "PDF ini terkunci dengan kata sandi. Fitur buka kunci belum tersedia.",
    too_large: "File terlalu besar. Maksimal 50 MB atau 500 halaman.",
    unsupported_media: "Format file tidak didukung.",
    doc_not_found: "Dokumen tidak ditemukan.",
    doc_expired: "Sesi dokumen sudah berakhir (1 jam). Unggah ulang file yang sama untuk melanjutkan.",
    asset_not_found: "Gambar tidak ditemukan. Tambahkan ulang gambarnya.",
    invalid_op: "Ada perubahan yang tidak valid.",
    bake_failed: "Gagal menyimpan salah satu objek. Hapus objek yang disorot lalu coba lagi.",
    network: "Tidak dapat terhubung ke server.",
  },
} as const;

export function errorMessage(code: string): string {
  const errors = t.errors as Record<string, string>;
  return errors[code] ?? t.errors.generic;
}
```

Run: `npm test -w apps/web` → Expected: PASS (2 tests).

- [ ] **Step 6: Smoke the web build**

Run: `npm run build -w apps/web`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with FastAPI and Next.js apps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
