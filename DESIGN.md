# Squeek Dome design system

## Overview

Squeek Dome is a compact workbench for Sepolia Keepers and NFT holders. Warm off-white surfaces, dark green-gray text, and a burnt-orange action color give live contract data a quiet, legible setting. The main visual idea is a three-step work surface: maintain the round, collect credit, then carefully merge positions. This direction was inferred for the assignment rather than supplied as an existing brand system.

The page puts the product and checkpoint action on the first phone screen. One header owns connection and holder loading; all panels share the same state. Flat sections, shared alignment edges, and restrained numbered headings organize the data. Never substitute illustrative balances, generated token art, or simulated success for chain data.

## Colors

Canonical values live in the `:root` block of `src/styles.css`. Components consume semantic CSS properties. There is one light theme.

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f4ef` | Page background |
| `--surface` | `#fffefa` | Main panels, header, inputs, dialogs |
| `--surface-soft` | `#f1f1e9` | Chain summary, neutral status, empty image backgrounds |
| `--surface-selected` | `#faf0e7` | Selected token rows |
| `--text` | `#282d26` | Main text and dark buttons |
| `--text-secondary` | `#62665c` | Labels, captions, secondary copy |
| `--line` | `#dddfd4` | Panel structure and data separators |
| `--line-strong` | `#7f8774` | Input and neutral-control boundaries |
| `--accent` / `--accent-hover` | `#c34423` / `#a93418` | Primary actions and hover |
| `--accent-soft` | `#f9e9df` | Text selection |
| `--on-accent` / `--on-dark` | `#ffffff` / `#fffefa` | Filled-button text |
| `--success` / `--success-soft` | `#3b6247` / `#eaf1e8` | Verified readiness and success with explicit text/icons |
| `--danger` / `--danger-soft` | `#9f3027` / `#fceee8` | Error, permanent burn, unsettled warning |
| `--focus` | `#214dc1` | 3px keyboard focus outline, 3px offset |

Measured production pairs include orange/white at 5.03:1, secondary text/main surface at 5.82:1, secondary text/soft surface at 5.18:1, and danger text/main surface at 7.11:1. The enabled select boundary measures 3.70:1 against the main surface. These measurements apply to the identified solid pairs, not to every state or the artwork. Inactive controls use 50% opacity and remain accompanied by explanatory copy. Forced-colors mode uses the system `Highlight` focus color.

## Typography

The local variable face is `DM Sans Variable`, with `DM Sans`, Arial, and generic sans-serif fallbacks. `src/styles.css` defines its normal-style 100–1000 weight range; the implementation uses **400 and 600**. The file is `public/fonts/dm-sans-latin.woff2`, loaded with `font-display: swap`. It was observed loaded in the final production preview. Transaction hashes alone use a system monospace stack.

| Token | Size | Use |
| --- | --- | --- |
| `--text-xs` | 12px / .75rem | Captions, column headings, status labels, small metadata |
| `--text-sm` | 14px / .875rem | Buttons, labels, table cells, helper copy |
| `--text-base` | 16px / 1rem | Body, form inputs/selects, key token text |
| `--text-lg` | 20px / 1.25rem | Small headings; mobile panel titles |
| `--text-xl` | 28px / 1.75rem | Desktop panel titles; mobile page title and round numbers |
| `--text-display` | 44px / 2.75rem | Desktop page title and primary round numbers |

Body line height is 1.5; page title 1.1; desktop panel titles 1.2; longer small headings 1.4. Display tracking is −.045em, heading tracking −.03em, and small headings −.02em. Phone page-title tracking is −.035em. Headings balance their lines; short descriptions use pretty wrapping. Dynamic numbers use tabular figures. Full addresses, hashes, IDs, and exact SQK values wrap instead of being clipped. Inputs/selects explicitly remain 16px, including inside smaller labels, to prevent iOS input zoom.

## Layout

The outer `.topbar-inner` and `.workbench` share a 1264px maximum width with 32px desktop inline padding, producing a 1200px content area. Most spaces follow 4px steps: 8/12px within controls, 16/20px within groups, 24/32px between larger groups, and 40px around the main workbench. Panel padding is 32px on large screens, 24px at intermediate widths, and 20px on phones (16px at 320px).

Keeper’s main actions and summary use a `1.85fr / 1fr` grid, with a 280px minimum summary. The claim table is six columns. Merge cards remain side by side, align at their top edges, and have an independently centered arrow. Arena cards do not have nested card backgrounds. Their images are 160px square on wide screens; token table thumbnails are 48px square.

The active media queries in `src/styles.css` are:

- **68rem / 1088px:** reduce panel padding, adjust Keeper proportions, and place each arena image above its data.
- **48rem / 768px:** stack Keeper’s summary beneath its actions, hide panel navigation links, turn table rows into labeled two-column records, reduce title sizes, and use a 32px merge gutter.
- **36rem / 576px:** wrap the header and holder toolbar, keep the loader form in document flow, stack primary action groups, use a 20px merge gutter, and make the testnet notice one wrapping line.
- **21rem / 336px:** move wallet utilities to their own row and reduce panel padding and batch-total size.

The holder loader is a native disclosure. On desktop its form is an elevated 560px popover, capped to the viewport; on phones it expands inside the header. The sample-holder button stays exposed while the form is closed. No panel requires horizontal scrolling to read data or press a button. Rendered reflow was checked at 320, 375, 390, 768, and 1440px; browser-native 200% zoom and physical devices were not checked.

## Elevation & Depth

Panels use a 1px structural border with no shadow. The muted chain summary and selected rows establish hierarchy through tone. Only overlays rise: the desktop holder form uses `0 10px 50px #282d2629`; the modal uses `0 24px 100px #00000033` with a `#1d261fb3` backdrop. Dialogs use the native top layer, and the holder form uses `z-index: 5`. There is no sticky bar over the content.

## Shapes

`--radius-control` is 8px; `--radius-panel` is 16px. Thumbnails use 8px; large token images and burn notices use 12px. Dialogs use 20px on desktop, 16px on phones. Number markers are circles, and status chips use 20px rounding. NFT images have a 1px pure-black 10% outline inset by 1px. The dome mark in `public/favicon.svg` is repeated by the inline `Logo` pattern in `src/App.tsx`.

## Components

Patterns and private components are in `src/App.tsx`; they are not a separate component library.

- **Buttons:** `.button` is a 44px-minimum neutral action; `.primary`, `.dark`, `.danger`, and `.small` provide implemented variants. `.icon-button` is 44px square. Hover is enabled only for hover-capable pointers. Disabled states use native `disabled`, and focus has a visible 3px ring. Under no motion preference, background and press transitions last 150ms with `cubic-bezier(.2,0,0,1)`; press scale is .96. Reduced-motion users receive no transitions or scaling.
- **Shared holder loader:** `.holder-loader`, `.loader-form`, and labeled fields. Loading explains that live data is being checked. Errors sit in the shared status region. The loaded holder’s full address appears above the table. Duplicate/unowned IDs receive explicit notices.
- **Data panels:** `.panel`, `.section-heading`, `.section-title`, `.step-number`. Keep heading hierarchy semantic: one h1, three h2 sections, and contextual h3s. Status always includes words in addition to color.
- **`TokenImage`:** accepts a verified `Squeek` and optional `large`. An isolated `<img>` renders the decoded SVG; failures show “Image unavailable.” It never injects SVG markup into the document.
- **`Amount`:** receives SQK base units and an `exact` flag. Tables and claim/merge summaries expose full precision; compact global totals offer full values via a title. Values come from `claimable`, never `accruedScaled`.
- **Token records:** `.token-table` preserves a semantic table, with checkbox selection and a lowest-ID fraction note. Mobile cells repeat their column labels. Selection and the batch total stay in one shared state.
- **`ArenaCard`:** receives the visible token and explicit survivor/donor role. Swap exchanges the displayed data and images together. The next-level target weight is read from Mining, never guessed.
- **`Modal`:** native `<dialog>`, using `showModal` for background inertness, explicit Tab wrapping, focus recovery after controls become disabled, Escape/backdrop close when idle, and trigger-focus restoration. The burn checkbox, explicit simulation, and direct ownership gate the destructive send. Dialog content scrolls within the viewport when needed.
- **`Feedback`:** stable polite status region with busy, OK, error, and pending states. Transaction hashes remain complete and link to Etherscan. Pending receipt reads offer a retry action; success requires a real successful receipt.

## Do’s and Don’ts

- Start additional workbench content with `.panel` and the existing semantic heading pattern. Reuse the six-size scale and the current spacing steps.
- Give each task its primary action treatment; use neutral buttons for simulation peers and supporting actions. Reserve danger styling for the irreversible burn and failures.
- Keep wallet connection in the single header and chain/holder state shared. Any future transaction must re-verify against the same RPC and direct-owner rules.
- Keep transaction identity, full precision, and destructive consequences visible. Do not replace exact values with clipped text, arbitrary rounded transaction inputs, or invented data.
- Do not add competing gradients, decorative NFT art, extra fonts, a dark theme, or new wallet providers without a separately scoped requirement.

For another page in this product, import the same stylesheet and font, reuse the header/section/action patterns from `src/App.tsx`, keep the same content width and breakpoints, and add an explicit accessible loading/empty/error path. A static route would need its own exported HTML or hash navigation.

Design/reference attribution and retained licenses are linked in `README.md`. Review coverage and limitations are in `artifacts/validation.md`.
