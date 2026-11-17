import {
  CompressIcon, ExtractIcon, FromImagesIcon, LockIcon, MergeIcon, OfficeIcon, PageNumberIcon, SearchableIcon, SplitIcon,
  CardsIcon, PaperSizeIcon, PortraitIcon, ScanIcon, ToImagesIcon, ToTextIcon, ToWordIcon, UnlockIcon, WatermarkIcon, type Icon,
} from "../brand/icons";
import type { ToolSlug } from "@/lib/tools";

export const TOOL_ICONS: Record<ToolSlug, Icon> = {
  "gabung-pdf": MergeIcon, "pisah-pdf": SplitIcon, "ambil-halaman": ExtractIcon, "kompres-pdf": CompressIcon,
  "pdf-ke-gambar": ToImagesIcon, "gambar-ke-pdf": FromImagesIcon, "pdf-ke-teks": ToTextIcon, "buka-kunci-pdf": UnlockIcon, "kunci-pdf": LockIcon,
  "office-ke-pdf": OfficeIcon, "pdf-ke-word": ToWordIcon, "scan-dokumen": ScanIcon, "pas-foto": PortraitIcon, "kartu-ke-a4": CardsIcon, "ukuran-kertas": PaperSizeIcon,
  "watermark-pdf": WatermarkIcon, "nomor-halaman": PageNumberIcon, "pdf-bisa-dicari": SearchableIcon,
};

/** The start page's tray: the tools grouped by what they do to the PDF. */
export const TOOL_GROUPS: { name: "pages" | "convert" | "photo" | "security" | "size"; tools: ToolSlug[] }[] = [
  { name: "pages", tools: ["gabung-pdf", "pisah-pdf", "ambil-halaman", "nomor-halaman", "ukuran-kertas"] },
  { name: "convert", tools: ["pdf-ke-word", "office-ke-pdf", "pdf-ke-gambar", "gambar-ke-pdf", "pdf-ke-teks", "pdf-bisa-dicari"] },
  { name: "photo", tools: ["scan-dokumen", "pas-foto", "kartu-ke-a4"] },
  { name: "security", tools: ["kunci-pdf", "buka-kunci-pdf", "watermark-pdf"] },
  { name: "size", tools: ["kompres-pdf"] },
];
