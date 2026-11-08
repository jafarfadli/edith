# Edith

Editor PDF berbasis web: unggah PDF, edit teks aslinya (paragraf dipisah per sel tabel, butir dan baris formulir; font asli PDF dipakai ulang, termasuk subset CJK tanpa cmap; rich text per kata, Cari & Ganti), tambah teks, bentuk (termasuk poligon, garis bersambung dan awan; garis putus-putus, opasitas dan rotasi), gambar, gambar bebas, whiteout, redaksi, stabilo/garis bawah/coret (anotasi PDF asli), tanda tangan (dengan pustaka di browser), stamp (34 preset Indonesia/Inggris), centang/silang, isi form (opsional diratakan), kelola halaman (putar, duplikat, pindah, hapus, sisip halaman kosong, impor PDF lain yang teks dan form-nya juga bisa diedit), crop, salin/tempel/ratakan objek dan panel Anotasi, lalu unduh.

## Struktur

- `apps/api` — FastAPI + PyMuPDF. Menyimpan unggahan selama 1 jam dan menerapkan ("bake") operasi edit saat ekspor.
- `apps/web` — Next.js. Merender halaman dengan pdf.js, mengelola edit di browser, dan menata teks sendiri agar sama persis dengan hasil ekspor.
- `packages/ops` — JSON Schema + tipe TypeScript untuk operasi edit (dihasilkan dari `apps/api/edith/ops.py`).
- `packages/fonts` — 24 family font bersama (Arimo/Tinos/Cousine/Carlito/Caladea sebagai pengganti metrik font PDF, plus pilihan pengguna; OFL/Apache 2.0, lihat `packages/fonts/LICENSES.md`). Unduh ulang: `node packages/fonts/scripts/fetch.mjs`.
- Paket font CJK opsional (Noto Sans/Serif KR, JP, SC; regular + bold, ±113 MB) untuk karakter Korea/Jepang/Tionghoa yang tidak ada di font asli PDF. Tidak disimpan di git; unduh sekali per checkout:

      node packages/fonts/scripts/fetch-cjk.mjs   # ke packages/fonts/files/cjk (--force: unduh ulang)

  Tanpa paket ini Edith tetap jalan: karakter CJK yang tidak ada di font asli ditandai "tidak didukung". Docker build mengunduhnya otomatis (`--build-arg CJK_FONTS=0` untuk melewatinya); CI menyimpannya di cache.

## Menjalankan untuk pengembangan

Prasyarat: Node 22+, uv.

    npm install
    npm run dev:api      # http://localhost:8000
    npm run dev:web      # http://localhost:3000

## Tes

    npm run test:api
    npm test -w apps/web
    E2E_WEB_PORT=3000 E2E_API_PORT=8000 npm run e2e -w apps/web   # port bawaan; pakai port lain bila 3000/8000 sudah dipakai

Fixture yang dihasilkan dari kode API (jalankan ulang setelah mengubah ekstraksi atau fixture-nya):

    cd apps/api && uv run python -m scripts.text_fixture   # apps/web/src/lib/fixtures/text.json
    cd apps/api && uv run python -m scripts.e2e_text_pdf   # apps/web/e2e/fixtures/text.pdf
    cd apps/api && uv run python -m scripts.e2e_annots_pdf # apps/web/e2e/fixtures/annots.pdf
    cd apps/api && uv run python -m scripts.e2e_pages_pdf  # apps/web/e2e/fixtures/pages.pdf + import.pdf
    cd apps/api && uv run python -m scripts.e2e_form_pdf   # apps/web/e2e/fixtures/form-ko.pdf

Melihat pembagian paragraf sebuah PDF (kotak + id per paragraf, PNG per halaman):

    cd apps/api && uv run python -m scripts.paragraph_overlay file.pdf /tmp/overlay

Setelah mengubah `apps/api/edith/ops.py`:

    cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops

## Docker

    docker compose up --build

## Lisensi

PyMuPDF berlisensi AGPL-3.0. Menjalankan Edith sebagai layanan tertutup memerlukan lisensi komersial dari Artifex atau membuka kode backend.
