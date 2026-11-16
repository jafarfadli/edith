---
name: Edith
description: A PDF editor laid out as a dark workbench, with the document as a white sheet on a cutting grid.
colors:
  accent: "oklch(81% 0.155 80)"
  accent-hover: "oklch(86% 0.14 86)"
  accent-text: "oklch(85% 0.135 84)"
  accent-ink: "oklch(21% 0.01 80)"
  base: "oklch(20.5% 0.002 80)"
  panel: "oklch(23.5% 0.002 80)"
  canvas: "oklch(26% 0.002 80)"
  raised: "oklch(28.5% 0.003 80)"
  hover: "oklch(98% 0.003 80 / 0.07)"
  line: "oklch(32% 0.003 80)"
  line-strong: "oklch(41% 0.004 80)"
  grid: "oklch(98% 0 0 / 0.045)"
  grid-strong: "oklch(98% 0 0 / 0.08)"
  ink: "oklch(94.5% 0.003 80)"
  muted: "oklch(74% 0.004 80)"
  faint: "oklch(66.5% 0.004 80)"
  chalk: "oklch(90% 0.01 85)"
  paper: "oklch(100% 0 0)"
  paper-ink: "oklch(21% 0.004 80)"
  danger: "oklch(65% 0.2 25)"
  danger-text: "oklch(75% 0.15 25)"
  warn: "oklch(76% 0.15 55)"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 6vw, 4.75rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    fontVariation: "\"wdth\" 112"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
    fontVariation: "\"wdth\" 112"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: "1.75rem"
    letterSpacing: "-0.025em"
    fontVariation: "\"wdth\" 112"
  body-lg:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.14em"
    fontVariation: "\"wdth\" 78"
  caption:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: "0.8125rem"
    fontVariation: "\"wdth\" 78"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  sheet: "2px"
  segment: "5px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  hair: "2px"
  tight: "6px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "40px"
  control: "32px"
  bar: "56px"
  rail: "60px"
  container: "72rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "{spacing.control}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "{spacing.control}"
  button-secondary-hover:
    backgroundColor: "{colors.line}"
  button-quiet:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "{spacing.control}"
  button-quiet-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  button-danger:
    textColor: "{colors.danger-text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "{spacing.control}"
  button-icon:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: "{spacing.control}"
  button-icon-pressed:
    textColor: "{colors.accent-text}"
  field:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "{spacing.control}"
  segmented-on:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.segment}"
    height: "28px"
  rail-button:
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.lg}"
    width: "{spacing.rail}"
  rail-button-active:
    textColor: "{colors.accent-text}"
  popover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  paper-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.sheet}"
---

# Design System: Edith

## Overview

**Creative North Star: "The Workbench"**

Edith is a dark graphite workbench. The PDF is a white sheet laid on a gridded cutting surface, with real tools lying around it: a snap-off cutter, a pencil, a binder clip, a steel ruler's edge, and a few pencil marks in chalk. The interface is the bench and the document is the work on it; the bench is quiet, hueless and dense, so the white page is always the brightest thing on screen.

One accent carries the whole system: the cutter's yellow. It fills the single main action of a surface, the logo tile and the cutter's body, marks what is selected or active, and is the colour of every focus ring. Everything else is a step of graphite. Depth is literal: sheets cast a short contact shadow and lift when picked up, floating panels are hairline-ringed with a deep soft shadow.

The type is one family, Archivo, used across its width axis: wide and heavy for headings printed on the bench, normal width for reading, condensed for small labels and tool captions. Geist Mono carries numbers and measures. Motion is physical and plays once: the sheet settles onto the bench, the tools slide into place, pencil marks draw themselves, and on upload the scissors run once round the sheet's cut line.

**Key Characteristics:**
- Graphite surfaces without hue; a higher surface is lighter.
- One accent, the cutter's yellow, with dark ink on its fills.
- White paper appears only as a document (or the blank sheet that receives one).
- A faint square cutting grid, in regions only, fading out towards the edges.
- Archivo across its width axis plus Geist Mono for figures.
- Edith's own icon set: 24 grid, 1.75 stroke, round ends, documents drawn as the folded-corner sheet.
- Drawn props and self-drawing pencil marks as the only decoration; all of it aria-hidden and pointer-transparent.

## Colors

A hueless graphite ramp with one warm yellow accent, a chalk white for drawn marks, and true white reserved for paper.

### Primary
- **Cutter Yellow** (accent): fills for the one primary action per surface (Pilih PDF, Unduh), the logo tile, the drawn cutter's body, list bullets on the start page, the cut line drawn during upload, and the 1.5px underline that sweeps under a tool name on hover. Text on it is always Bench Ink Dark (accent-ink).
- **Lit Yellow** (accent-hover): the hover state of yellow fills; lighter, so the dark ink keeps at least 9:1.
- **Yellow Text** (accent-text): yellow used as text, icon colour or outline on dark surfaces: active rail tools, pressed toggles, the selected swatch ring, and the global focus ring.
- **Bench Ink Dark** (accent-ink): text and icons placed on yellow.

### Neutral
- **Bench** (base): behind everything; the start page ground; tinted to 70% as the dialog backdrop.
- **Panel** (panel): top bar, tool rail, sidebars, the tool tray shelf, dialog footers.
- **Canvas** (canvas): the area the PDF pages sit on in the editor, under the cutting grid.
- **Raised** (raised): menus, popovers, dialogs, tooltips, the on-state of a segmented control.
- **Hover Film** (hover): a 7% white overlay that is the hover state on any surface; also the secondary button's resting fill.
- **Hairline** (line): dividers between panels and sections.
- **Control Edge** (line-strong): control borders, field strokes, the ring in floating-panel shadows, the scrollbar thumb.
- **Grid Line / Grid Line Strong** (grid, grid-strong): the cutting grid's fine 24px lines and every fifth line at 120px.
- **Ink** (ink): primary text. **Muted** (muted): secondary text and resting icons. **Faint** (faint): tertiary text, hints, page numbers, group labels; kept at least 4.5:1 on panel and raised.
- **Chalk** (chalk): pencil marks and drawn objects on the bench (ring, arrow, binder clip wire).
- **Paper** (paper) and **Paper Ink** (paper-ink): the PDF page and anything drawn as a sheet; always light, in either theme.

### Status
- **Danger** (danger) for destructive fills and tints; **Danger Text** (danger-text) for error messages and the danger button. **Warn** (warn) for cautions.

### Named Rules
**The One Yellow Rule.** The cutter's yellow is the only accent. Each surface has at most one yellow-filled action; everything else that is yellow is a mark of state (active, selected, focused) or a drawn prop.

**The Hueless Bench Rule.** Interface surfaces, lines and text sit at chroma 0.004 or below. Drawn props and the mascot may carry their own muted material colours (steel, pencil wood, eraser, hair, skin); the bench itself never does.

**The Paper Is Paper Rule.** True white is the document. Do not use it for cards, panels or buttons on the bench.

## Typography

**Display Font:** Archivo, width 112 (with ui-sans-serif, system-ui)
**Body Font:** Archivo, normal width
**Label/Mono Font:** Archivo width 78 for labels; Geist Mono (with ui-monospace) for numbers and measures

**Character:** One grotesque stretched three ways, like lettering stamped on tools: wide and heavy for the few headings, plain for reading, condensed where space is tight. The app type scale is small and dense (11, 12, 13 base, 15) because this is a tool, with display the only large size.

### Hierarchy
- **Display** (800, clamp(2.6rem, 6vw, 4.75rem), 0.95, wide): the start page headline only.
- **Headline** (700, 1.5rem, wide, tight tracking): section headings on the bench, such as the tool tray.
- **Title** (700, 1.125rem, wide, tight tracking): panel and drawer titles, the wordmark beside the logo, the sheet's drop prompt (semibold there).
- **Body Large** (400, 0.9375rem/1.5rem): start-page lists and tool names in the tray.
- **Body** (400, 0.8125rem/1.25rem): the app's base size: controls, menus, dialogs, editor UI. Buttons use 500.
- **Label** (600, 0.75rem, condensed, 0.14em, uppercase, faint): headings of a list or group (tool groups, recent edits). It names the list under it; it never sits above a larger headline.
- **Caption** (500, 0.6875rem/0.8125rem, condensed): the short name under each rail icon.
- **Mono** (Geist Mono, 0.6875rem): limits, sizes, page counts, colour values.

### Named Rules
**The Width Axis Rule.** Hierarchy comes from Archivo's width as much as its weight: wide for headings, normal for text, condensed for labels and captions. Do not add a second display family.

**The Figures In Mono Rule.** Numbers that are measures or limits (50 MB, page ranges, hex values) are set in Geist Mono.

## Layout

The start page is a centred container (72rem max) with 20px side gutters on phones and 40px from 768px. Above the fold it is two columns from 768px: text on the left, the A4 sheet (max 23rem; 17rem on phones so the primary action stays above the fold) on the right, with the drawn props overhanging the sheet's edges. Below it the tool tray is a full-width Panel shelf with a ruler edge on top, its groups laid in two columns from 640px and four uneven columns (1fr 1.25fr 1fr 0.8fr) from 1024px.

The editor fills the viewport: a 56px top bar, the tool rail (60px buttons) at the left of the canvas from 640px, and along the bottom of the screen on phones, within thumb reach, scrolling sideways with a fade at its end. The right sidebar appears from 1280px. Pages are centred on the gridded Canvas.

Controls are 32px tall (36-40px for the single main action). Spacing follows a 4px step: 2px inside segmented tracks, 6-8px between controls, 12px inside cards, 20px panel padding, 40px between tray groups.

**The Grid Under The Work Rule.** The cutting grid (24px squares, every fifth line stronger at 120px) appears only where work lies: behind the start-page hero, masked to fade towards the edges, and under the editor's pages. It never fills a whole screen edge to edge on the start page and never sits under text-heavy panels.

## Elevation & Depth

Depth is physical. On the dark bench, surfaces step lighter as they rise (Bench, Panel, Canvas, Raised), and anything floating adds a 1px Control Edge ring plus a deep soft shadow. Paper gets its own contact shadows: a sheet lying flat, and the same sheet lifted when a file is held over it or uploading.

### Shadow Vocabulary
- **Pop** (`0 0 0 1px var(--line-strong), 0 8px 24px oklch(0% 0 0 / 0.45)`): menus, popovers, tooltips, floating bars.
- **Modal** (`0 0 0 1px var(--line-strong), 0 24px 64px oklch(0% 0 0 / 0.6)`): dialogs and drawers.
- **Page** (`0 1px 2px oklch(0% 0 0 / 0.35), 0 4px 16px oklch(0% 0 0 / 0.25)`): PDF pages and thumbnails in the editor.
- **Sheet** (`0 1px 2px oklch(0% 0 0 / 0.4), 0 18px 40px -18px oklch(0% 0 0 / 0.65)`): the blank sheet resting on the bench.
- **Sheet Lifted** (`0 2px 4px oklch(0% 0 0 / 0.3), 0 34px 60px -20px oklch(0% 0 0 / 0.7)`): the same sheet raised 6px on drag-over and upload.

### Named Rules
**The Ring Plus Shadow Rule.** A floating surface on dark is drawn with a hairline ring and a soft shadow together; never a shadow alone, never a hard offset shadow.

## Shapes

Small, practical corners. Paper is nearly square (2px). Controls are gently rounded (6px); floating panels, rail buttons and choice cards a step more (8px); dialogs 12px; a phone's bottom drawer 16px on its top edge only, and square when it docks to the right edge. Dots and swatches are full circles. The logo is a yellow tile with 25% corners.

The recurring silhouette is the sheet with its top-right corner folded: every document icon, and the dashed cut line inset 16px inside the blank sheet with the scissors at its start.

## Components

### Buttons
Tactile and plain: flat fills, colour-only hover, no lift.
- **Shape:** gently rounded (6px), 32px tall, 12px horizontal padding, 500 weight at body size, icon gap 6px.
- **Primary:** Cutter Yellow fill with Bench Ink Dark text; Lit Yellow on hover. One per surface. The main action of a page grows to 36-40px tall with 16-20px padding.
- **Secondary:** Hover Film fill with an inset Control Edge ring; Hairline fill on hover.
- **Quiet:** no fill, Muted text at 400; Hover Film fill and Ink text on hover.
- **Danger:** no fill, Danger Text at 400; a 15% Danger tint on hover.
- **Icon:** 32px square, Muted icon; pressed shows a 20% yellow tint with Yellow Text icon.
- **Disabled:** 45% opacity, no pointer events.
- **Focus:** one global focus ring everywhere: 2px solid Yellow Text, 1px offset, shown instantly.

### Segmented Control
- **Track:** Bench at 60% with an inset Hairline ring, 2px padding, 6px corners.
- **Segment:** 28px tall, 12px padding, label weight 500 at 0.75rem; the on segment is Raised with a 1px Control Edge ring and Ink text; off segments are Muted, Ink on hover.

### Choice Cards
- **Style:** 8px corners, an inset Control Edge ring, 12-14px padding, an Edith icon over a name and a Faint hint.
- **State:** selected gets a 2px yellow ring and a 12% yellow tint with a Yellow Text icon; unselected lifts 1px and takes Hover Film on hover.

### Inputs / Fields
- **Style:** 32px tall, 6px corners, 1px Control Edge stroke, Bench at 60% fill, 8px padding, Faint placeholder.
- **Focus:** the stroke turns yellow with a 1px yellow ring (no outline on top).
- **Native controls:** checkboxes, radios and ranges take the accent colour; select options sit on Raised.

### Menus and Popovers
- **Surface:** Raised, 8px corners, Pop shadow, body size.
- **Item:** 32px tall, 6px corners, 8px padding, 10px icon gap; Hover Film on hover and on keyboard focus, with the focus ring drawn inside the item.

### Navigation: Tool Rail
- **Style:** a Panel strip; each tool is a 60px-wide button, its 20px icon (stroke 1.6) over a condensed caption, 8px corners.
- **States:** Muted at rest, Hover Film and Ink on hover; the active tool takes a 15% yellow tint with Yellow Text. Groups are split by a short Hairline rule.
- **Mobile:** below 640px the rail becomes a bottom bar that scrolls sideways and fades out at its right end.

### Navigation: Top Bar
- **Style:** 56px Panel bar with a Hairline bottom border: logo tile (home), the file name as a borderless field that shows its edge on hover, quiet icon buttons, and the yellow Download split button at the end (the options half divided by a 20% ink rule).

### Tool Tray
- **Style:** on a Panel shelf under a ruler edge (ticks every 12px, longer every 120px). Tools are grouped under condensed Labels; each tool is a row of Muted 20px icon and Body Large name.
- **Hover:** Hover Film behind the row, the icon turns Yellow Text and rises 1px, and a 1.5px yellow underline sweeps in under the name (300ms).

### Signature: The Sheet
The blank A4 sheet (aspect 210/297) is where a PDF is dropped. Paper fill, 2px corners, Sheet shadow, clipped to the bench by a drawn binder clip, with a dashed cut line (6/5) inset 16px and the scissors at its start. While a file is held over it the sheet lifts and the dashes march; while uploading, the scissors run once round the line as it is drawn solid in yellow. Controls on it use the standard recipes with Paper Ink text.

### Signature: Drawn Props and Pencil Marks
Flat SVG drawings of a cutter (yellow body, steel blade), a pencil and a binder clip lie around the work, sliding into place once on load. Pencil marks (a loose ring around a word, a curved arrow) are 1.6px Chalk strokes with round ends that draw themselves once, one after another. All are aria-hidden and never take the pointer.

### Icons
Edith's own set: 24px grid, 1.75 stroke, round caps and joins, currentColor. Every document is the same 12 by 18 sheet with a 4-unit folded corner. UI icons render at 16px (14px small); rail icons at 20px; feature icons at 20-38px with lighter strokes (1.4-1.5) as they grow.

### Motion
Arrivals use the expo ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`): the sheet settles from a slight lift and tilt (0.9s), props slide in (1.1s), marks draw (0.9s), drawers slide from the right or up from the bottom on phones (0.38s) over a fading backdrop (0.25s). Hover transitions are colour-only at 150-300ms. Everything collapses to instant under reduced motion, with pencil marks shown fully drawn.

## Do's and Don'ts

### Do:
- **Do** keep every interface surface on the graphite ramp; step lighter to rise (Bench, Panel, Canvas, Raised).
- **Do** use the cutter's yellow for one filled action per surface, with dark ink on it, and as the colour of active, selected and focused state.
- **Do** draw new icons in Edith's set: 24 grid, 1.75 stroke, round ends, documents as the folded-corner sheet.
- **Do** set headings in wide Archivo, labels and captions in condensed Archivo, and figures in Geist Mono.
- **Do** give floating surfaces the Pop or Modal shadow (hairline ring plus soft shadow).
- **Do** keep decoration drawn, flat, aria-hidden and pointer-transparent, and let it animate once.
- **Do** keep secondary text at Faint or lighter so it holds 4.5:1 on Panel and Raised.

### Don't:
- **Don't** add a second accent colour or tint the graphite surfaces with hue.
- **Don't** use white for anything but paper.
- **Don't** fill a whole screen with the cutting grid; keep it under the work and let it fade.
- **Don't** use hard offset shadows or shadow-only floating panels.
- **Don't** place an uppercase label above a headline as a kicker; labels head lists and groups only.
- **Don't** loop decorative motion; only the drop target's marching cut line runs, and only while a file is held over it.
- **Don't** put the PDF page on anything but white paper; the editor draws on it.
