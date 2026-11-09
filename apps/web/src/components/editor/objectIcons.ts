import {
  ArrowUpRight, Check, Circle, Cloud, Eraser, EyeOff, Highlighter, Image, Link2, MessageSquare, Pencil, Pentagon, Signature, Slash,
  Spline, Square, Stamp, Strikethrough, Type, Underline, X, type LucideIcon,
} from "lucide-react";
import type { ObjectIcon } from "@/lib/objectLabels";

/** The line icon of each kind of object (Anotasi panel, the context menu's "Pilih elemen di bawah"). */
export const OBJECT_ICONS: Record<ObjectIcon, LucideIcon> = {
  text: Type, textEdit: Type, image: Image, signature: Signature, rect: Square, ellipse: Circle, line: Slash, arrow: ArrowUpRight,
  polygon: Pentagon, polyline: Spline, cloud: Cloud, ink: Pencil, whiteout: Eraser, redact: EyeOff, stamp: Stamp, check: Check, cross: X,
  link: Link2, note: MessageSquare, highlight: Highlighter, underline: Underline, strike: Strikethrough,
};
