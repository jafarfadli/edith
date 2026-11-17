import type { ReactNode, SVGProps } from "react";

/** Edith's own icons: a 24 px grid, one 1.75 stroke with round ends, and every document drawn as the same sheet with
 *  its corner folded (the sheet of the logo). Same props as lucide's, so they drop in where lucide was. */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number | string; strokeWidth?: number | string };
export type Icon = ((props: IconProps) => ReactNode) & { displayName?: string };

function icon(name: string, body: ReactNode): Icon {
  const C = ({ size = 24, strokeWidth = 1.75, ...rest }: IconProps) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {body}
    </svg>
  );
  C.displayName = name;
  return C;
}

/** The sheet: 12 × 18, corner folded 4. */
const SHEET = "M6 3h8l4 4v14H6z";
const FOLD = "M14 3v4h4";

export const SheetIcon = icon("Sheet", <><path d={SHEET} /><path d={FOLD} /><path d="M9 12h6M9 15h6M9 18h3" /></>);
export const UploadIcon = icon("Upload", <><path d={SHEET} /><path d={FOLD} /><path d="M12 18v-6.5M9.25 14 12 11.25 14.75 14" /></>);

/** Two sheets stacked into one. */
export const MergeIcon = icon("Merge", <><path d="M9 6V3h7l3 3v11h-2" /><path d="M16 3v3h3" /><path d="M5 7h8l3 3v11H5z" /><path d="M13 7v3h3" /></>);
/** One sheet cut across: the cut runs past both edges. */
export const SplitIcon = icon("Split", <><path d="M6 10.5V3h8l4 4v3.5" /><path d={FOLD} /><path d="M6 14.5V21h12v-6.5" /><path d="M3 12.5h1.5M7 12.5h1.5M11.25 12.5h1.5M15.5 12.5H17M19.5 12.5H21" /></>);
/** A page taken out of the stack. */
export const ExtractIcon = icon("Extract", <><path d="M4 5h7l3 3v13H4z" /><path d="M11 5v3h3" /><path d="M9 14.5h11.5M17.5 11.5l3 3-3 3" /></>);
/** The sheet pressed from above and below. */
export const CompressIcon = icon("Compress", <><path d="M7 9h7l3 3v4H7z" /><path d="M14 9v3h3" /><path d="M12 2v4M10 4.5 12 6.5l2-2M12 22v-3.5M10 20.5l2-2 2 2" /></>);
/** A sheet seen at an angle, framed by a scanner's corner marks. */
export const ScanIcon = icon("Scan", <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="m8.5 7.5 6.5-.5 1 9.5-7 .5z" /><path d="M10 11h4M10.25 13.5h3" /></>);
/** A picture on the sheet. */
export const ToImagesIcon = icon("ToImages", <><path d={SHEET} /><path d={FOLD} /><path d="m8.5 18 2.75-3 2 2 1.25-1.25L16 17.5" /><circle cx="10" cy="11" r="1.25" /></>);
/** Pictures laid onto a sheet. */
export const FromImagesIcon = icon("FromImages", <><path d="M11 3h6l3 3v15h-9" /><path d="M17 3v3h3" /><rect x="3" y="8" width="11" height="9" rx="1.5" /><path d="m5 15 2.5-2.75 2 2 1-1L13 15" /></>);
/** A document of another kind (square corner, ruled) becoming the folded sheet. */
export const OfficeIcon = icon("Office", <><rect x="2.5" y="5" width="8" height="11" rx="1" /><path d="M4.75 8.5h3.5M4.75 11h3.5M4.75 13.5h2" /><path d="M13 3h5l3.5 3.5V21H13z" /><path d="M18 3v3.5h3.5" /><path d="M10.5 18.5h2M11.75 17.25l1.25 1.25-1.25 1.25" /></>);
/** The sheet with a W. */
export const ToWordIcon = icon("ToWord", <><path d={SHEET} /><path d={FOLD} /><path d="m8.5 11 1.4 6.5L12 13l2.1 4.5 1.4-6.5" /></>);
/** Text lifted off the sheet. */
export const ToTextIcon = icon("ToText", <><path d={SHEET} /><path d={FOLD} /><path d="M9 11h6M12 11v7" /></>);
export const UnlockIcon = icon("Unlock", <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 7.6-1.75" /><path d="M12 15v2" /></>);
export const LockIcon = icon("Lock", <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /><path d="M12 15v2" /></>);
/** Faint diagonal print across the sheet. */
export const WatermarkIcon = icon("Watermark", <><path d={SHEET} /><path d={FOLD} /><path d="m8.5 17.5 6-6M11.5 18.5l4-4" /></>);
/** A number at the foot of the sheet. */
export const PageNumberIcon = icon("PageNumber", <><path d={SHEET} /><path d={FOLD} /><path d="M10.75 15.25 12 14.5v4.25M10.5 18.75h3" /></>);
/** The sheet under a magnifier. */
export const SearchableIcon = icon("Searchable", <><path d="M13 21H6V3h8l4 4v3" /><path d={FOLD} /><circle cx="15.5" cy="15.5" r="3.25" /><path d="m18 18 3 3" /></>);

/** Everyday controls, in the same stroke. */
export const CloseIcon = icon("Close", <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const PlusIcon = icon("Plus", <path d="M12 5.5v13M5.5 12h13" />);
export const ArrowLeftIcon = icon("ArrowLeft", <path d="M19 12H5.5M11 6.5 5.5 12l5.5 5.5" />);
export const ArrowUpIcon = icon("ArrowUp", <path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5" />);
export const ArrowDownIcon = icon("ArrowDown", <path d="M12 5v13.5M6.5 13l5.5 5.5 5.5-5.5" />);
/** Two blades crossing, handles below: marks a cut line. */
export const ScissorsIcon = icon("Scissors", <><circle cx="7" cy="17.5" r="2.75" /><circle cx="17" cy="17.5" r="2.75" /><path d="M8.75 15.4 16 3.5M15.25 15.4 8 3.5" /></>);
/** Busy: a quarter of a circle turning (add `animate-spin`). */
export const SpinnerIcon = icon("Spinner", <><circle cx="12" cy="12" r="8" opacity=".25" /><path d="M20 12a8 8 0 0 0-8-8" /></>);

/* The editor's tools. */
export const PointerIcon = icon("Pointer", <path d="M5.5 4 18 10.5l-5.5 1.75L10 18z" />);
export const TextIcon = icon("Text", <path d="M5.5 7V4.5h13V7M12 4.5v15M9.5 19.5h5" />);
/** Reading text in an area: the area's corners around two lines. */
export const OcrAreaIcon = icon("OcrArea", <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M8 10h8M8 14h5" /></>);
/** Whiteout: a block of correction tape over the line. */
export const WhiteoutIcon = icon("Whiteout", <><path d="M3.5 12h3M17.5 12h3" /><rect x="6.5" y="8" width="11" height="8" rx="1.5" /><path d="m9.5 16 2.5-2.5" /></>);
/** Redaction: a solid bar across the text. */
export const RedactIcon = icon("Redact", <><path d="M4 7h7M4 17h12" /><rect x="4" y="10" width="16" height="4" rx="1" fill="currentColor" /></>);
/** A highlighter's chisel tip over its band. */
export const HighlightIcon = icon("Highlight", <><path d="m14.5 4.5 5 5-7.5 7.5H7v-5z" /><path d="m7 17-2.5 2.5M12 9.5l2.5 2.5" /><path d="M3.5 21h17" /></>);
export const UnderlineIcon = icon("Underline", <path d="M7 4.5v6a5 5 0 0 0 10 0v-6M5.5 20h13" />);
export const StrikeIcon = icon("Strike", <path d="M16.5 7.5c-.6-1.8-2.4-3-4.6-3-2.6 0-4.4 1.5-4.4 3.5 0 4 9.5 2.5 9.5 7.25 0 2.2-2 3.75-4.9 3.75-2.5 0-4.4-1.2-5.1-3.25M4 12h16" />);
/** A pencil, the same one lying on the bench. */
export const PencilIcon = icon("Pencil", <><path d="M15.5 4.5 19.5 8.5 9 19H5v-4z" /><path d="m13 7 4 4M5 15l4 4" /></>);
export const RectIcon = icon("Rect", <rect x="4.5" y="5.5" width="15" height="13" rx="1.5" />);
export const EllipseIcon = icon("Ellipse", <ellipse cx="12" cy="12" rx="8" ry="6.5" />);
export const LineIcon = icon("Line", <path d="M5 19 19 5" />);
export const ArrowIcon = icon("Arrow", <path d="M5 19 18.5 5.5M10.5 5.5h8v8" />);
export const PolygonIcon = icon("Polygon", <path d="m12 4 8 6-3 9.5H7L4 10z" />);
export const PolylineIcon = icon("Polyline", <path d="M3.5 17.5 9 8.5l5 7 6.5-10" />);
export const CloudIcon = icon("Cloud", <path d="M7 18.5h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6-1A4.5 4.5 0 0 0 7 18.5z" />);
/** A picture with a plus at its corner. */
export const ImageAddIcon = icon("ImageAdd", <><path d="M20 13v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11A1.5 1.5 0 0 1 5.5 5H12" /><path d="m4.5 17 4.5-4.5 3 3 2-2 5.5 5" /><circle cx="9" cy="9.5" r="1.25" /><path d="M18 3.5v5M15.5 6h5" /></>);
/** A rubber stamp, from the side. */
export const StampIcon = icon("Stamp", <><path d="M9.5 10.5V9a2.5 2.5 0 1 1 5 0v1.5" /><path d="M5 13.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V16H5z" /><path d="M7 19.5h10" /></>);
/** A signature on its line. */
export const SignatureIcon = icon("Signature", <><path d="M4 15.5c2.5-.5 3.5-8 5.5-8s.5 7 2.5 7 1.5-3 3-3 1 2.5 2.5 2.5H20" /><path d="M4 19.5h16" /></>);
export const CheckIcon = icon("Check", <path d="m5 12.5 4.5 4.5L19 7" />);
export const CrossIcon = icon("Cross", <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
/** The pages laid out as sheets. */
export const PagesIcon = icon("Pages", <><path d="M4 4h5.5l1.5 1.5V11H4z" /><path d="M13 4h5.5L20 5.5V11h-7z" /><path d="M4 13h5.5l1.5 1.5V20H4z" /><path d="M13 13h5.5l1.5 1.5V20h-7z" /></>);
/** Crop marks. */
export const CropIcon = icon("Crop", <path d="M7 3.5V17h13.5M3.5 7H17v13.5" />);
export const UndoIcon = icon("Undo", <path d="M9 14 4.5 9.5 9 5M4.5 9.5h10a5 5 0 0 1 0 10H11" />);
export const RedoIcon = icon("Redo", <path d="m15 14 4.5-4.5L15 5M19.5 9.5h-10a5 5 0 0 0 0 10H13" />);
export const SearchIcon = icon("Search", <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>);
/** The sheet coming down to you. */
export const DownloadIcon = icon("Download", <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" /></>);
export const ChevronDownIcon = icon("ChevronDown", <path d="m7 10 5 5 5-5" />);
export const ChevronRightIcon = icon("ChevronRight", <path d="m10 7 5 5-5 5" />);
