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
