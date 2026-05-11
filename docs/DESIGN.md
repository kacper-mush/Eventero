# Design tokens

The visual language for the Eventero UI: the colour palette, the surfaces each colour belongs to, and the typography scale. Adapted from the original designer's spec into project terms (web PWA, Slack-like layout — see [`ROADMAP.md`](ROADMAP.md) §7), trimmed of platform chrome that doesn't apply (mobile status bar, battery indicator).

Tokens live in [`../src/app/globals.css`](../src/app/globals.css) as Tailwind v4 `@theme` variables, so every colour is reachable as a utility (`bg-brand-900`, `text-accent`, `bg-task-amber-sub`, …). The font is loaded in [`../src/app/layout.tsx`](../src/app/layout.tsx). This file is the reference; `globals.css` is the source of truth — keep them in sync.

> Status: tokens only. No components consume them yet — that lands with the UI foundation work. Until then this is groundwork, not a finished design system.

## Colour palette

### Brand — the olive-green spine

The app's primary colour, used for the persistent navigation chrome and conversation accents.

| Token | Hex | Used for |
| --- | --- | --- |
| `brand-900` | `#4B5405` | App top bar; the app name; a message sender's name |
| `brand-800` | `#5D661D` | Timestamp text inside a conversation |
| `brand-700` | `#737B3B` | Text inside the message compose box |
| `brand-600` | `#909C3A` | Left rail (workspace / group navigation) |
| `brand-500` | `#A0B342` | Channel / section header bar |
| `brand-400` | `#AFC03F` | Control accents — the “+” button, send button, input focus ring |
| `brand-100` | `#E1E4CA` | Background of the timestamp pill in a conversation |
| `brand-50`  | `#F3F5E8` | Background of the message compose box |

### Accent — purple

| Token | Hex | Used for |
| --- | --- | --- |
| `accent` | `#897399` | Every purple surface in the UI |

### Neutral surfaces

| Token | Hex | Used for |
| --- | --- | --- |
| `surface-card`  | `#F4F4F4` | Expanded cards — the panels you open to reach tasks, groups, and private chats |
| `surface-muted` | `#EAEAEA` | Backdrop behind the calendar icon |
| `login-bg`      | `#DBE0E8` | Sign-in screen background |
| `login-fg`      | `#7B7E82` | Sign-in screen text |

Plain black `#000000` and the existing `background` / `foreground` tokens cover the rest of the text and page surfaces.

### Task palettes

Each task category renders in a triplet: a **main** colour (the task itself / its header), a **sub** colour (subtasks), and a **surface** colour (the card it sits on). Four categories ship; treat them as a fixed set to cycle through (the exact mapping — priority? group? — is a UI decision, see [`ROADMAP.md`](ROADMAP.md) §6).

| Palette | main | sub | surface |
| --- | --- | --- | --- |
| `task-green` | `#AFC03F` | `#ECF0D2` | `#FEFEFB` |
| `task-amber` | `#F7CE55` | `#FDF1CE` | `#FFFBEE` |
| `task-coral` | `#FF8E75` | `#FFE5DF` | `#FFFDFC` |
| `task-slate` | `#96A6BD` | `#E6EAEF` | `#FDFDFE` |

## Typography

**Poppins** throughout, in three weights: regular (400), semibold (600), bold (700). Loaded via `next/font/google` and exposed as `--font-poppins` / Tailwind's `font-sans`.

The designer's spec gives sizes per surface; condensed here. Use Tailwind's built-in `text-*` sizes — the closest match is noted. Pixel values are the design intent, not new tokens.

| Surface | Element | Size · weight | Closest Tailwind |
| --- | --- | --- | --- |
| Sign-in | “Create account” / “Sign in” | 24 · bold | `text-2xl font-bold` |
| Sign-in | Field labels (name, password, email…) | 17 · regular | `text-lg` |
| Home (expanded panels) | Card headings (Tasks, Groups, Private) | 16 · bold | `text-base font-bold` |
| Home (expanded panels) | Group names, usernames | 13 · semibold | `text-sm font-semibold` |
| Tasks | “Urgent”, task titles, “Add” | 16 · bold | `text-base font-bold` |
| Tasks | Open-panel title | 14 · bold | `text-sm font-bold` |
| Tasks | Dates | 12 · semibold | `text-xs font-semibold` |
| Tasks | “Filter”, “Change status”, task & subtask body | 11 · regular | `text-[11px]` |
| Calendar | Month name, weekday initials, “Add” | 15 · bold | `text-[15px] font-bold` |
| Calendar | Open-panel title | 14 · bold | `text-sm font-bold` |
| Calendar | Day-of-month numbers | 13 · bold | `text-sm font-bold` |
| Calendar | “Filter” | 11 · regular | `text-[11px]` |
| Calendar | Task names inside day cells | 9 · regular | `text-[9px]` |
| Conversation | Open-panel title | 14 · bold | `text-sm font-bold` |
| Conversation | Sender name | 11 · bold | `text-[11px] font-bold` |
| Conversation | Message body, “Write a message” placeholder | 11 · regular | `text-[11px]` |
| Conversation | Sent-at timestamp | 8 · regular | `text-[8px]` |

(The original spec also lists 11px regular for the mobile status-bar clock and battery — not applicable to the PWA, dropped.)
