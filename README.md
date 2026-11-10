# Edith

Editor PDF berbasis web: unggah PDF, edit teks aslinya (paragraf dipisah per sel tabel, butir dan baris formulir; font asli PDF dipakai ulang, termasuk subset CJK tanpa cmap; rich text per kata, Cari & Ganti), tambah teks, bentuk (termasuk poligon, garis bersambung dan awan; garis putus-putus, opasitas dan rotasi), gambar, gambar bebas, whiteout, redaksi, stabilo/garis bawah/coret (anotasi PDF asli), tanda tangan (dengan pustaka di browser), stamp (34 preset Indonesia/Inggris), centang/silang, isi form (opsional diratakan), kelola halaman (putar, duplikat, pindah, hapus, sisip halaman kosong, impor PDF lain yang teks dan form-nya juga bisa diedit), crop, salin/tempel/ratakan objek dan panel Anotasi, lalu unduh.

## Urutan lapisan objek

Objek yang bertumpuk punya urutan lapisan per halaman (posisi di `doc.order`, paling bawah dulu). Klik kanan objek → **Bawa ke depan** (Ctrl Shift ] · Mac: ⌘ ⌥ ]), **Maju satu lapis** (Ctrl/⌘ ]), **Mundur satu lapis** (Ctrl/⌘ [), **Kirim ke belakang** (Ctrl Shift [ · Mac: ⌘ ⌥ [; ⌘ ⇧ [ ] dipakai browser untuk pindah tab); pintasan ini hanya aktif saat ada objek terpilih, selain itu Ctrl/⌘ [ ] tetap milik browser (kembali/maju); juga lewat tombol lapisan di bilah kecil objek, dan Shift+F10 membuka menu itu dari keyboard. Seperti di Figma/Canva, "satu lapis" melompati objek yang tidak bersinggungan dengan objek terpilih: objek naik/turun tepat melewati objek terdekat yang kotaknya beririsan dengannya; bila tidak ada, tombol itu nonaktif. Alt+klik memilih objek di bawah objek yang dipilih (berulang), dan menu klik kanan mendaftar semua objek di titik itu ("Pilih elemen di bawah"). Setiap perubahan urutan satu langkah urungkan, tersimpan di draf dan ikut diekspor (ops dikirim dalam urutan lapisan, API menggambarnya dalam urutan itu).

Batasnya mengikuti tahap bake API, dan layar menumpuk objek dengan aturan yang sama:

- Redaksi selalu paling bawah: diterapkan sebelum objek apa pun digambar.
- Objek gambar (whiteout, bentuk, gambar bebas, teks, gambar, tanda tangan, stamp, centang/silang) bisa disusun bebas di antara sesamanya. Whiteout menutupi isi asli PDF dan objek di bawahnya saja.
- Stabilo, garis bawah, coret dan catatan adalah anotasi PDF asli: di layar maupun di hasil ekspor selalu di atas semua objek gambar. Link selalu paling akhir (di PDF link tidak terlihat; di layar hanya bingkai bantu).
- Satu perbedaan layar vs ekspor yang tersisa, di antara sesama anotasi: di ekspor anotasi (stabilo, garis bawah, coret, catatan) bertumpuk menurut urutan lapisannya lalu link; di layar stabilo/garis bawah/coret digambar di lapisan tersendiri yang di-*multiply* dengan halaman, jadi selalu tampak di atas catatan dan bingkai link. Alat Catatan dan Link sudah disembunyikan sejak M5, jadi ini hanya mengenai draf lama.
- Teks asli yang diedit: baris yang diubah ikut urutan lapisan objek editnya, baris yang dipertahankan (glif asli) tetap bagian dari halaman, jadi selalu di bawah semua objek.

Urutan hanya bertukar dengan objek di halaman dan tahap yang sama; tombol yang tidak berpengaruh dinonaktifkan, dan menu menjelaskan batas ini bila relevan. "Bertumpuk" diukur dengan kotak pembatas objek (bounding box, termasuk rotasi), bukan bentuk persisnya: garis diagonal atau coretan bebas yang kotaknya beririsan dengan objek lain tanpa benar-benar menyentuhnya dihitung bertumpuk, jadi kadang perlu satu tekan tambahan sebelum perubahannya terlihat.

## OCR: teks yang berupa gambar

Halaman yang teksnya berupa gambar (hasil pindai, tangkapan layar surat) tidak punya teks yang bisa diedit. Di atas gambar itu muncul tombol **Kenali teks (OCR)** (juga di pemberitahuan saat dokumen dibuka dan saat bagian gambar diklik dua kali). OCR berjalan per halaman, atas permintaan, dengan Tesseract (bahasa Indonesia + Inggris, 300 dpi, maksimal 30 detik, satu halaman per dokumen dan dua halaman per server sekaligus). Hasilnya paragraf bergaris putus-putus berlabel "hasil OCR" (kuning: kurang yakin terbaca, keyakinan < 75 %); klik dua kali untuk mengedit. Hasil OCR hanya disimpan di tab browser (tidak di server, tidak di draf) dan tidak pernah ditulis ke PDF.

Mengedit paragraf hasil OCR membuat objek `text.ocr_edit`: area tulisan lama (tinta kata-katanya ditambah sedikit, tidak pernah melewati garis tabel/garis isian di gambar) ditutup persegi warna latar gambar di situ, di bawah semua objek lain, lalu teks baru digambar. Gambar aslinya tidak diubah (seperti Whiteout, piksel lama masih ada di dalam gambar di bawah tutupan; untuk menghapusnya pakai Redaksi). Objek itu memuat tutupan dan teksnya sendiri, jadi draf yang dipulihkan tetap bisa diunduh tanpa OCR ulang. Cari & Ganti hanya mencari teks OCR yang sudah diedit.

Batasnya: halaman yang diputar di dalam PDF-nya, hasil pindai yang miring lebih dari 1,5°, dan gambar yang terlalu buram dilaporkan, bukan dibaca. Font hasil OCR ditebak (Arimo untuk sans, Tinos untuk serif, tebal dari ketebalan garis huruf), ukuran dari tinggi huruf, warna dari tinta. Kualitas pada formulir sintetis (`scripts/ocr_accuracy.py`): 93–95 % kata tepat, tepi kotak kata meleset 0,3–0,7 pt, ukuran huruf tepat.

**Kurang yakin.** Tesseract ragu pada kata yang tepat bila di sebelahnya ada titik-titik isian, kotak centang atau "(…)" (pada formulir pindaian: "Aktif" 7 %, "Ijin" 37 %; "Opsi:" terbaca "OPSI", "Lain-lain:" terbaca "RAFT A"). Karena itu bagian baris yang punya kata di bawah 85 % dibaca sekali lagi tanpa apa pun di sekitarnya (titik-titik, kotak dan garis dihapus dari potongannya; satu kali jalan Tesseract untuk semua potongan, +0,2–0,5 detik per halaman) dan bacaan yang lebih yakin dipakai. Keyakinan paragraf = keyakinan katanya yang paling ragu, jadi label kuning "kurang yakin" (< 75 %) berarti ada kata yang perlu dicek: setelah dibaca ulang, kata di bawah 75 % selalu salah dan paragraf yang terbaca benar tidak pernah kuning pada semua formulir uji. Yang tetap lolos tanpa tanda: tanda baca yang tidak terbaca sama sekali (garis miring di "Tlp / HP", titik dua yang berdiri sendiri).

Catatan perilaku (review M5d):

- **Tutupan per baris.** Setiap baris paragraf OCR punya persegi tutupannya sendiri (`covers`), dari tinta kata-kata baris itu: di samping baris terakhir yang pendek tidak ada yang ditutup, jadi teks lain, kotak centang atau stempel di pojok itu tetap terlihat. Tutupan berhenti sebelum tinta paragraf lain dan kotak centang; baris yang di dalam tintanya ada kata paragraf lain tidak ditutup sama sekali.
- **Tutupan buram, bukan penghapus.** Persegi tutupan menutupi gambar lama; piksel aslinya tetap ada di dalam gambar PDF (bisa diekstrak). Untuk benar-benar menghapus, pakai Redaksi. Teks tak terlihat di bawah tutupan (lapisan OCR lama hasil pemindai) dihapus saat ekspor, jadi kata lama tidak ikut tersalin atau ditemukan.
- **Batas server.** Halaman dengan lebih dari 64 gambar atau lebih dari 4000 kata ditolak (`ocr_too_complex`). Batas waktu (bawaan 30 detik) berlaku untuk seluruh halaman, termasuk mencari gambarnya. Menutup tab tidak membatalkan OCR yang sedang berjalan: slotnya baru lepas saat OCR selesai atau batas waktu habis.
- **Hasil bisa sedikit berbeda antar-jalan.** Kata yang dibaca ulang (di dalam atau sesudah titik-titik isian, dan bacaan kedua kata yang ragu) hanya dibaca bila waktu masih cukup, jadi pada server yang sibuk hasilnya bisa kurang satu dua kata, lebih banyak yang kuning, dan nomor `ocrN` bisa bergeser.

## Struktur

- `apps/api` — FastAPI + PyMuPDF. Menyimpan unggahan selama 1 jam dan menerapkan ("bake") operasi edit saat ekspor.
- `apps/web` — Next.js. Merender halaman dengan pdf.js, mengelola edit di browser, dan menata teks sendiri agar sama persis dengan hasil ekspor.
- `packages/ops` — JSON Schema + tipe TypeScript untuk operasi edit (dihasilkan dari `apps/api/edith/ops.py`).
- `packages/fonts` — 24 family font bersama (Arimo/Tinos/Cousine/Carlito/Caladea sebagai pengganti metrik font PDF, plus pilihan pengguna; OFL/Apache 2.0, lihat `packages/fonts/LICENSES.md`). Unduh ulang: `node packages/fonts/scripts/fetch.mjs`.
- Paket font CJK opsional (Noto Sans/Serif KR, JP, SC; regular + bold, ±113 MB) untuk karakter Korea/Jepang/Tionghoa yang tidak ada di font asli PDF. Tidak disimpan di git; unduh sekali per checkout:

      node packages/fonts/scripts/fetch-cjk.mjs   # ke packages/fonts/files/cjk (--force: unduh ulang)

  Tanpa paket ini Edith tetap jalan: karakter CJK yang tidak ada di font asli ditandai "tidak didukung". Docker build mengunduhnya otomatis (`--build-arg CJK_FONTS=0` untuk melewatinya); CI menyimpannya di cache.

## Menjalankan untuk pengembangan

Prasyarat: Node 22+, uv. Untuk OCR: Tesseract dengan data bahasa `ind` dan `eng` (macOS: `brew install tesseract tesseract-lang`; Debian/Ubuntu: `apt-get install tesseract-ocr tesseract-ocr-ind tesseract-ocr-eng`). Tanpa Tesseract Edith tetap jalan; tombol OCR menjawab "OCR belum terpasang di server ini" dan tes OCR dilewati (di CI `EDITH_REQUIRE_TESSERACT=1` membuatnya gagal).

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
    cd apps/api && uv run python -m scripts.e2e_scan_pdf   # apps/web/e2e/fixtures/scan.pdf (formulir pindaian sintetis)

Melihat pembagian paragraf sebuah PDF (kotak + id per paragraf, PNG per halaman):

    cd apps/api && uv run python -m scripts.paragraph_overlay file.pdf /tmp/overlay

Kualitas OCR (tabel varian formulir pindaian sintetis, termasuk formulir huruf kecil dengan titik-titik dan kotak centang, dengan paragraf kuning yang benar dan paragraf salah yang tidak kuning; atau overlay hasil OCR sebuah PDF, dibandingkan dengan kata-kata yang dicek tangan bila ada `--truth`, JSON `[[teks, x, y], …]` titik tengah tiap kata dalam pt):

    cd apps/api && uv run python -m scripts.ocr_accuracy [/tmp/ocr]
    cd apps/api && uv run python -m scripts.ocr_accuracy --pdf file.pdf /tmp/ocr [--truth kata.json]

Setelah mengubah `apps/api/edith/ops.py`:

    cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops

## Docker

    docker compose up --build

## Deploy

API dan web dirilis terpisah; rilis API lebih dulu, baru web. Web sejak M5 mengirim `paragraphs_version` saat ekspor dan pratinjau, dan API lama menolak field yang tidak dikenalnya (422), jadi web baru di atas API lama membuat unduhan gagal. Sebaliknya aman: API baru menerima permintaan web lama (tanpa field itu dianggap versi 1); hanya edit teks yang id paragrafnya dari versi lama ditolak (409 `text_outdated`) dan perlu muat ulang dokumen.

M5b menegaskan urutan itu: web M5b mengirim `Run.hScale`/`charSpacing`/`wordSpacing` dan `LayoutLine.source`, yang ditolak API M5 dengan 422, dan `PARAGRAPHS_VERSION` naik dari 2 ke 3, sehingga ekspor dengan id paragraf versi 2 mendapat 409. Draf dari M5 kehilangan edit teksnya (paragraf asli yang diedit) setelah rilis ini; itu disengaja, dan pengguna melihat pemberitahuannya.

Sejak M5c web wajib dibangun ulang dengan `npm run build -w apps/web`: `prebuild` membuat `apps/web/public/pdfjs/` (dekoder wasm, cmaps, font standar, ICC pdf.js; 4,2 MB), tanpanya gambar hasil pindai 1-bit (JBIG2/CCITT, mis. kop surat) tidak tampil di editor; restart pm2 saja tidak cukup.

Sejak M5d (OCR) server API memerlukan Tesseract (`ind` + `eng`) agar OCR jalan; image Docker API sudah memasangnya. Web baru di atas API lama: tombol OCR mendapat 404 dan menampilkan galat, sisanya jalan. Pengaturan: `EDITH_TESSERACT_CMD` (bawaan: `tesseract` di PATH), `EDITH_OCR_SLOTS` (2), `EDITH_OCR_TIMEOUT_SECONDS` (30).

## Lisensi

PyMuPDF berlisensi AGPL-3.0. Menjalankan Edith sebagai layanan tertutup memerlukan lisensi komersial dari Artifex atau membuka kode backend.
