# Eventero

Event-based communicator. Per-event workspaces, group-scoped channels and task boards. MVP scaffold.

For architecture and stack rationale, see [`docs/STACK.md`](docs/STACK.md).

## Prerequisites

- **Node.js** 20+
- **Docker** (for local Supabase)
- **Supabase CLI** — `npm i -g supabase` or `brew install supabase/tap/supabase`
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

The MVP runs on two managed services. Both have free tiers sufficient for the demo.

### One-time setup

1. **Create a Supabase project** at <https://supabase.com>. Note the project URL and the `anon` key.
2. **Push the repo to GitHub.**
3. **Create a Vercel project** at <https://vercel.com/new>, import the GitHub repo, and add two environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase project's anon key
4. Vercel auto-deploys on every push to `main` and creates a preview URL for every PR.

### Pushing schema migrations to production

When schema migrations exist, link the local CLI to the cloud project once, then push:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

A GitHub Action that runs `supabase db push` on merges to `main` is a follow-up — not wired up in this scaffold.

## What's in the scaffold and what's not

**In:** Next.js 16 + TypeScript + Tailwind, Supabase browser client wired and verified on the home page, Vitest with one passing test, Playwright with one passing test, GitHub Actions CI (lint + typecheck + test + build), PWA manifest.

**Not yet:** auth flows (magic-link login, callback, session-refreshing proxy), database schema and migrations, RLS policies, TanStack Query provider, shadcn/ui components, e2e tests in CI, automatic migration push on deploy.

These are intentionally deferred until the scaffold itself is validated end-to-end.
