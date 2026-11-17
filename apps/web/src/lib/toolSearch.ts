import { t } from "@/lib/strings";
import type { ToolSlug } from "@/lib/tools";

/** The everyday words people look for each tool by (Indonesian, the way they say what they need). */
export const TOOL_WORDS: Record<ToolSlug, string> = {
  "gabung-pdf": "gabung satukan jadikan satu gabungkan merge combine",
  "pisah-pdf": "pisah pecah bagi split potong per halaman",
  "ambil-halaman": "ambil halaman tertentu pilih halaman extract simpan sebagian",
  "kompres-pdf": "kompres kecilkan perkecil ukuran file mb kb compress ringan upload formulir batas ukuran",
  "pdf-ke-gambar": "gambar jpg png foto image convert screenshot",
  "gambar-ke-pdf": "foto gambar jpg png jadi pdf jadikan pdf image",
  "pdf-ke-teks": "teks txt salin tulisan ambil tulisan",
  "buka-kunci-pdf": "buka kunci sandi password hapus kata sandi unlock",
  "kunci-pdf": "kunci sandi password lindungi protect rahasia",
  "watermark-pdf": "watermark tanda air rahasia draft salinan",
  "nomor-halaman": "nomor halaman romawi skripsi penomoran page number",
  "pdf-bisa-dicari": "ocr scan bisa dicari salin teks hasil scan kenali tulisan",
  "office-ke-pdf": "word docx excel xlsx powerpoint pptx dokumen jadi pdf",
  "pdf-ke-word": "word docx edit di word convert",
  "scan-dokumen": "scan foto dokumen kertas hp kamera scanner lurus",
  "pas-foto": "pas foto latar merah biru background 3x4 2x3 4x6 cv lamaran",
  "kartu-ke-a4": "ktp sim npwp kartu fotokopi depan belakang a4 bpjs",
  "ukuran-kertas": "ukuran kertas f4 a4 folio legal letter margin skripsi 4433",
};

/** Things done in the editor, not by a tool: a search for them points there. */
export const EDITOR_WORDS = "edit teks ubah tulisan ganti kata tanda tangan ttd paraf sensor coret stabilo highlight isi formulir stempel tambah gambar hapus tulisan";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The tools matching `query` (every word found in the name, the description or the everyday words), best first. */
export function searchTools(query: string, slugs: ToolSlug[]): ToolSlug[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return slugs;
  const q = fold(query.trim());
  return slugs.flatMap((slug) => {
    const item = t.tools.items[slug];
    const name = fold(item.name);
    const hay = `${name} ${fold(item.desc)} ${fold(TOOL_WORDS[slug])} ${slug.replace(/-/g, " ")}`;
    if (!words.every((w) => hay.includes(w))) return [];
    return [{ slug, score: name.startsWith(q) ? 0 : name.includes(q) ? 1 : fold(TOOL_WORDS[slug]).includes(q) ? 2 : 3 }];
  }).sort((a, b) => a.score - b.score).map((x) => x.slug);
}

/** Whether `query` asks for something the editor does. */
export function wantsEditor(query: string): boolean {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 2);
  const hay = fold(EDITOR_WORDS);
  return words.length > 0 && words.some((w) => hay.includes(w));
}
