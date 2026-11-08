/** Class recipes shared by every control, so buttons, fields, menus and dialogs look the same everywhere. */

/** Dialog backdrop (a darkened canvas) and the dialog surface. */
export const BACKDROP = "fixed inset-0 z-40 flex justify-center bg-base/70";
export const DIALOG = "flex flex-col rounded-xl bg-raised text-sm text-ink shadow-modal outline-none";
export const DIALOG_TITLE = "text-base font-medium text-ink";

/** Floating panels: menus, popovers, the find bar, the crop bar, the mini-bar. */
export const POPOVER = "rounded-lg bg-raised text-sm text-ink shadow-pop";
/** A menu item; keyboard focus (arrow keys) shows the hover fill plus the focus ring drawn inside the item. */
export const MENU_ITEM = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover focus-visible:bg-hover focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-45";

/** Buttons: primary (the one main action of a surface), secondary, quiet (icon or text), danger. */
const BTN_BASE = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45";
export const BTN_PRIMARY = `${BTN_BASE} bg-accent text-accent-ink hover:bg-accent-hover`;
export const BTN_SECONDARY = `${BTN_BASE} bg-hover text-ink ring-1 ring-inset ring-line-strong hover:bg-line`;
export const BTN_QUIET = `${BTN_BASE} font-normal text-muted hover:bg-hover hover:text-ink`;
export const BTN_DANGER = `${BTN_BASE} font-normal text-danger-text hover:bg-danger/15`;
/** A square icon-only button (close, prev/next …). */
export const BTN_ICON = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:text-faint/60";

/** Text fields and selects on dark surfaces. */
export const FIELD = "h-8 rounded-md border border-line-strong bg-base/60 px-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/** A segmented control (tabs, language, mode): the track and one segment. */
export const SEGMENTED = "flex rounded-md bg-base/60 p-0.5 ring-1 ring-inset ring-line";
export const segment = (on: boolean) =>
  `h-7 rounded-[5px] px-3 text-xs font-medium transition-colors ${on ? "bg-raised text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-ink"}`;

/** Toggle buttons in the properties bar (B, I, U, align …). */
export const toggle = (on: boolean) =>
  `grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors ${on ? "bg-accent/20 text-accent-text" : "text-muted hover:bg-hover hover:text-ink"}`;

/** A small field label in the properties bar. */
export const PROP_LABEL = "flex shrink-0 items-center gap-2 text-xs text-muted";

/** A colour dot (swatch) with the selected one ringed in the accent; keyboard focus rings it in white instead. */
export const swatch = (on: boolean) =>
  `h-5 w-5 shrink-0 rounded-full ring-1 ring-inset ring-line-strong ${on ? "outline outline-2 outline-offset-2 outline-accent-text" : ""} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`;
