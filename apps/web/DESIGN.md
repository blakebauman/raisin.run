---
name: Raisin
description: A technical SEO crawler in the cloud, with calm neutral surfaces for long triage sessions.
colors:
  raisin-skin: "oklch(0.45 0.14 320)"
  raisin-skin-foreground: "oklch(0.985 0 0)"
  raisin-ring: "oklch(0.55 0.14 320)"
  raisin-wash: "oklch(0.955 0.012 320)"
  raisin-wash-foreground: "oklch(0.3 0.08 320)"
  logo-raisin: "#5b2a5e"
  workbench-paper: "oklch(0.985 0.002 286)"
  card-white: "oklch(1 0 0)"
  graphite-ink: "oklch(0.141 0.005 285.823)"
  zinc-muted: "oklch(0.967 0.001 286.375)"
  zinc-muted-foreground: "oklch(0.5 0.016 285.938)"
  hairline: "oklch(0.92 0.004 286.32)"
  input-stroke: "oklch(0.88 0.006 286.286)"
  row-hover: "color-mix(in oklch, oklch(0.967 0.001 286.375) 60%, oklch(0.985 0.002 286))"
  destructive: "oklch(0.577 0.245 27.325)"
  severity-issue: "oklch(0.58 0.21 25)"
  severity-warning: "oklch(0.7 0.15 65)"
  severity-opportunity: "oklch(0.58 0.13 240)"
  status-ok: "oklch(0.52 0.13 155)"
  status-redirect: "oklch(0.52 0.12 240)"
  status-client: "oklch(0.58 0.14 60)"
  status-server: "oklch(0.55 0.2 25)"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  stat:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    fontFeature: "tnum"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  data-mono:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.raisin-skin}"
    textColor: "{colors.raisin-skin-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.workbench-paper}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.raisin-wash}"
    textColor: "{colors.raisin-wash-foreground}"
  button-ghost:
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.raisin-wash}"
    textColor: "{colors.raisin-wash-foreground}"
  input:
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
  nav-item:
    textColor: "{colors.zinc-muted-foreground}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  nav-item-active:
    backgroundColor: "{colors.raisin-wash}"
    textColor: "{colors.raisin-wash-foreground}"
  status-pill:
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  grid-cell:
    typography: "{typography.body}"
    padding: "6px 12px"
---

# Design System: Raisin

## Overview

**Creative North Star: "The Quiet Workbench"**

Raisin is where an agency spends long, repetitive sessions working through crawl after crawl for client after client. The interface acts like a well-kept workbench: neutral zinc surfaces, hairline rules and plain type that stay out of the way. The work on it is the URL grid, the issue counts and the status codes, and that is what the eye should land on. Nothing in the chrome competes with the data.

One thin raisin-purple thread runs through the system. It marks where you are (the active tab, the selected row, the current nav item) and the one thing to do next (the primary button). Every other use of color carries a reading: an HTTP status class or an audit severity. The UI is dense, built for desktop working sessions, and comes in light and dark versions that follow the operating system.

Components are **quiet until touched**. At rest they are neutral and outlined. Purple washes and the focus ring appear only on hover, focus or selection.

**Key Characteristics:**
- Neutral zinc surfaces with a single purple accent (hue 320) that means "here" or "act"
- Color is reserved for meaning: HTTP status classes and the three audit severities
- Flat, hairline-bordered panels. Depth comes from tone, not shadow.
- Compact controls (32–36px high), 14px body text, tabular figures everywhere numbers line up
- Monospace for anything the crawler records verbatim (URLs, status codes, user agents)
- Light and dark themes follow `prefers-color-scheme`; there is no manual toggle

## Colors

A cool zinc neutral field with one dried-grape purple, plus two small semantic palettes (status classes and severities) that only appear where a value needs reading.

### Primary
- **Raisin Skin** (`raisin-skin`): the primary button fill, the underline on the active tab, the link color and text selection. In dark mode it lightens to oklch(0.72 0.12 320) with dark text on top.
- **Raisin Ring** (`raisin-ring`): the 3px focus ring on every interactive element.
- **Raisin Wash** (`raisin-wash` / `raisin-wash-foreground`): a pale purple tint used for hover and selected states. It fills the active nav item, the selected grid row, the bar-list fills on the overview and the "running" status pill.
- **Logo Raisin** (`logo-raisin`, #5b2a5e): the rounded-square mark behind the white "R" in `favicon.svg`. Use it only for the brand mark.

### Neutral
- **Workbench Paper** (`workbench-paper`): the page background behind everything.
- **Card White** (`card-white`): raised panels. These are the app sidebar, crawl header, issues panel, grid header row and cards.
- **Graphite Ink** (`graphite-ink`): primary text.
- **Zinc Muted** (`zinc-muted`): secondary fills, the neutral pill, skeletons and the row hover tint (at 60%).
- **Zinc Muted Foreground** (`zinc-muted-foreground`): secondary text. This includes column headers, hints, labels, counts beside values and inactive nav items.
- **Hairline** (`hairline`): every border and divider (set as the global `border-color`). In dark mode it is white at 10%.
- **Input Stroke** (`input-stroke`): the slightly darker outline on form fields.
- **Row Hover** (`row-hover`): an opaque mix of Zinc Muted into the page background. It's used for grid row hover and issues-panel item hover. It's opaque so pinned grid columns can share it without showing the cells that scroll beneath them.

### Semantic: HTTP status classes
- **Status OK** (2xx, and the "Indexable" label), **Status Redirect** (3xx), **Status Client** (4xx), **Status Server** (5xx). These color the monospace status codes in the grid. Each has a lighter version for dark mode.

### Semantic: audit severities
- **Severity Issue** (red), **Severity Warning** (amber), **Severity Opportunity** (blue). These appear as 8px dots, as count colors in the issues panel, and as 15% tinted pill backgrounds for crawl states.
- **Destructive** is separate from Severity Issue. It is for destructive actions and form errors, never for audit results.

### Named Rules
**The One Thread Rule.** Purple marks location or the next action, and nothing else. If an element is neither the current place nor the primary action, it isn't purple.

**The Reading Rule.** Every saturated color other than purple stands for a value: a status class or a severity. Never use a status or severity color for decoration, and never show a value's meaning with color alone. The number or label is always there too.

## Typography

**Body Font:** Inter (fallbacks: ui-sans-serif, system-ui, -apple-system, Segoe UI)
**Mono Font:** JetBrains Mono (fallbacks: ui-monospace, SF Mono, Menlo)

**Character:** A neutral grotesque that blends into the background, paired with a clear monospace that marks anything the crawler recorded exactly. Both load from Google Fonts at weights 400/500/600/700 (Inter) and 400/500 (JetBrains Mono).

### Hierarchy
- **Display** (600, 3.75rem on desktop and 2.25rem on mobile, tight tracking): the landing-page hero only.
- **Headline** (600, 1.875rem, tight tracking): headings on standalone pages such as `/bot` and auth pages.
- **Title** (600, 1rem): card titles, feature names and section heads.
- **Body** (400, 0.875rem): the working size of the app, used in grid cells, nav, buttons and forms. Larger 1.125rem muted text is used only for the landing-page lede.
- **Stat** (600, 1.25rem, tabular): overview stats and the severity totals in the issues panel (1.125rem there).
- **Label** (500, 0.75rem): column headers, field hints, pill text and the "High priority" marker in the issues panel. Issues-panel section heads use it in uppercase with wide tracking. Nothing in the app is set smaller than 0.75rem.
- **Data Mono** (400, 0.75rem, tabular): URLs in the grid, HTTP status codes, content types, status text, user agents and inline `code`. The crawl's start URL is the crawl page's h1, at 1rem semibold.

### Named Rules
**The Verbatim Rule.** If the crawler recorded the text exactly as it found it (a URL, a status code, a header, a user agent), set it in mono. Prose about that text stays in Inter.

**The Tabular Rule.** Any number that sits in a column or updates live uses `tabular-nums`, so digits don't shift while a crawl runs.

## Layout

- **App shell:** a 224px sidebar (logo, team name, nav, user block pinned to the bottom) next to a main area that fills the full viewport height and scrolls on its own. The sidebar collapses to a 56px icon rail, with tooltips naming each icon, and below `md` it is always the rail. The choice is stored in a cookie so the server renders it without a flash.
- **Crawl view:** fills the full height. A header strip on Card White holds:
  - the breadcrumb (Projects / project name) with the actions on the same row;
  - the start URL as the h1;
  - the progress line, plus a limit notice when the crawl stopped at its URL limit;
  - the tab row.

  Below it, the grid fills the remaining space with a sticky header row, beside a 320px issues panel. The panel can be hidden; below `lg` it is hidden by default and overlays the grid when opened. An optional URL detail panel sits below the grid. The toolbar holds filter, search, Clear, the URL count and the column chooser. When an audit filter is active, a rule strip explaining why it matters and how to fix it sits between the toolbar and the grid. A footer strip holds the keyboard hints (j/k, /, Esc) and pagination.
- **Grid density:** cells are padded 6px vertically and 12px horizontally, with a muted, right-aligned row-number column 48px wide. URL cells truncate at 32rem. The row number and Address columns stay pinned while the rest scroll sideways, and a hairline marks the pinned edge.
- **Marketing and standalone pages:** centered at 72rem (landing) or 42rem (`/bot`) wide, with 24px gutters. The landing feature grid is a 3-column grid of cells separated by 1px hairline gaps.
- **Rhythm:** Tailwind's 4px scale. Tight 2–8px gaps inside components, 12–16px between controls, 24px for page gutters and card padding.
- **Responsive:** the app is built for desktop working sessions but stays usable down to phone width. The sidebar becomes the rail, the issues panel becomes an overlay, page gutters drop from 32px to 16px below `sm`, and wide content scrolls sideways inside its own area (grid, tab row). Marketing pages collapse to one column below the `md` breakpoint (768px).

## Elevation & Depth

The system is essentially flat. Depth comes from tone: Card White panels sit on Workbench Paper and are separated by hairline borders. Shadows are barely there: `shadow-xs` on outline buttons and inputs, and `shadow-sm` on cards. Layers that float (popovers, dropdowns, dialogs, sheets) use the stock shadcn shadows.

### Named Rules
**The Hairline Rule.** Separate regions with a 1px hairline border and a change of tone, never with a shadow. A panel that needs a shadow to stand out is in the wrong place.

## Shapes

Gently rounded. The base radius is 8px (`--radius: 0.5rem`) and steps down to 6px for controls and 4px for small fills such as bar-list bars. Cards and the landing feature grid use 12px. Pills, status badges and severity dots are fully round. The logo mark is a rounded square (8px radius on a 32px tile). Tabs have no radius; they use a 2px bottom border as the indicator.

## Components

### Buttons
Quiet, compact and labelled in sentence case.
- **Shape:** 6px corners, 36px high by default (32px `sm`, 24px `xs`, 40px `lg`). Icons are 16px.
- **Primary:** Raisin Skin fill with near-white text, dropping to 90% opacity on hover. Use one per view, for the next action (Start crawling, New crawl).
- **Outline:** a hairline border on the page background, turning to Raisin Wash on hover. Used for secondary actions such as Pause, Export and Cancel.
- **Ghost:** no fill until hover, then Raisin Wash. Used in toolbars and for Sign out.
- **Focus:** a 3px Raisin Ring outline on every variant. Disabled buttons drop to 50% opacity.

### Inputs / Fields
- **Style:** 36px high (32px in the grid toolbar), 6px corners, a 1px Input Stroke border, a transparent fill and `shadow-xs`. Placeholder text uses Zinc Muted Foreground.
- **Focus:** the border shifts to the ring color, with the 3px Raisin Ring.
- **Error:** a destructive border and ring. The `Field` wrapper shows an xs destructive message in place of the hint.
- **Search:** a 14px magnifier icon inset on the left, with 32px left padding.

### Navigation
- **Sidebar items:** 14px muted text with 16px icons and 6px corners. On hover and when active they fill with Raisin Wash and Raisin Wash Foreground; the active item is also medium weight.
- **Tabs:** there is one tab style. Inactive tabs are muted text. The active tab has Graphite Ink medium-weight text and a 2px Raisin Skin underline that sits on the container's bottom border. The crawl view's tab row and the URL detail pane's tabs (the shadcn `line` variant, whose underline is Raisin Skin) both use it. Active crawl tabs carry `aria-current="page"`.

### Destructive actions
- **Placement:** never beside a routine action. A crawl's delete is a muted ghost icon behind a hairline divider. A project's delete sits in a "Delete this project" section under a hairline at the foot of the page, as an outline button with Destructive text.
- **Confirmation:** the `ConfirmDelete` dialog, never the browser's `confirm()`. It names what is lost, and its button names the action ("Delete crawl"). Deleting a project also requires typing the project's name.

### Rule Strip (signature)
Card White and hairline-bordered, between the grid toolbar and the grid while an audit filter is active. It shows a severity dot with the rule name, its priority as text, a one-line description in muted text, and "Fix:" in Graphite Ink. Lines are capped at 75ch.

### Compare switch
When a crawl has a baseline (the project's previous completed crawl), the rule strip carries a small segmented control: **All · New · Fixed**, each with its count. It has a hairline outline, 2px of inner padding, and xs labels. The active segment is Raisin Wash; the others are muted. Below it, "Since the crawl of {date}" names the baseline. In the issues panel, a rule with newly flagged URLs shows a medium-weight "+n" before its count.

### Project switcher
⌘K / Ctrl+K, or the "Jump to project" button at the top of the sidebar nav, opens a dialog 20% from the top of the screen. It holds a borderless search field, a listbox of projects (name, mono host, and on the right whether Enter opens the latest crawl or the project), and an xs footer of key hints. The active option is Raisin Wash. It's an ARIA combobox: the input keeps focus and the active option is tracked with `aria-activedescendant`.

### Status Pill (signature)
A fully round pill with xs medium-weight text in title case, tinted by crawl state. Queued and cancelled are muted, running is Raisin Wash, paused and stopping are warning, analysing is opportunity, completed is OK and failed is destructive. Each uses a 15% tint background with matching text. Running and analysing pills also show a pulsing 6px dot.

### Severity Dot and HTTP Status (signature)
An 8px round dot in the severity color, always shown next to a text label. HTTP status codes are mono, tabular and colored by class. A status of 0 shows a muted "none", and empty values show a muted em dash.

### Data Grid (signature)
A table with no outer border. The header row sticks to the top on Card White, with label-size muted column titles and sort arrows; the sorted column carries `aria-sort`. Rows are separated by hairlines. Hovering a row paints it Row Hover, and the selected row turns Raisin Wash. Every cell paints its own background, so the pinned columns match. The URL column is a mono link that underlines on hover. The selected row scrolls into view as the keyboard moves through the rows. "Indexable" is muted, so the reasons that block indexing stand out.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Card White with a hairline border and `shadow-sm`.
- **Internal Padding:** 24px, with 24px between the header, content and footer.

## Do's and Don'ts

### Do:
- **Do** keep purple to the active tab, the selected row, the current nav item, the primary button and the focus ring (The One Thread Rule).
- **Do** set URLs, status codes, headers and user agents in JetBrains Mono at 0.75rem (The Verbatim Rule).
- **Do** use `tabular` on every number that is in a column or updates live.
- **Do** separate panels with a hairline border and a Card White / Workbench Paper tone change.
- **Do** pair every status or severity color with its number or label.
- **Do** define every new color as a light/dark token pair in `app.css` and map it through `@theme inline`.
- **Do** spell out priority as text ("High priority"), at 0.75rem or larger.
- **Do** confirm deletes with `ConfirmDelete`, and keep destructive controls apart from routine ones.

### Don't:
- **Don't** use status or severity colors for decoration, or reuse Destructive to show audit results.
- **Don't** add a second accent hue. Interaction states use Raisin Wash, not new tints.
- **Don't** lift panels with heavier shadows. Depth in this system comes from tone.
- **Don't** make controls taller or text larger than the 14px body inside the app. Density is what makes long triage sessions work.
- **Don't** use the logo color (#5b2a5e) for UI. Interface purple is Raisin Skin.
- **Don't** put an eyebrow or kicker above a heading. The heading carries its own weight.
