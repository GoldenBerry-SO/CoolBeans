# Cool Beans — Design system (v2)

The look and feel of the Cool Beans Console (admin dashboard) and customer portal. Derived from the
approved design in [`design/cool-beans-console.dc.html`](design/cool-beans-console.dc.html) (source
project: "CoolBeans app launch" on Claude Design). The web app implements these tokens in
`apps/web/src/index.css` as Tailwind 4 theme variables — change them there, document them here.

## Feel

Clean, white, and calm — a tool you leave open all day. One loud color (the lime accent) used
sparingly for the primary action; everything else is quiet warm neutrals on white. License keys,
ids, and numbers are always monospace. Flat bordered cards, hairline dividers, almost no shadows.
It should read like a well-organized workbench, not a SaaS marketing page.

## Color

Everything hangs off a warm near-black ink (#1a1a19) on a white canvas. Borders are the ink at low
alpha, never grey hexes. The old papery `#f6f5f1` survives only as the search-pill fill.

| Token | Value | Use |
|---|---|---|
| `card` | `#ffffff` | App background, sidebar, header, cards |
| `canvas` | `#f6f5f1` | Header search pill fill (unfocused) |
| `fill-soft` | `#faf9f5` | Mini stat tiles, key wells, dialog inputs + footer band |
| `fill` | `#f4f2ec` | Avatars, chips, code badges |
| `track` | `#eceae3` | Progress tracks, segmented-control background |
| `ink` | `#1a1a19` | Primary text, dark buttons |
| `ink-heading` | `#2a2a26` | Login title |
| `ink-body` | `#3a3a36` | Nav items, form labels |
| `ink-secondary` | `#4a4a44` | Table body text, yearly tier |
| `ink-muted` | `#6e6e68` | Table headers, secondary copy |
| `ink-soft` | `#7a7a72` | Page-heading subtitles |
| `ink-label` | `#8a8a82` | Sidebar section labels |
| `ink-faint` | `#9a9a92` | Metadata, placeholders, timestamps |
| `ink-ghost` | `#b8b8af` | Quietest footnotes |
| `accent` | `#c8ff4d` | THE lime. Primary buttons, logo tile. Ink text on top, never white |
| `accent-hover` / `-border` | `#bcf53f` / `#b4ee38` | Accent hover / border |
| `positive` | `#4d6b16` (deep `#3d6b16`, nav `#3f6b12`) | Links, success, live dots, active nav text |
| `positive-tint` / `-border` | `#eef7d3` / `#d4e9a6` | Active status pill, connected chip |
| `danger` | `#b42318` (hover cue `#e0533f`) | Disabled status, destructive hover, delete button |
| `danger-tint` / `-border` | `#fdecea` / `#f5cdc6` | Disabled status pill, over-limit badge |
| `warn` | `#b8860b` | Trial tier, retrying, near-limit, Mixed status |
| `warn-tint` / `-border` | `#fdf3e0` / `#f0dcae` | Warning badges |
| `tier-lifetime` | `#6b5bd6` | Lifetime tier text |
| `stripe` | `#635bff` | Stripe-branded connect buttons and provider pill |
| `meter-ok` / `meter-near` | `#8fbf3f` / `#e8a33a` | Usage bar fills (danger cue `#e0533f` when over) |

Borders: `rgba(26,26,25,0.05)` row dividers → `0.08–0.11` card/input borders → `0.14` interactive
borders → `0.24–0.30` hover. Product identity dots are per-product colors (Clementine `#e8863a`,
Hexis `#7b6cf0`, …), 7px squares with 2px radius.

## Type

- **Sans**: Instrument Sans (400–700, italics available; IBM Plex Sans fallback) — UI text.
  Base 14px, line-height 1.5.
- **Mono**: IBM Plex Mono (400/500/600) — every license key, id, email-in-tables, count, timestamp,
  kbd hint, and code-ish string. If it could appear in a terminal, it's mono.
- Scale: 28px page titles (700, -0.02em) · 27px stat values (600, -0.02em) · 24px login title (600,
  -0.015em) · 22px detail-page key · 21px login step-two title · 17px dialog titles (600) · 15px
  wordmark/product names · 14px body/nav · 13–12.5px table cells · 12px table headers (500,
  sentence case) · 11.5px badges · 10.5px tile sublabels.
- Headings use small negative tracking (-0.01 to -0.02em). Nothing above 28px anywhere.
- No uppercase tracked labels anymore — section labels and table headers are sentence case.

## Shape, depth, space

- Radii: 7px small controls/pills → 8px nav items → 9–10px buttons/inputs/cards → 11px dropdowns →
  14px login card → 16px dialogs/portal cards → 20px chip tags → full pills and the search bar.
- Shadows are rare: cards have none (border only). Login card
  `0 15px 35px rgba(56,60,50,0.09), 0 5px 15px rgba(0,0,0,0.06)`; dialogs
  `0 24px 70px rgba(0,0,0,0.3)`; dropdown `0 12px 34px rgba(26,26,25,0.16)`; portal hero
  `0 4px 24px rgba(26,26,25,0.06)`; toast `0 8px 30px rgba(0,0,0,0.22)`.
- Layout: 248px sidebar (white, hairline right border) · 64px header (white, borderless) · main
  padding 30px 40px 48px · page heading block (28px title + 14px `ink-soft` sub) then 26px gap ·
  16px gaps between cards · tables pad 11–13px vertical, 18–20px horizontal.

## Chrome

- **Sidebar**: logo row (31px lime tile + 15px wordmark) → product scope switcher (bordered button
  with a 7px identity dot and a ▾, opening a shadowed dropdown with a green check on the active
  row) → "Manage" section label → icon nav (17px 1.7-stroke line icons, 14px/500 `ink-body`
  labels; active state is green text `positive-nav`, no background; hover `ink/5`) → bottom:
  Customer portal link + account row (29px tinted avatar, name, "admin · magic code" or
  "admin · global token", icon sign-out).
- **Header**: pill search (`canvas` fill, transparent border; focus turns the border
  `positive`/45 and the fill white; ⌘K kbd) · round ? and bell buttons · the one accent button
  ("Issue key", with a plus icon).

## Components

- **Primary button**: accent background, ink text, 600 weight, accent-border, 9px radius. One per
  screen. Dark ink variant for secondary-primary actions ("New product", portal download, login
  step two).
- **Secondary button**: white, `0.14` border, 500 weight; hover darkens the border, not the fill.
- **Destructive**: quiet secondary whose border/text turn danger on hover; the delete-product
  confirm is the one filled red button in the system.
- **Stripe button**: `stripe` purple fill, white 600 text — only for Connect Stripe.
- **Status pill**: 20px radius, 3×10px pad, 11.5px/600; active = positive set, disabled = danger
  set, customer "Mixed" = warn set.
- **Tier**: plain 12.5px/500 colored text — yearly `ink-secondary`, lifetime `tier-lifetime`,
  trial `warn`. No pill.
- **Segmented filter**: 4px-padded `track` container, 10px radius; active segment is a white pill
  with a soft shadow.
- **Tables**: sentence-case 12px/500 `ink-muted` headers, `0.05`-alpha row dividers, rows hover at
  `0.025` ink. Empty states are a centered 13px `ink-faint` sentence with a little warmth.
- **Stats**: borderless columns separated by hairline right dividers — label 12px muted → 27px
  value → 11.5px mono delta.
- **Product cards**: colored 38px icon tile, mono slug, `PREFIX-••••` badge, three `fill-soft`
  mini stat tiles (keys / active / seats-per-key), bordered chip tags, footer with Edit +
  Connect Stripe (green tinted chip once connected).
- **Usage meters**: 7–8px track bars; fill `meter-ok` → `meter-near` past ~85% → danger cue over,
  with a matching tinted badge.
- **Toast**: ink background, white 13px text, bottom-center, 10px radius.
- **Dialogs**: 480px, 16px radius, `0 24px 70px rgba(0,0,0,0.3)` over a `rgba(26,26,25,0.4)`
  scrim. Header pad 20/24; 17px/600 title with a 12.5px `ink-faint` lede; body fields have
  13px/500 `ink-body` sentence-case labels and `fill-soft` inputs (9px radius, `0.14` border,
  focus `positive`); footer is a right-aligned `fill-soft` band with a hairline top border.
  Results that produce a key show it in a mono `fill-soft` well with a copy button.
- **Logo**: lime rounded square with two small ink beans (each an ellipse rotated -28° with a lime
  slash), stacked diagonally.

## Auth screens (sign in / create account)

Full-screen white with a lime gradient wash rising from the bottom (32vh, fading to
`rgba(163,224,60,0.22)`); logo + wordmark pinned top-left. One 440px card (14px radius, `0.07`
border, 40px padding, the login shadow):

- **Step one**: 24px/600 `ink-heading` "Sign in to Cool Beans" · 13.5px `ink-muted` lede (magic
  code, password-free, first sign-in creates the account) · sentence-case 12.5px/500 label ·
  white input (`0.18` border, 9px radius, focus ring `rgba(77,107,22,0.15)`) · full-width accent
  button · "SELF-HOSTING?" hairline divider · quiet mono `ADMIN_TOKEN` note that expands into a
  token input + dark button for self-hosters.
- **Step two**: 48px `positive-tint` envelope tile · 21px/600 "Check your inbox" · lede naming
  the email and the 10-minute expiry · six-digit code input (mono 24px, 8px tracking, centered,
  `fill-soft`, `one-time-code` autocomplete) · full-width dark ink button · "Resend code"
  (positive) / "Use a different email" (faint) links.
- Under the card: "New to Cool Beans? Self-host it free · Docs" and an `ink-ghost` trust note.

## Motion

One entrance: fade-up 8px, 0.3–0.35s ease (`cbin`), on page swap. Toasts slide up 0.25s. Hovers are
instant color/border shifts. Nothing else moves; no spinners in the design — prefer skeletons or
instant data.

## Voice

Plain, warm, a little proud. "Cool beans — you're all set." · "No password. No account. The key is
the credential." · "Deactivating frees a seat instantly — no support ticket needed." Microcopy
explains the contract in one breath; never scolds, never yells.

## Do / don't

- Do keep the accent rare — if two lime things are visible at once, one of them is wrong.
- Do put every key, id, and count in mono; it's the product's signature.
- Don't introduce pure greys, pure black, or cool blues — every neutral is warm. (Stripe purple is
  the one branded exception.)
- Don't add shadows to cards — depth belongs to overlays (dialogs, dropdowns, toasts) only.
- Don't uppercase labels; sentence case everywhere.
- Don't animate layout; only opacity/translate on enter.
