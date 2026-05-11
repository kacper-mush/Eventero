# Eventero — agent orientation

Event-based communicator. Per-event workspaces, group-scoped channels and task boards. MVP scaffold, headed for a 15-minute demo.

## Read these before doing real work

- [`docs/STACK.md`](docs/STACK.md) — what the stack is and why.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how GitHub, Vercel, and Supabase fit together; runtime + deploy flows; failure modes.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — tables, roles, RLS policies, realtime publication.
- [`docs/DESIGN.md`](docs/DESIGN.md) — colour palette, surface roles, and the Poppins type scale; the design tokens in `globals.css`.
- [`docs/REPO_CONFIG.md`](docs/REPO_CONFIG.md) — repo settings, branch protection, Dependabot.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — reference only; the deploy is already wired.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's left to build, with open design decisions called out.

These docs describe **current state and conventions**, not setup instructions. They should be the first thing you reach for when context is thin.

## Critical conventions

- **MVP-minded.** Build only what the current task asks for. Don't pre-add auth flows, design systems, providers, or data layers that haven't been requested. Things deliberately deferred are listed at the bottom of `ROADMAP.md` and in the README.
- **Docs describe state, not how-to.** When updating docs, default to descriptive ("here's what's true / what to expect"). Step-by-step setup belongs only in explicit runbooks (currently just `DEPLOYMENT.md`).
- **`STACK.md` is a tight manifest.** One-liner per choice (what + short *why*). Detail goes in sibling docs, never in `STACK.md`.
- **Squash-merge only.** Each PR becomes one commit on `main`. Keep PRs scoped accordingly.
- **`main` is protected.** PR + 1 approval + green CI required. Stale reviews dismissed on push.

## Stack-specific gotchas

- **Next.js 16.** APIs and conventions differ from earlier major versions. Notably: middleware is now called **proxy** (file is `proxy.ts`, not `middleware.ts`). Read `node_modules/next/dist/docs/` before writing routing/middleware/server-action code.
- **Supabase publishable key.** New API key naming. Use the *publishable key* value as `NEXT_PUBLIC_SUPABASE_ANON_KEY`; ignore legacy `anon` / `service_role`. Never put `default secret` (server-only) in a `NEXT_PUBLIC_*` env var.
- **`@supabase/ssr` patterns.** Use `getClaims()` for authorization checks (validates JWT). `getUser()` for fresh user data. Never `getSession()` for auth decisions.
- **RLS-first.** The Supabase project has auto-RLS on; new tables in `public` are RLS-protected by default but **not exposed to the Data API** by default. Adding a table that should be reachable from the client requires explicit `GRANT` statements *and* RLS policies in the migration.
- **ESLint pinned to v9.** Major bumps to ESLint 10 are blocked in `dependabot.yml` because `eslint-plugin-react` (transitive in `eslint-config-next`) isn't compatible. Don't manually bump ESLint until `eslint-config-next` ships v10-compatible deps.
- **Migrations are forward-only.** Schema changes go in `supabase/migrations/` as new SQL files. To revert, write a follow-up migration.
- **Forward-compatible migrations.** Vercel and the migration job kick off in parallel from one merge — write migrations that don't break the running code (add columns nullable first, enforce constraints in a follow-up).

## Verifying changes

Before declaring work complete, run the same pipeline CI runs:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

E2E (`npm run test:e2e`) runs locally only; CI doesn't gate on it yet.

## Tooling memory

The user prefers minimal MVP-style scaffolding, descriptive docs, and concise communication. They will redirect you if you go deeper than the task requires — read those redirects as guidance for future work too.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
