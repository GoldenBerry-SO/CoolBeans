# Cool Beans — Design system

The look and feel of the Cool Beans Console (admin dashboard) and customer portal. Derived from the
approved design in [`design/cool-beans-console.dc.html`](design/cool-beans-console.dc.html) (source
project: "CoolBeans app launch" on Claude Design). The web app implements these tokens in
`apps/web/src/index.css` as Tailwind 4 theme variables — change them there, document them here.

## Feel

Warm, papery, and calm — a tool you leave open all day. One loud color (the lime accent) used
sparingly for the primary action; everything else is quiet warm greys. License keys, ids, and
numbers are always monospace. Roomy cards on a soft canvas, hairline borders, tiny shadows. It
should read like a well-organized workbench, not a SaaS marketing page.

## Color

Everything hangs off a warm near-black ink (#1a1a19) and a warm off-white canvas. Borders are the
ink at low alpha, never grey hexes.

| Token | Value | Use |
|---|---|---|
| `canvas` | `#f6f5f1` | App background |
| `surface` | `#fbfaf7` | Sidebar, header |
| `card` | `#ffffff` | Cards, tables, inputs |
| `fill-soft` | `#faf9f5` | Nested stat tiles, key wells |
| `fill` | `#f4f2ec` | Avatars, chips, code badges |
| `track` | `#eceae3` | Progress tracks, segmented-control background |
| `ink` | `#1a1a19` | Primary text, dark buttons |
| `ink-secondary` | `#4a4a44` | Table body text |
| `ink-muted` | `#6e6e68` | Labels, secondary copy |
| `ink-faint` | `#9a9a92` | Metadata, placeholders, timestamps |
| `accent` | `#c8ff4d` | THE lime. Primary buttons, logo tile. Ink text on top, never white |
| `accent-hover` | `#bcf53f` | Accent hover |
| `accent-border` | `#b4ee38` | Border on accent buttons |
| `positive` | `#4d6b16` (deep `#3d6b16`) | Links, success, live dots, up-deltas |
| `positive-tint` / `-border` | `#eef7d3` / `#d4e9a6` | Active status pill |
| `danger` | `#b42318` (hover cue `#e0533f`) | Disabled status, destructive hover |
| `danger-tint` / `-border` | `#fdecea` / `#f5cdc6` | Disabled status pill, over-limit badge |
| `warn` | `#b8860b` | Trial tier, retrying, near-limit |
| `warn-tint` / `-border` | `#fdf3e0` / `#f0dcae` | Warning badges |
| `tier-lifetime` | `#6b5bd6` | Lifetime tier text |

Borders: `rgba(26,26,25,0.05)` row dividers → `0.08–0.11` card/input borders → `0.14` interactive
borders → `0.24–0.30` hover. Product identity dots are per-product colors (Clementine `#e8863a`,
etc.), 7px squares with 2px radius.

## Type

- **Sans**: IBM Plex Sans (400/500/600/700) — UI text. Base 14px, line-height 1.5.
- **Mono**: IBM Plex Mono (400/500/600) — every license key, id, email-in-tables, count, timestamp,
  kbd hint, and code-ish string. If it could appear in a terminal, it's mono.
- Scale: 27px stat values (600, tight -0.02em) · 22px detail-page key · 16px page title (600) ·
  14–13px body · 12.5px table cells · 11.5px badges · 10.5px uppercase table headers (600,
  0.05em tracking) · 10px uppercase section labels (600, 0.09em tracking, `ink-faint`).
- Headings use small negative tracking (-0.01 to -0.02em). No font sizes above 27px anywhere.

## Shape, depth, space

- Radii: 7px small controls/pills → 9–10px buttons/inputs/nav items → 13px cards → 16px portal
  cards → 20px (full) status pills and chip tags.
- Shadows are whispers: cards `0 1px 2px rgba(26,26,25,0.04)`; portal hero card
  `0 4px 24px rgba(26,26,25,0.06)`; toast `0 8px 30px rgba(0,0,0,0.22)`. Nothing else floats.
- Layout: 248px sidebar · 61px header · 28px main padding · content max-width 1180px (1020px on
  detail pages) · 16px gaps between cards · tables pad 11–13px vertical, 18–20px horizontal.

## Components

- **Primary button**: accent background, ink text, 600 weight, accent-border, 9px radius. One per
  screen ("Issue key"). Dark variant (`ink` bg, white text) only in the portal.
- **Secondary button**: white, `0.14` border, 500 weight; hover darkens the border, not the fill.
- **Destructive**: never filled — a quiet secondary button whose border/text turn danger on hover.
- **Status pill**: 20px radius, 3×10px pad, 11.5px/600; active = positive tint/border/deep text,
  disabled = danger set. Status is binary, like the license contract.
- **Tier**: plain 12.5px/500 text, colored — yearly `ink-secondary`, lifetime `tier-lifetime`,
  trial `warn`. No pill.
- **Segmented filter**: 4px-padded `track` container, 10px radius; the active segment is a white
  pill with a soft shadow.
- **Tables**: uppercase 10.5px headers, `0.05`-alpha row dividers, rows hover at `0.025` ink,
  whole row clickable to detail. Empty states are a centered 13px `ink-faint` sentence with a
  little warmth ("No live activations — every seat is free.").
- **Stat cards**: label 12px muted → 27px value → 12px delta (positive green / neutral faint).
- **Usage meters**: 7–8px track bars; fill turns warn near the limit and danger over it, with a
  matching tinted badge (OK / % / "Over limit").
- **Toast**: ink background, white 13px text, bottom-center, 10px radius.
- **Dialogs** (not in the source design — derived from its portal card language): centered card,
  16px radius, `card` background, `0 4px 24px rgba(26,26,25,0.06)` shadow over a
  `rgba(26,26,25,0.35)` scrim; 28–30px padding; 20px/600 title with a 13.5px `ink-muted` lede;
  form labels are 11px/600 uppercase `ink-muted`; inputs are `fill-soft` with `0.14` borders that
  focus to `positive`; footer is a right-aligned secondary + one accent (or ink) primary. Results
  that produce a key show it in a mono `fill-soft` well with a copy button. Enter animation is the
  standard `cbin` fade-up.
- **Logo**: lime rounded square with an ink bean (ellipse rotated -38° with a lime slash).

## Motion

One entrance: fade-up 8px, 0.3–0.35s ease (`cbin`), on page swap. Toasts slide up 0.25s. Hovers are
instant color/border shifts. Nothing else moves; no spinners in the design — prefer skeletons or
instant data.

## Voice

Plain, warm, a little proud. "Cool beans — you're all set." · "No password. No account. The key is
the credential." · "Deactivating frees a seat instantly — no support ticket needed." Microcopy
explains the contract in one breath; never scolds, never yells. Uppercase is for labels, not for
tone.

## Do / don't

- Do keep the accent rare — if two lime things are visible at once, one of them is wrong.
- Do put every key, id, and count in mono; it's the product's signature.
- Don't introduce pure greys, pure black, or cool blues — every neutral is warm.
- Don't use filled red buttons, badges with icons, or more than one shadow level per surface.
- Don't animate layout; only opacity/translate on enter.
