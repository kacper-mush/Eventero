# Eventero — Locked Stack

The technology choices for the Eventero MVP. Each entry is the choice + a short *why*.

## Application type

- **Progressive Web App (PWA)** — one Next.js codebase covers web, installable desktop, installable Android, installable iOS. No app stores, no native toolchains, fastest path to a polished cross-platform demo.

## Frontend

- **Next.js 16 (App Router)** — the de-facto React framework; first-class on Vercel; server components reduce client bundle size.
- **TypeScript (strict mode)** — catches whole categories of bugs at compile time; types flow from the DB schema all the way into components.
- **Tailwind CSS** — utility-first styling, fast iteration, no CSS file sprawl. Design tokens (palette, type scale) live in `globals.css`; see [`DESIGN.md`](DESIGN.md).
- **Poppins (via `next/font`)** — the product typeface; self-hosted at build time, no layout shift, no extra request.
- **shadcn/ui** — accessible, unstyled-by-default React components copied into the repo (not a dependency). Clean Slack-like UI in days.
- **TanStack Query** — handles server-state caching, refetching, and optimistic updates without hand-rolled state management.

## Backend

- **Supabase (managed cloud)** — bundles Postgres + Auth + Realtime + Storage behind one client SDK. Replaces a custom Node API for the MVP.
- **Postgres (via Supabase)** — real, portable, robust relational DB. No vendor lock-in on the data layer; we can leave with our schema intact if needed.
- **Row-Level Security (RLS)** — authorization enforced in the DB itself, not in app code. One policy protects every query path.
- **Supabase Realtime** — WebSocket-based change feed from Postgres replication; chat and task updates land in clients without a custom realtime server.

## Auth

- **Magic link (passwordless) only** — built into Supabase Auth, zero password-reset flows to build, less UI to test, demos cleanly. Predefined roles handled via an `invitations` table keyed by email; the verified email from magic-link sign-in is matched against pending invites to create memberships.

## Testing

- **TypeScript + ESLint** — continuous, free, catches typos and type errors in the editor and CI.
- **Vitest** — fast unit-test runner for pure logic and React component behavior. Many of these.
- **Playwright** — end-to-end tests in a real browser against deployed previews. Few of these, covering the demo path so the demo cannot silently break.

## Deployment

- **Vercel (frontend)** — built by the Next.js team; zero-config deploys; per-PR preview URLs; atomic zero-downtime swaps; one-click rollback.
- **Supabase Cloud (backend)** — managed Postgres + Auth + Realtime; no servers to run; daily backups available on paid tier.
- **Custom domain via Vercel DNS** — auto-issued TLS, optional for the demo (the auto-generated `*.vercel.app` URL works).

## CI/CD

- **GitHub Actions** — pipeline runs on every PR: typecheck → lint → unit tests → build → Playwright against the Vercel preview → migration validation. On merge to `main`: applies Supabase migrations; Vercel auto-deploys production. Cheap checks run first so failures surface fast.

## Local development

- **Node.js 20+, Docker Desktop, Supabase CLI, Git** — the only machine prerequisites.
- **`supabase start`** — boots the entire Supabase stack (Postgres, Auth, Realtime, Storage, mail-catcher) in Docker. Real services locally, no cloud dependency, works offline.
- **Migrations as SQL files** in `supabase/migrations/` — committed to the repo; applied to local DB on `supabase start`, applied to production by CI on merge.
- **Auto-generated DB types** (`supabase gen types typescript`) — DB schema flows into TypeScript so renames break the build at the right place.

## Repository layout

- **Single Next.js repo** (not a monorepo) — only one app exists; a monorepo would be overhead with no payoff. Convertible later if a second app (e.g. Expo native) is ever added.

## Out of scope for MVP

- Payments / billing — deferred until after the architecture is proven.
- Native mobile apps (App Store / Play Store) — PWA covers the demo and early users.
- Staging environment — production + per-PR previews are enough for the MVP.
- Advanced observability (APM, log aggregation) — Vercel + Supabase dashboards suffice for demo scale.
