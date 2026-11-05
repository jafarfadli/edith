# Edith — Desain Editor PDF (Sub-proyek 1)

Tanggal: 2026-11-05
Status: Disetujui; revisi 2 setelah riset UX pdfguru.com (menunggu review spec tertulis)

## Konteks

Edith adalah aplikasi PDF all-in-one yang meniru cakupan fitur pdfguru.com (editor, tools organisasi, konversi, keamanan, platform akun). Hanya fungsionalitas dan pola UX yang ditiru; nama, logo, teks, dan aset pdfguru tidak dipakai.

Proyek dipecah menjadi sub-proyek yang dibangun berurutan:

1. **Editor PDF** (dokumen ini)
2. Tools organisasi (merge, split, compress, dll.)
3. Konversi (PDF ke/dari Word, Excel, PPT, gambar)
4. Keamanan (protect/unlock, watermark)
5. Platform (landing, akun, dashboard, pembayaran, share link)

### Temuan riset pdfguru yang membentuk revisi ini

- Edit teks asli dilakukan **per paragraf**: satu klik memilih satu paragraf, double-click untuk mengetik. Teks reflow di dalam kotak selebar tetap, dan format bisa diatur per rentang (bold/italic/warna per kata).
- Saat ditampilkan, font asli diganti dengan font yang **ukurannya identik** (Times→Tinos, Helvetica→Arimo). Saat disimpan, font asli PDF dipakai ulang bila memungkinkan.
- Whiteout pdfguru hanya menutupi: teks di bawahnya masih bisa dicari. Edith menyediakan mode Redact sungguhan.
- Highlight pdfguru hanyalah tinta bebas, dan tidak ada flatten form. Edith membuat anotasi markup native yang menempel ke teks, serta menyediakan flatten.

## Tujuan

Editor PDF berbasis web dengan kualitas setara atau lebih baik dari pdfguru. Pengguna mengunggah PDF, mengeditnya, lalu mengunduh hasilnya, tanpa perlu akun.

### Fitur v1

- **Edit teks asli**: blok paragraf dengan reflow, rich text per rentang (font, ukuran, warna, latar, bold, italic, underline, strikethrough), perataan teks, geser dan ubah lebar blok.
- **Find & Replace**: jumlah kecocokan, case-sensitive, sebelumnya/berikutnya, Replace, dan Replace All.
- **Tambah konten**: text box (rich text yang sama), gambar, bentuk (rect, ellipse, line, arrow, polygon, polyline, cloud), freehand, whiteout, **redact**.
- **Stamp**: 17 preset (Approved, Not Approved, Draft, Final, Completed, Confidential, For Public Release, Not For Public Release, For Comment, Void, Preliminary Results, Information Only, Witness, Initial Here, Sign Here, Accepted, Rejected) dan stamp custom (teks, tanggal/jam opsional, 5 warna).
- **Simbol** centang (✓) dan silang (✗).
- **Link** ke URL atau ke halaman lain di dokumen.
- **Anotasi**: highlight, underline, strikethrough (menempel ke teks, native PDF) dan sticky note.
- **Tanda tangan**: digambar, diketik (4 font script, 3 warna), atau diunggah. Ada pustaka tanda tangan tersimpan per browser.
- **Form**: isi field AcroForm (teks, checkbox, radio, dropdown), dengan opsi flatten saat ekspor.
- **Halaman**: sidebar thumbnail (menu per halaman, tombol "+" sisip di antara halaman, drag untuk mengurutkan) dan modal **Kelola Halaman** (multi-select; putar, hapus, duplikat, pindah, sisip halaman kosong, impor PDF lain; Simpan/Batal). Juga **crop** halaman ini atau semua halaman.
- **UX objek**: mini-bar melayang (duplikat, hapus, ⋯), menu ⋯ (salin, tempel, duplikat, ratakan ke halaman), panel properti kontekstual (opacity di semua objek, gaya garis putus-putus, warna isi/garis), handle resize dan rotasi, geser dengan tombol panah.
- **Panel samping** dengan tab Halaman dan Anotasi (daftar semua objek tambahan per halaman, klik untuk ke objek, tombol hapus).
- **Penampil**: zoom, mode geser (pan), navigasi halaman, scroll kontinu.

### Di luar cakupan v1

Akun/login, penyimpanan permanen, share link, OCR, unlock PDF terenkripsi, ekspor ke format selain PDF, bookmark, tampilan dua halaman, print, komentar pada objek, membuat field form baru, font CJK/Thai/Devanagari, kolaborasi, aplikasi mobile.

### Milestone

Setiap milestone bisa dirilis sendiri dan memiliki rencana implementasi tersendiri.

| | Isi |
|---|---|
| **M1 — Fondasi** | Monorepo, unggah, penampil, struktur, store ops dan undo/redo, pipeline ekspor, `pages.layout` dasar (urutkan ulang, putar, hapus, halaman kosong), text box sederhana (satu gaya), bentuk dasar (rect, ellipse, line, arrow), freehand, gambar, whiteout, redact |
| **M2 — Edit teks** | Registry font, layout engine, ekstraksi paragraf, edit teks asli dengan rich text, pemakaian ulang font asli, rich text untuk text box, Find & Replace |
| **M3 — Anotasi & form** | Markup teks, sticky note, tanda tangan dan pustakanya, stamp, simbol, link, isi form dan flatten |
| **M4 — Halaman & polish** | Modal Kelola Halaman, duplikat, impor PDF, crop, mini-bar dan menu ⋯, ratakan, rotasi objek, polygon/polyline/cloud, garis putus-putus, panel Anotasi |

## Keputusan Utama

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Lokasi proses | Browser + backend | Penghapusan teks asli dan penulisan PDF memakai PyMuPDF di server |
| Stack | Next.js 15 + FastAPI + PyMuPDF | PyMuPDF paling kuat untuk redaksi dan penulisan teks, dan siap untuk OCR/konversi nanti |
| Model edit | Ops JSON di client, di-bake di server saat ekspor | Interaksi cepat, undo instan, backend stateless dan mudah dites |
| Otoritas tata letak teks | **Client** | Client menghitung pemenggalan baris dan posisi glyph; server hanya menggambar di posisi itu dengan file font yang sama. Hasilnya WYSIWYG: yang terlihat di layar adalah yang tersimpan. |
| Font | File font dibagi bersama oleh web dan api | Pengukuran di browser identik dengan hasil bake |
| Akun/file | Tanpa akun; file sementara dengan TTL 1 jam | Cakupan v1 tetap kecil |

**Lisensi:** PyMuPDF berlisensi AGPL-3.0. Jika Edith dijalankan sebagai SaaS tertutup, kode backend wajib dibuka atau dibelikan lisensi komersial dari Artifex. Keputusan ini harus diambil sebelum rilis publik. Semua font yang dibundel berlisensi OFL atau Apache 2.0.

## Arsitektur

### Struktur repo

```
edith/
  apps/web/          Next.js 15 (App Router, TypeScript, Tailwind, shadcn/ui)
  apps/api/          FastAPI + PyMuPDF (Python 3.12, dikelola uv)
  packages/ops/      JSON Schema ops edit — satu-satunya sumber kebenaran
                     → generate tipe TS (web) dan model Pydantic (api)
  packages/fonts/    File font (TTF) + manifest.json; dibaca oleh web dan api
  docker-compose.yml web + api
```

### Alur data

1. `POST /documents` (multipart PDF) → `{doc_id, sha256, page_count}`. File disimpan di `$EDITH_DATA/{doc_id}/source.pdf`. `doc_id` adalah token acak 128-bit. TTL 1 jam sejak akses terakhir. Endpoint yang sama dipakai untuk mengimpor PDF tambahan ke dokumen yang sedang diedit.
2. `GET /documents/{id}/structure` → struktur dokumen:
   - `pages[]`: `index`, `width`, `height`, `rotation`, `hasText`
   - `paragraphs[]`: lihat bagian **Ekstraksi Paragraf**
   - `fonts[]`: `ref`, `name`, `embedded`, `format` (ttf/otf/cff/type1/type3), `reusable` (boolean), `substitute` (family registry)
   - `fields[]`: `name`, `type`, `value`, `options?`, `page`, `bbox`
3. `GET /documents/{id}/file` → PDF asli. Browser me-render-nya dengan pdf.js.
4. `GET /documents/{id}/fonts/{ref}` → byte font asli (hanya untuk font yang `reusable`).
5. Pengguna mengedit. Store client menyimpan `ops[]` beserta riwayat undo/redo, dan menyimpan otomatis ke localStorage dengan kunci `sha256`.
6. `POST /assets` (PNG/JPEG, maks 10 MB) → `{asset_id}`. Dipakai untuk gambar dan tanda tangan.
7. `POST /documents/{id}/render-page` `{pageKey, ops}` → PNG halaman setelah bake. Dipakai untuk tombol "Preview akurat".
8. `POST /documents/{id}/export` `{ops, flatten_forms, filename}` → stream PDF hasil.
9. Job cleanup (APScheduler di dalam proses API, tiap 5 menit) menghapus folder yang sudah kedaluwarsa.

### Batasan

- Unggahan maksimal 50 MB atau 500 halaman per file.
- PDF terenkripsi ditolak dengan kode `pdf_encrypted`.
- Request ekspor maksimal 5.000 ops.

### Identitas halaman dan sistem koordinat

- Setiap halaman final memiliki **`pageKey`** yang stabil:
  - `o{n}` untuk halaman ke-n dokumen utama
  - `u{uuid}` untuk halaman yang dibuat di client (duplikat, halaman kosong, halaman impor)
- Semua op konten menunjuk halaman lewat `pageKey`. Saat sebuah halaman diduplikat, client menyalin semua op milik halaman itu dengan `pageKey` baru.
- Koordinat memakai **satuan poin PDF dengan asal di kiri-atas CropBox asli halaman sumber, sebelum diputar** (konvensi PyMuPDF). Rotasi dan crop dari `pages.layout` diterapkan paling akhir saat bake, sehingga tidak mengubah koordinat op.
- Frontend mengonversi koordinat ke piksel layar lewat satu modul, `coords.ts`, yang dites terpisah.

## Font

`packages/fonts/manifest.json` berisi daftar family, file per gaya (regular/bold/italic/bolditalic), kategori, dan alias nama font PDF.

- **Pengganti dengan ukuran identik:** Tinos (Times), Arimo (Helvetica/Arial), Cousine (Courier), Carlito (Calibri), Caladea (Cambria).
- **Pilihan pengguna (±20 family):** Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Source Sans 3, Noto Sans, Merriweather, Lora, Playfair Display, Source Serif 4, Noto Serif, PT Serif, JetBrains Mono, ditambah font script Dancing Script, Caveat, Great Vibes, dan Sacramento (dipakai juga untuk tanda tangan ketik).
- **Fallback Unicode:** Noto Sans/Serif (Latin, Yunani, Sirilik).

Web memuat font secara lazy lewat `FontFace` dan fontkit (untuk metrik). Api memuat file yang sama dengan `fitz.Font(fontfile=...)`.

**Pemetaan font asli → pengganti** (`fonts.py`, dengan logika yang sama di `manifest.aliases`):

1. Cocokkan nama dasar (tanpa prefiks subset `ABCDEF+`) dengan alias.
2. Jika tidak cocok, gunakan flags: serif → Tinos, mono → Cousine, selain itu → Arimo. Bold/italic diambil dari flags dan nama.

**Pemakaian ulang font asli.** Sebuah font dianggap `reusable` jika ter-embed, berformat TTF atau OTF (bukan CFF mentah, Type1, atau Type3), bisa dibaca fontkit, dan memiliki cmap Unicode.

Saat pengguna mengedit sebuah run berfont asli yang reusable:

- Client mengecek apakah semua karakter baru tersedia di font itu (`font.hasGlyphForCodePoint`). Jika ya, run tetap memakai font asli (`{kind:"original", ref}`).
- Jika ada glyph yang tidak tersedia, atau pengguna mengubah bold/italic yang tidak ada variannya, run itu otomatis beralih ke pengganti (`{kind:"bundled", family, bold, italic}`).

Keputusan ini diambil di client dan tercatat eksplisit di op, sehingga server tidak menebak.

## Teks: Model, Ekstraksi, Layout

### Model rich text (dipakai bersama `text.edit` dan `text.add`)

```
TextBox {
  rect: Rect               // x, y, lebar (tetap); tinggi diturunkan dari layout
  align: left|center|right|justify
  lineHeight: number       // dalam pt
  paragraphs: Run[][]      // paragraf logis dalam kotak, dipisah Enter
  layout: LayoutLine[]     // hasil layout client — yang digambar server
}
Run { text, font: FontRef, size, color, bgColor?, underline, strike }
FontRef = {kind:"original", ref} | {kind:"bundled", family, bold, italic}
LayoutLine { baseline: number, segments: {x, text, runIndex, width}[] }
```

`layout` wajib dikirim ke server. `paragraphs` disimpan untuk keperluan edit ulang dan validasi.

### Ekstraksi paragraf (`extract.py`)

- Sumber datanya `page.get_text("dict", flags=TEXT_PRESERVE_WHITESPACE)`. Baris di dalam satu block dipecah menjadi paragraf baru jika:
  - jarak vertikal > 1,5× jarak baris rata-rata,
  - ukuran font dominan berubah > 20%, atau
  - ada indentasi baris pertama setelah baris yang lebar.
- Untuk setiap paragraf:
  - `id` (`g{n}`, unik per halaman sumber)
  - `bbox`, `lines[]` (bbox per baris, untuk redaksi)
  - `runs[]` (span bertetangga dengan gaya sama digabung), `align` (deteksi dari tepi kiri/kanan baris), `lineHeight`
  - `fontRefs`
- Teks yang diputar (arah baris ≠ horizontal) ditandai `editable: false` di v1. UI menampilkannya tetapi tidak mengizinkan edit.

### Layout engine (`apps/web/lib/layout/`)

- Fungsi murni `layout(box, fonts) -> LayoutLine[]`, dengan metrik dari fontkit (advance width + kerning).
- Algoritma: word-wrap greedy pada spasi dan tanda hubung, mematuhi baris baru eksplisit, rata kiri/tengah/kanan/justify (baris terakhir paragraf tidak di-justify). Kata yang lebih lebar dari kotak dipecah per karakter.
- Tampilan non-edit di layar dirender dari hasil layout (SVG `<text>` berposisi absolut), sehingga apa yang dilihat sama dengan yang dikirim.
- Saat mengetik, editor memakai Tiptap (contenteditable) dengan lebar, font, dan line-height yang sama. Begitu fokus lepas, layout dihitung ulang dan SVG menggantikan contenteditable.

### Interaksi edit teks asli

1. Mode Select: hover pada paragraf yang bisa diedit menampilkan outline. Klik memilih blok (handle lebar kiri/kanan, bisa digeser).
2. Double-click masuk mode ketik. Area paragraf asli ditutup putih di layar dan diganti editor dengan runs hasil ekstraksi.
3. Panel properti menampilkan font, ukuran, warna, warna latar, B/I/U/S, dan perataan. Semuanya berlaku per seleksi.
4. Satu sesi edit (dari masuk sampai keluar) = satu langkah undo.

### Find & Replace

- Ctrl/Cmd+F membuka bar melayang dengan input, hitungan "n dari N", toggle Aa (case-sensitive), tombol sebelumnya/berikutnya, chevron untuk membuka field Replace, serta tombol Replace dan Replace All.
- Pencarian berjalan di client atas teks paragraf (asli maupun yang sudah diedit) dan text box tambahan. Kecocokan disorot di layar.
- Replace mengubah run yang cocok dengan mempertahankan gaya karakter pertama yang cocok, lalu menghitung ulang layout paragraf dan menghasilkan/memperbarui op `text.edit` atau `text.add`.
- Replace All = satu langkah undo.

## Skema Ops

Setiap op memiliki `id` (UUID) dan `type`. Op konten juga memiliki `pageKey`. Objek yang digambar memiliki `opacity` (0–1, default 1) dan `rotation` (derajat, berputar di pusat rect, default 0).

| type | field |
|---|---|
| `text.edit` | `paragraphId`, `TextBox` |
| `text.add` | `TextBox` |
| `image.add` | `rect`, `assetId` |
| `signature.add` | `rect`, `assetId` |
| `shape.add` | `kind` (rect/ellipse/line/arrow/polygon/polyline/cloud), `rect` atau `points`, `stroke`, `fill?`, `width`, `dash` (solid/dashed/dotted) |
| `ink.add` | `paths` (array of array titik), `color`, `width` |
| `whiteout.add` | `rect` |
| `redact.add` | `rect`, `fill` (black/white) |
| `stamp.add` | `rect`, `preset` atau `custom {text, date?, time?}`, `color` |
| `symbol.add` | `kind` (check/cross), `rect`, `color` |
| `link.add` | `rect`, `target` (`{url}` atau `{pageKey}`) |
| `annot.add` | `kind` (highlight/underline/strike/note), `quads` atau `point`, `color`, `content?` |
| `form.set` | `fieldName`, `value` |
| `pages.layout` | `pages[]`: `{pageKey, src, rotate, crop?}`, dengan `src` = `{doc, index}` atau `{blank: {width, height}}` |

Di dalam client ada juga `object.update` (`targetId`, `patch`), `object.delete` (`targetId`), serta ops halaman granular (rotate, delete, duplicate, insert, move, crop) untuk riwayat undo. Sebelum dikirim ke backend, client **memadatkan** ops:

- update digabung ke op asalnya, dan objek yang dihapus dibuang;
- semua ops halaman digabung menjadi satu `pages.layout`;
- ops milik halaman yang sudah dihapus dibuang.

Backend hanya menerima ops yang sudah padat, dengan paling banyak satu `pages.layout`. Tanpa `pages.layout`, dokumen dianggap memakai urutan dan rotasi asli.

`text.edit` boleh muncul paling banyak satu kali per (`pageKey`, `paragraphId`). Edit berikutnya menggantikan op yang sama.

## Frontend (`apps/web`)

- `app/page.tsx`: halaman unggah (drag & drop, maks 50 MB) dengan modal progres.
- `app/edit/[docId]/page.tsx`: shell editor.
- **Header**: nama file bisa diedit (dipakai untuk nama unduhan), tombol Cari, tombol Unduh.
- **Toolbar** baris 1:
  - kiri: tombol split Panel (Halaman/Anotasi), Undo, Redo
  - tengah: Select, Teks, Hapus▾ (Whiteout/Redact/Hapus coretan), Highlight▾ (Highlight/Underline/Strike), Gambar Bebas, Gambar▾ (Unggah/Stamp), Bentuk▾, Centang, Silang, Tanda Tangan, Catatan, Link
  - kanan: Kelola Halaman, Crop

  Tombol split mengingat sub-tool terakhir.
- **Toolbar** baris 2: panel properti kontekstual untuk tool aktif atau seleksi, dengan tombol hapus di ujung kanan.
- `Sidebar`: tab Halaman (thumbnail yang dirender ulang setelah edit, menu ⋮ per halaman, "+" di antara halaman untuk Halaman kosong/Impor PDF, drag untuk mengurutkan dengan dnd-kit) dan tab Anotasi (daftar objek per halaman).
- `PageCanvas`: satu per halaman, virtualized (halaman terlihat ±1). Lapisannya: canvas pdf.js, lalu `TextLayer` (paragraf asli dan hasil edit, SVG), `FormLayer`, overlay Konva untuk objek.
- `RichTextEditor`: Tiptap dengan mark font/size/color/bg/bold/italic/underline/strike.
- `FindBar`, `SignatureModal` (tab Gambar/Ketik/Unggah, checkbox "Simpan tanda tangan" ke localStorage), `StampPicker`, `LinkPopover`, `ManagePagesModal`, `CropOverlay`, `ColorPicker` (kotak SV, hue, eyedropper bila didukung, HEX/RGB, dan baris preset warna).
- `SelectionMiniBar`: duplikat, hapus, ⋯ (salin, tempel, duplikat, ratakan ke halaman: kiri/tengah/kanan/atas/tengah/bawah).
- **Pil bawah melayang**: halaman sebelumnya/berikutnya, "n/N", zoom −/+ dengan persentase, mode geser.
- Modul `lib/`: `coords.ts`, `compact.ts`, `layout/`, `fonts.ts` (registry dan pemuat), `search.ts`, `api.ts` (klien bertipe dari skema).
- `store/editor.ts`: Zustand berisi `ops`, `selection`, `history` (100 langkah), `zoom`, `activeTool`, `toolMemory`.

**Perilaku tool:** Teks, Gambar Bebas, Highlight, Centang, dan Silang tetap aktif setelah dipakai. Bentuk, Whiteout, dan Redact kembali ke Select setelah satu objek.

**Shortcut:**

| Aksi | Tombol |
|---|---|
| Undo | Ctrl/Cmd+Z |
| Redo | Ctrl/Cmd+Shift+Z, Ctrl+Y |
| Cari | Ctrl/Cmd+F |
| Salin / tempel / duplikat | Ctrl/Cmd+C, V, D |
| Link | Ctrl/Cmd+K |
| Hapus objek | Delete, Backspace |
| Geser 1 pt / 10 pt | panah / Shift+panah |
| Batal / keluar | Esc |
| Geser tampilan sementara | tahan Spasi |

UI berbahasa Indonesia (string dikumpulkan di satu file agar mudah ditambah i18n nanti).

## Backend (`apps/api/edith`)

- `main.py`: app FastAPI, routing, CORS untuk origin web.
- `storage.py`: folder per dokumen, sentuh-TTL, cleanup.
- `extract.py`: PDF → struktur (paragraf, font, field).
- `fonts.py`: memuat manifest, memetakan font asli ke pengganti, mengecek reusable, dan menyajikan byte font asli.
- `bake/__init__.py`: `bake(docs, ops, assets) -> Document`, berisi dispatcher dan urutan eksekusi.
- `bake/<jenis>.py`: satu handler murni per jenis op, `apply(page, op, ctx)`.
- `bake/text.py`: menggambar `LayoutLine` dengan `fitz.TextWriter` (font sesuai `FontRef`, warna, opacity), plus garis underline/strike dan kotak latar.
- `bake/stamps.py`: menggambar preset stamp secara vektor (bingkai sudut bulat + teks berfont registry).
- `render.py`: bake ke salinan dokumen lalu `get_pixmap(dpi=144)` untuk satu halaman.
- `errors.py`: kode error dan pemetaan ke HTTP.

### Urutan bake

1. **Validasi** semua ops (Pydantic). Pastikan semua `doc` di `pages.layout` masih ada, semua `assetId` ada, dan semua `pageKey` op konten ada di layout.
2. **Susun dokumen keluaran** menurut `pages.layout`. Mulai dari salinan dokumen utama (agar form dan struktur tetap utuh), lalu `select()` untuk urutan/hapus/duplikat, `insert_pdf` untuk halaman impor, dan `new_page` untuk halaman kosong. Bangun peta `pageKey → indeks keluaran`. Rotasi dan crop **belum** diubah.
3. **Redaksi**, per halaman, dengan satu kali `apply_redactions`:
   - `text.edit`: anotasi redaksi di bbox setiap baris paragraf asli (diperkecil 0,5 pt agar paragraf tetangga tidak ikut terhapus), dengan `images=PDF_REDACT_IMAGE_NONE` dan `graphics` dibiarkan.
   - `redact.add`: anotasi redaksi dengan `fill`, `images=PDF_REDACT_IMAGE_PIXELS`, dan grafis vektor yang bersinggungan ikut dihapus.
4. **Konten gambar**, mengikuti urutan ops (urutan tumpukan): whiteout, shape, ink, image, signature, stamp, symbol, lalu teks (`text.add` dan teks baru dari `text.edit`).
5. **Anotasi native**: `annot.add` (highlight/underline/strikeout/text annot), lalu `link.add` (`insert_link` dengan `LINK_URI` atau `LINK_GOTO` ke indeks keluaran dari `pageKey`).
6. **Form**: `form.set` memperbarui nilai widget. Jika `flatten_forms`, form diratakan.
7. **Rotasi dan crop** dari `pages.layout`: `set_rotation` dan `set_cropbox`.
8. `doc.save(garbage=3, deflate=True)`.

Bake bersifat atomik: dikerjakan pada salinan di memori. Jika satu op gagal, seluruh ekspor dibatalkan.

## Penanganan Error

| Kondisi | HTTP | Kode | Perilaku UI |
|---|---|---|---|
| Bukan PDF / rusak | 400 | `pdf_corrupt` | Pesan + ajakan unggah ulang |
| Terenkripsi | 400 | `pdf_encrypted` | Pesan bahwa fitur unlock belum tersedia |
| Terlalu besar | 413 | `too_large` | Tampilkan batas |
| Op tidak valid | 422 | `invalid_op` + `op_index` | Pesan generik, detail dicatat di console |
| Bake gagal | 500 | `bake_failed` + `op_id` | Sorot objek penyebab, lalu tawarkan untuk menghapusnya |
| Dokumen kedaluwarsa | 410 | `doc_expired` | Tawarkan unggah ulang; jika SHA-256 file yang diunggah cocok, ops dari localStorage dipulihkan (dokumen impor harus diunggah ulang juga) |
| Font asli gagal dimuat di client | — | — | Run beralih ke pengganti secara diam-diam |
| Halaman tanpa teks (hasil scan) | — | — | Tool edit teks menampilkan "Halaman ini berupa gambar; OCR belum tersedia" |

Semua pesan UI berbahasa Indonesia.

## Testing

- **Backend (pytest):**
  - Fixture PDF: teks multi-font (Times/Helvetica standard-14, TTF ter-embed penuh, TTF subset, CFF), paragraf rata kiri dan justify, form AcroForm, halaman hasil scan, halaman berotasi 90° dengan CropBox ≠ MediaBox, PDF terenkripsi.
  - `extract`: jumlah dan batas paragraf, deteksi align, flag `reusable`, dan pemetaan pengganti sesuai yang diharapkan per fixture.
  - Tiap handler bake: bake → ekstrak ulang → assert (teks baru ada dengan posisi baseline ±0,5 pt dari `layout`, teks lama hilang tetapi paragraf tetangga utuh, redact menghapus teks dan gambar, anotasi bertipe benar, link ke halaman benar, nilai form tersimpan).
  - `pages.layout`: urutkan ulang, duplikat (konten ganda hanya di halaman duplikat), impor, halaman kosong, rotasi + crop tidak menggeser posisi konten.
  - Snapshot PNG per handler dengan toleransi selisih piksel.
  - Endpoint: unggah, struktur, font, ekspor, kedaluwarsa (TTL dipalsukan), dan semua kode error.
- **Kontrak skema:** contoh ops JSON di `packages/ops/examples/` harus valid sebagai TS (tsc) maupun Pydantic.
- **Frontend (Vitest):**
  - store (undo/redo, batas riwayat, sesi edit teks = 1 langkah)
  - `compact.ts` (termasuk penggabungan ops halaman dan duplikasi op saat duplikat halaman)
  - `coords.ts` (semua rotasi, zoom, dan CropBox)
  - `layout/` (wrap, justify, baris baru, kata panjang, kerning)
  - `search.ts` (case-sensitive, kecocokan yang melintasi batas run, replace yang mempertahankan gaya)
  - pemilihan `FontRef` (glyph hilang → pengganti)
- **Paritas layout (Playwright):** untuk setiap fixture teks, edit sebuah paragraf, ekspor, render PNG di server, lalu bandingkan dengan screenshot layar pada zoom 100% (toleransi piksel).
- **E2E (Playwright):** unggah → edit teks asli (ubah satu kata menjadi bold) → Find & Replace → tambah tanda tangan, stamp, dan link → isi form → duplikat dan hapus halaman → crop → unduh → verifikasi isi PDF lewat endpoint struktur.

## Kriteria Selesai

- Semua fitur v1 berjalan end-to-end di Chrome, Firefox, dan Safari versi terbaru.
- PDF hasil ekspor terbuka tanpa peringatan di Acrobat Reader dan pdf.js. Anotasi markup dan sticky note bisa diedit di Acrobat.
- Edit teks asli: posisi baseline hasil ekspor berselisih ≤0,5 pt dari layar. Pada fixture dengan font Times/Helvetica/Calibri, teks yang tidak diubah dalam paragraf yang diedit tetap pada baris yang sama.
- Redact: teks di area redaksi tidak bisa ditemukan oleh `get_text` maupun pencarian pdf.js.
- Editor tetap responsif (<16 ms per frame saat menggeser objek, <50 ms reflow per ketikan pada paragraf 200 kata) pada PDF 200 halaman.
- Semua tes lulus di CI.
