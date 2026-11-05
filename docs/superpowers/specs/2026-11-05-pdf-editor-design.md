# Edith — Desain Editor PDF (Sub-proyek 1)

Tanggal: 2026-11-05
Status: Disetujui (menunggu review spec tertulis)

## Konteks

Edith adalah aplikasi PDF all-in-one yang meniru cakupan fitur pdfguru.com (editor, tools organisasi, konversi, keamanan, platform akun). Hanya fungsionalitas yang ditiru; nama, logo, teks, dan aset pdfguru tidak dipakai.

Proyek dipecah menjadi sub-proyek yang dibangun berurutan:

1. **Editor PDF** (dokumen ini)
2. Tools organisasi (merge, split, compress, dll.)
3. Konversi (PDF ke/dari Word, Excel, PPT, gambar)
4. Keamanan (protect/unlock, watermark)
5. Platform (landing, akun, dashboard, pembayaran)

## Tujuan

Editor PDF berbasis web yang berkualitas tinggi. Pengguna mengunggah PDF, mengeditnya, lalu mengunduh hasilnya, tanpa perlu akun.

### Fitur v1

- **Edit teks asli**: klik teks yang sudah ada di PDF, lalu ubah isi, font, ukuran, dan warnanya.
- **Tambah konten**: text box, gambar, bentuk (kotak, elips, garis, panah), gambar bebas (freehand), dan whiteout.
- **Anotasi**: highlight, underline, strikethrough, sticky note.
- **Tanda tangan**: digambar, diketik (3 font script), atau diunggah.
- **Form**: isi field AcroForm (teks, checkbox, radio, dropdown), dengan opsi flatten saat ekspor.
- **Halaman**: thumbnail sidebar untuk mengurutkan ulang, memutar, menghapus, dan menyisipkan halaman kosong.

### Di luar cakupan v1

Akun/login, penyimpanan permanen, OCR, unlock PDF terenkripsi, konversi format, kolaborasi, aplikasi mobile.

## Keputusan Utama

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Lokasi proses | Browser + backend | Edit teks asli butuh PyMuPDF di server |
| Stack | Next.js 15 + FastAPI + PyMuPDF | PyMuPDF paling kuat untuk redaksi/penyisipan teks, dan siap dipakai untuk OCR/konversi nanti |
| Model edit | Ops JSON di client, di-bake di server saat ekspor | Interaksi cepat, undo instan, backend stateless dan mudah dites |
| Akun/file | Tanpa akun; file sementara dengan TTL 1 jam | Cakupan v1 tetap kecil |

**Lisensi:** PyMuPDF berlisensi AGPL-3.0. Jika Edith dijalankan sebagai SaaS tertutup, kode backend wajib dibuka atau dibelikan lisensi komersial dari Artifex. Keputusan ini harus diambil sebelum rilis publik.

## Arsitektur

### Struktur repo

```
edith/
  apps/web/          Next.js 15 (App Router, TypeScript, Tailwind, shadcn/ui)
  apps/api/          FastAPI + PyMuPDF (Python 3.12, dikelola uv)
  packages/ops/      JSON Schema ops edit — satu-satunya sumber kebenaran
                     → generate tipe TS (web) dan model Pydantic (api)
  docker-compose.yml web + api
```

### Alur data

1. `POST /documents` (multipart PDF) → `{doc_id, sha256, page_count}`. File disimpan di `$EDITH_DATA/{doc_id}/source.pdf`. `doc_id` adalah token acak 128-bit. TTL 1 jam sejak akses terakhir.
2. `GET /documents/{id}/structure` → struktur dokumen:
   - `pages[]`: `index`, `width`, `height`, `rotation`
   - `spans[]`: `id`, `page`, `bbox`, `text`, `font`, `size`, `color`, `flags` (bold/italic/serif/mono)
   - `fields[]`: `name`, `type`, `value`, `options?`, `page`, `bbox`
3. `GET /documents/{id}/file` → PDF asli. Browser me-render-nya dengan pdf.js.
4. Pengguna mengedit. Store client menyimpan `ops[]` beserta riwayat undo/redo, dan menyimpan otomatis ke localStorage dengan kunci `sha256`.
5. `POST /assets` (gambar/tanda tangan PNG/JPEG, maks 10 MB) → `{asset_id}`, terikat ke `doc_id`.
6. `POST /documents/{id}/render-page` `{page, ops}` → PNG halaman setelah bake. Dipakai untuk tombol "Preview akurat".
7. `POST /documents/{id}/export` `{ops, flatten_forms}` → stream PDF hasil.
8. Job cleanup (APScheduler di dalam proses API, tiap 5 menit) menghapus folder yang sudah kedaluwarsa.

### Batasan

- Unggahan maksimal 50 MB atau 500 halaman.
- PDF terenkripsi ditolak dengan kode `pdf_encrypted`.
- Request ekspor maksimal 5.000 ops.

### Sistem koordinat

Semua ops memakai **satuan poin PDF dengan asal di kiri-atas halaman yang belum diputar** (konvensi PyMuPDF). Frontend yang mengonversi ke piksel layar berdasarkan zoom dan rotasi halaman. Satu fungsi konversi (`coords.ts`) menangani semua kasus dan dites terpisah.

## Skema Ops

Setiap op memiliki `id` (UUID), `type`, dan `page` (indeks halaman **asli**, berbasis 0). Op halaman tidak memiliki `page` tunggal.

| type | field |
|---|---|
| `text.replace` | `spanIds[]`, `newText`, `font?`, `size?`, `color?` |
| `text.add` | `rect`, `text`, `font`, `size`, `color`, `align` (left/center/right) |
| `image.add` | `rect`, `assetId` |
| `signature.add` | `rect`, `assetId` |
| `shape.add` | `kind` (rect/ellipse/line/arrow), `rect` atau `points`, `stroke`, `fill?`, `width` |
| `ink.add` | `paths` (array of array titik), `color`, `width` |
| `whiteout.add` | `rect` |
| `annot.add` | `kind` (highlight/underline/strike/note), `quads` atau `point`, `color`, `content?` |
| `form.set` | `fieldName`, `value` |
| `page.rotate` | `page`, `deg` (90/180/270) |
| `page.delete` | `page` |
| `page.insertBlank` | `after` (indeks asli, -1 = di awal), `width`, `height` |
| `page.reorder` | `order[]` (permutasi indeks halaman final) |

Di dalam client ada juga `object.update` (`targetId`, `patch`) dan `object.delete` (`targetId`). Sebelum dikirim ke backend, client **memadatkan** ops: update digabung ke op asalnya, dan op yang sudah dihapus dibuang. Backend hanya menerima ops yang sudah padat.

Ops halaman (`page.rotate`, `page.delete`, `page.insertBlank`, `page.reorder`) hanya dipakai di riwayat undo/redo client. Saat pemadatan, semuanya digabung menjadi **satu** op `pages.layout`, sehingga tidak ada ambiguitas indeks:

| type | field |
|---|---|
| `pages.layout` | `pages[]`: tiap entri `{src: int | null, rotate: 0/90/180/270, width?, height?}`. `src` adalah indeks halaman asli; `null` berarti halaman kosong baru (wajib `width`/`height`). Urutan array adalah urutan final. Halaman asli yang tidak muncul berarti dihapus. |

Backend hanya menerima `pages.layout` (maksimal satu per request), tidak menerima keempat op halaman mentah.

`font` adalah salah satu dari `sans`, `serif`, `mono`, `script-1..3`, ditambah `bold`/`italic` sebagai boolean terpisah.

## Frontend (`apps/web`)

- `app/page.tsx`: halaman unggah sederhana (drag & drop).
- `app/edit/[docId]/page.tsx`: shell editor.
- `components/editor/Toolbar`: pemilihan tool, warna, font, ukuran.
- `components/editor/PageSidebar`: thumbnail dengan drag untuk mengurutkan (dnd-kit), serta tombol putar, hapus, dan sisip.
- `components/editor/PageCanvas`: satu per halaman, virtualized (hanya halaman yang terlihat ±1 yang di-render). Lapisannya: canvas pdf.js, lalu `TextEditLayer`, `FormLayer`, dan overlay Konva untuk objek.
- `components/editor/TextEditLayer`: span asli bisa diklik. Saat diedit, bbox ditutup putih di layar dan muncul input inline berisi teks lama dengan font pengganti.
- `components/editor/FormLayer`: kontrol HTML diposisikan di atas bbox field.
- `components/editor/SignatureModal`: tab Gambar / Ketik / Unggah. Hasilnya PNG transparan yang diunggah ke `/assets`.
- `components/editor/PropertiesPanel`: atribut objek terpilih.
- `lib/coords.ts`: konversi poin PDF ↔ piksel layar.
- `lib/compact.ts`: pemadatan ops.
- `store/editor.ts`: Zustand berisi `ops`, `selection`, `history` (100 langkah), `zoom`, `activeTool`.
- `lib/api.ts`: klien API bertipe (dari skema yang di-generate).

Shortcut: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z atau Ctrl+Y (redo), Delete, Ctrl/Cmd+C/V untuk objek, panah untuk menggeser 1 pt (Shift+panah = 10 pt).

UI berbahasa Indonesia (string dikumpulkan di satu file agar mudah ditambah i18n nanti).

## Backend (`apps/api/edith`)

- `main.py`: app FastAPI, routing, CORS untuk origin web.
- `storage.py`: folder per dokumen, sentuh-TTL, cleanup.
- `extract.py`: PDF → struktur (`page.get_text("dict")`, `page.widgets()`). ID span stabil: `p{page}-b{block}-l{line}-s{span}`.
- `fonts.py`: memetakan nama dan flags font asli ke Noto Sans/Serif/Mono (Regular/Bold/Italic/BoldItalic), yang dibundel di `apps/api/fonts/`. Font subset bawaan PDF tidak dipakai ulang karena glyph-nya tidak lengkap.
- `bake/__init__.py`: `bake(doc, ops, assets) -> Document`, berisi dispatcher dan urutan eksekusi.
- `bake/<jenis>.py`: satu handler murni per jenis op, `apply(doc, op, ctx)`.
- `render.py`: bake ke salinan dokumen lalu `get_pixmap(dpi=144)` untuk satu halaman.
- `errors.py`: kode error dan pemetaan ke HTTP.

### Urutan bake

1. Validasi semua ops (Pydantic). Semua indeks halaman merujuk ke dokumen asli.
2. **`text.replace`** dikelompokkan per halaman. Tambahkan anotasi redaksi di bbox setiap span target, lalu panggil `page.apply_redactions(images=PDF_REDACT_IMAGE_NONE)` sekali per halaman. Setelah itu `insert_textbox` dengan font hasil pemetaan dan warna asli (atau yang di-override). Jika teks tidak muat, ukuran font diperkecil bertahap sampai minimal 70% dari ukuran semula; jika masih tidak muat, rect diperlebar ke kanan sampai batas halaman.
3. Konten yang digambar ke halaman, dengan urutan tumpukan sesuai urutan ops: `whiteout.add`, `shape.add`, `ink.add`, `image.add`, `signature.add`, `text.add`.
4. Anotasi PDF native: `annot.add` (highlight/underline/strikeout/text annot), agar tetap bisa diedit di Acrobat.
5. `form.set` memperbarui nilai widget. Jika `flatten_forms`, form diratakan.
6. `pages.layout` diterapkan **terakhir**: dokumen baru disusun dengan `insert_pdf` per entri (atau `new_page` untuk `src: null`), lalu rotasi tiap halaman di-set. Field form dan anotasi ikut terbawa bersama halamannya.
7. `doc.save(garbage=3, deflate=True)`.

Bake bersifat atomik: dikerjakan pada salinan dokumen. Jika satu op gagal, seluruh ekspor dibatalkan.

## Penanganan Error

| Kondisi | HTTP | Kode | Perilaku UI |
|---|---|---|---|
| Bukan PDF / rusak | 400 | `pdf_corrupt` | Pesan + ajakan unggah ulang |
| Terenkripsi | 400 | `pdf_encrypted` | Pesan bahwa fitur unlock belum tersedia |
| Terlalu besar | 413 | `too_large` | Tampilkan batas |
| Op tidak valid | 422 | `invalid_op` + `op_index` | Pesan generik, detail dicatat di console |
| Bake gagal | 500 | `bake_failed` + `op_id` | Sorot objek penyebab, lalu tawarkan untuk menghapusnya |
| Dokumen kedaluwarsa | 410 | `doc_expired` | Tawarkan unggah ulang; jika SHA-256 file yang diunggah cocok, ops dari localStorage dipulihkan |
| Halaman tanpa teks (hasil scan) | — | — | Tool edit teks menampilkan "Halaman ini berupa gambar; OCR belum tersedia" |

Semua pesan UI berbahasa Indonesia.

## Testing

- **Backend (pytest):**
  - Fixture PDF: teks sederhana, multi-font, form AcroForm, halaman hasil scan, halaman berotasi 90°, PDF terenkripsi.
  - Tiap handler bake: bake → ekstrak ulang → assert (teks baru ada di bbox, teks lama hilang, anotasi bertipe benar, nilai form tersimpan, urutan halaman benar).
  - Snapshot PNG per handler dengan toleransi selisih piksel.
  - Endpoint: unggah, struktur, ekspor, kedaluwarsa (TTL dipalsukan), dan semua kode error.
- **Kontrak skema:** contoh ops JSON di `packages/ops/examples/` harus valid sebagai TS (tsc) maupun Pydantic.
- **Frontend (Vitest):** store (undo/redo, batas riwayat), `compact.ts`, `coords.ts` (semua rotasi dan zoom).
- **E2E (Playwright):** unggah → edit teks asli → tambah tanda tangan → isi form → hapus halaman → unduh → verifikasi isi PDF lewat endpoint struktur.

## Kriteria Selesai

- Semua fitur v1 berjalan end-to-end di Chrome, Firefox, dan Safari versi terbaru.
- PDF hasil ekspor terbuka tanpa peringatan di Acrobat Reader dan pdf.js, dan anotasinya bisa diedit di Acrobat.
- Edit teks asli pada fixture multi-font menghasilkan teks yang posisinya tepat di bbox asal (toleransi 2 pt).
- Editor tetap responsif (<16 ms per frame saat menggeser objek) pada PDF 200 halaman.
- Semua tes lulus di CI.
