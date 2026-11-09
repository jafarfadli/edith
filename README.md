# Edith

Editor PDF berbasis web: unggah PDF, edit teks aslinya (paragraf dipisah per sel tabel, butir dan baris formulir; font asli PDF dipakai ulang, termasuk subset CJK tanpa cmap; rich text per kata, Cari & Ganti), tambah teks, bentuk (termasuk poligon, garis bersambung dan awan; garis putus-putus, opasitas dan rotasi), gambar, gambar bebas, whiteout, redaksi, stabilo/garis bawah/coret (anotasi PDF asli), tanda tangan (dengan pustaka di browser), stamp (34 preset Indonesia/Inggris), centang/silang, isi form (opsional diratakan), kelola halaman (putar, duplikat, pindah, hapus, sisip halaman kosong, impor PDF lain yang teks dan form-nya juga bisa diedit), crop, salin/tempel/ratakan objek dan panel Anotasi, lalu unduh.

## Urutan lapisan objek

Objek yang bertumpuk punya urutan lapisan per halaman (posisi di `doc.order`, paling bawah dulu). Klik kanan objek → **Bawa ke depan** (Ctrl/⌘ Shift ]), **Maju satu lapis** (Ctrl/⌘ ]), **Mundur satu lapis** (Ctrl/⌘ [), **Kirim ke belakang** (Ctrl/⌘ Shift [); juga lewat tombol lapisan di bilah kecil objek, dan Shift+F10 membuka menu itu dari keyboard. Alt+klik memilih objek di bawah objek yang dipilih (berulang), dan menu klik kanan mendaftar semua objek di titik itu ("Pilih elemen di bawah"). Setiap perubahan urutan satu langkah urungkan, tersimpan di draf dan ikut diekspor (ops dikirim dalam urutan lapisan, API menggambarnya dalam urutan itu).

Batasnya mengikuti tahap bake API, dan layar menumpuk objek dengan aturan yang sama:

- Redaksi selalu paling bawah: diterapkan sebelum objek apa pun digambar.
- Objek gambar (whiteout, bentuk, gambar bebas, teks, gambar, tanda tangan, stamp, centang/silang) bisa disusun bebas di antara sesamanya. Whiteout menutupi isi asli PDF dan objek di bawahnya saja.
- Stabilo, garis bawah, coret dan catatan adalah anotasi PDF asli: selalu di atas semua objek gambar (urutan hanya berlaku di antara sesama anotasi). Link paling atas.
- Teks asli yang diedit: baris yang diubah ikut urutan lapisan objek editnya, baris yang dipertahankan (glif asli) tetap bagian dari halaman, jadi selalu di bawah semua objek.

Urutan hanya bertukar dengan objek di halaman dan tahap yang sama; tombol yang tidak berpengaruh dinonaktifkan, dan menu menjelaskan batas ini bila relevan.

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
    npm run e2e -w apps/web                                        # menyalakan API :8000 dan web :3000 baru; gagal bila port sudah dipakai
    E2E_WEB_PORT=3100 E2E_API_PORT=8100 npm run e2e -w apps/web    # port lain bila 3000/8000 sudah dipakai
    E2E_REUSE=1 npm run e2e -w apps/web                            # pakai server yang sudah jalan di port itu (dev server sendiri)

`E2E_API_PORT` dan `E2E_WEB_PORT` memilih port server tes (bawaan 8000 dan 3000). Tanpa `E2E_REUSE=1` Playwright selalu menyalakan server sendiri, jadi tidak diam-diam menguji server lain yang kebetulan menjawab di port itu.

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

## Deploy

API dan web dirilis terpisah; rilis API lebih dulu, baru web. Web sejak M5 mengirim `paragraphs_version` saat ekspor dan pratinjau, dan API lama menolak field yang tidak dikenalnya (422), jadi web baru di atas API lama membuat unduhan gagal. Sebaliknya aman: API baru menerima permintaan web lama (tanpa field itu dianggap versi 1); hanya edit teks yang id paragrafnya dari versi lama ditolak (409 `text_outdated`) dan perlu muat ulang dokumen.

M5b menegaskan urutan itu: web M5b mengirim `Run.hScale`/`charSpacing`/`wordSpacing` dan `LayoutLine.source`, yang ditolak API M5 dengan 422, dan `PARAGRAPHS_VERSION` naik dari 2 ke 3, sehingga ekspor dengan id paragraf versi 2 mendapat 409. Draf dari M5 kehilangan edit teksnya (paragraf asli yang diedit) setelah rilis ini; itu disengaja, dan pengguna melihat pemberitahuannya.

## Lisensi

PyMuPDF berlisensi AGPL-3.0. Menjalankan Edith sebagai layanan tertutup memerlukan lisensi komersial dari Artifex atau membuka kode backend.
