# Eventero

Event-based communicator. Per-event workspaces, group-scoped channels and task boards. MVP scaffold.

Documentation lives under [`docs/`](docs):

- [`docs/STACK.md`](docs/STACK.md) — what's in the stack, one-liner *why* per choice.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how GitHub, Vercel, and Supabase fit together; runtime + deploy flows; failure modes.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — tables, roles, RLS policies, realtime publication.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — one-time deployment setup runbook.
- [`docs/REPO_CONFIG.md`](docs/REPO_CONFIG.md) — branch protection, merge style, secrets, Dependabot.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's left to build, with open design decisions flagged.

## Prerequisites

- **Node.js** 20+
- **Docker** (for local Supabase)
- **Supabase CLI** — `brew install supabase/tap/supabase`, or grab the latest `.deb`/`.rpm`/binary from the [releases page](https://github.com/supabase/cli/releases). 
- **Git**

## Local development

```bash
git clone <repo-url> eventero
cd eventero
npm install
cp .env.example .env.local

# Start the local Supabase stack (Postgres, Auth, Realtime, Studio, mail-catcher).
# First run pulls Docker images — a few minutes. Subsequent runs are seconds.
supabase start

# Paste the printed `anon key` into NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
# (URL stays http://localhost:54321.)

npm run dev
```

Open <http://localhost:3000>. The home page reports whether the Supabase client is wired correctly.

Useful local URLs while `supabase start` is running:

- Supabase Studio (DB UI): <http://localhost:54323>
- Inbucket (catches outbound emails for magic-link flows): <http://localhost:54324>

Stop the stack when you're done: `supabase stop`.

## Shipping a change

1. Push a branch and open a PR against `main`.
2. CI runs lint, typecheck, tests, and build; Vercel posts a Preview deployment URL on the PR — click through to try the change in a real environment.
3. Get one approval on the review, then squash-merge.
4. Merging to `main` triggers the production Vercel deploy and pushes any new SQL in `supabase/migrations/` to Supabase Cloud.

> **Preview deployments share the production database.** Migrations only run on merge to `main`, so a preview that depends on schema changes from its own PR will fail against prod's older schema. Land schema-only PRs first, then the feature PR that uses them — or accept a broken preview and verify locally.

## Scripts

| Command            | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `npm run dev`      | Next.js dev server                                    |
| `npm run build`    | Production build                                      |
| `npm run start`    | Run the production build                              |
| `npm run lint`     | ESLint                                                |
| `npm run typecheck`| `tsc --noEmit`                                        |
| `npm run test`     | Vitest unit tests                                     |
| `npm run test:e2e` | Playwright end-to-end tests (builds + serves the app) |

First-time Playwright setup: `npx playwright install chromium`.

## Repository layout

```
.github/workflows/   GitHub Actions (CI)
docs/                Architecture & stack decisions
e2e/                 Playwright tests
public/              Static assets, PWA manifest, icons
src/app/             Next.js App Router pages
src/lib/             Shared modules (Supabase client lives here)
supabase/            Local Supabase config + migrations
```

## Deployment

Vercel hosts the Next.js app, Supabase Cloud hosts the database/auth/realtime, and a GitHub Actions workflow pushes schema migrations on merge to `main`. Full setup walkthrough in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## What's in the scaffold and what's not

**In:** Next.js 16 + TypeScript + Tailwind, Supabase browser client wired and verified on the home page, Vitest with one passing test, Playwright with one passing test, GitHub Actions CI (lint + typecheck + test + build), Dependabot, automatic migration push on merge to `main`, PWA manifest.

**Not yet:** auth flows (magic-link login, callback, session-refreshing proxy), database schema and migrations, RLS policies, TanStack Query provider, shadcn/ui components, e2e tests in CI.

These are intentionally deferred until the scaffold itself is validated end-to-end.
