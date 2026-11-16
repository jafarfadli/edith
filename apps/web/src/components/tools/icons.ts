import { Droplet, FileImage, FileOutput, FileSearch, FileText, Hash, Images, Layers, Lock, LockOpen, Minimize2, Scissors, type LucideIcon } from "lucide-react";
import type { ToolSlug } from "@/lib/tools";

export const TOOL_ICONS: Record<ToolSlug, LucideIcon> = {
  "gabung-pdf": Layers, "pisah-pdf": Scissors, "ambil-halaman": FileOutput, "kompres-pdf": Minimize2,
  "pdf-ke-gambar": FileImage, "gambar-ke-pdf": Images, "pdf-ke-teks": FileText, "buka-kunci-pdf": LockOpen, "kunci-pdf": Lock,
  "watermark-pdf": Droplet, "nomor-halaman": Hash, "pdf-bisa-dicari": FileSearch,
};
