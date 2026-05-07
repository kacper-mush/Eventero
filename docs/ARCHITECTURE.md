# Architecture

How the three systems fit together at runtime and at deploy time, where every value lives, and the failure modes that come with this setup. For the *list* of technologies see [`STACK.md`](STACK.md). For the *how-to* of setting it up see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## The three systems

```
        ┌──────────────────┐
        │   GitHub repo    │      source of truth for code + schema
        │                  │
        │  src/...         │
        │  supabase/       │
        │   ├ config.toml  │
        │   └ migrations/  │
        │  .github/        │
        │   └ workflows/   │
        └────────┬─────────┘
                 │
       ┌─────────┴─────────┐
       │                   │
       │ on push           │ on push to main
       │ (any branch)      │ (only if migrations/ changed)
       │                   │
       ▼                   ▼
┌──────────────┐    ┌────────────────────┐
│   Vercel     │    │  GitHub Actions    │
│              │    │   deploy.yml       │
│  builds &    │    │                    │
│  hosts the   │    │  runs:             │
│  Next.js app │    │  supabase db push  │
└──────┬───────┘    └─────────┬──────────┘
       │                      │
       │  HTTPS               │  applies SQL migrations
       │  + WebSockets        │  to the live DB
       │                      │
       ▼                      ▼
                ┌─────────────────────┐
                │   Supabase Cloud    │
                │                     │
                │   Postgres + Auth   │
                │   + Realtime + RLS  │
                └─────────────────────┘
```

- **GitHub** holds code. Source of truth.
- **Vercel** runs the frontend. Pulls from GitHub, builds, serves.
- **Supabase** runs the backend. Holds DB, auth users, realtime. Doesn't watch anything — migrations are pushed to it from CI.

## Runtime: how the user's browser reaches the data

When someone opens the deployed app:

1. Browser fetches HTML/JS/CSS from **Vercel**.
2. The JS contains a Supabase client constructed with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (baked in at build time).
3. The client opens a connection from **the browser directly to Supabase Cloud** over HTTPS / WebSockets — Vercel is **not** in the data path.
4. Vercel only serves the initial page load and any Next.js server-rendered routes.

This is why the publishable key is safe to ship in the browser bundle: it's a public identifier saying "I'm a client of project X." Real access control lives inside Supabase as RLS policies.

## Deploy time: two automations

### A. Vercel watches GitHub directly

Vercel has its own GitHub App on the repo. It listens for `push` events.

- Push to any branch / open a PR → preview URL.
- Push or merge to `main` → production deploy.

No workflow YAML needed; configured in Vercel's UI.

### B. GitHub Actions pushes Supabase migrations

`.github/workflows/deploy.yml` runs only on merges to `main` that touch `supabase/migrations/`. It uses three GitHub-stored secrets to log into Supabase from a CI runner and run `supabase db push`.

This automation exists because Supabase has no equivalent of Vercel's GitHub App — it doesn't know your repo exists. GitHub Actions plays the messenger.

## Where every value lives

| Value | Stored in | Why there |
| --- | --- | --- |
| Source code, schema migrations | GitHub | source of truth, versioned |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel env vars | needed at build time to bake into the JS bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key value) | Vercel env vars | same |
| `SUPABASE_ACCESS_TOKEN` | GitHub Secrets | GitHub Actions uses it to log into Supabase |
| `SUPABASE_DB_PASSWORD` | GitHub Secrets | same |
| `SUPABASE_PROJECT_REF` | GitHub Secrets | tells the action which project to push to |
| Database rows, auth users, files | Supabase Cloud | the actual application state |

The same project sometimes needs the same value entered in two places (Vercel for runtime, GitHub for CI). They don't share — that's normal.

## Conventions worth knowing

- **Forward-compatible migrations.** Schema and code deploy semi-independently from a single merge — Vercel and the migration job kick off in parallel. To avoid the brief window where one has applied and the other hasn't, write migrations that don't break the running code: add columns nullable first, deploy code that handles both shapes, then a follow-up migration to enforce constraints.

- **Squash-merge only.** Each PR becomes one commit on `main` — clean log, trivial reverts.

- **PR previews talk to production Supabase.** Per-PR isolation isn't free; for an MVP we accept it. If a preview that writes garbage to prod becomes a real risk, spin up a "staging" Supabase project and point preview env vars at it.

- **Migrations are forward-only.** No down-migrations by convention. To revert a schema change, write a follow-up migration; for a true emergency, restore from a Supabase backup (paid tier).

## Failure modes

- **Env var drift.** Vercel env vars get rotated but `.env.local` doesn't, or the Supabase publishable key gets regenerated and Vercel isn't updated. Both fail silently — the app just stops working. `.env.example` documents the required names but doesn't enforce parity.

- **Schema before code.** A migration adds a `NOT NULL` column. The currently running code can't INSERT — it doesn't know about the column. See "forward-compatible migrations" above.

- **Code before schema.** Code references a column the migration is supposed to create, but the migration job fails. Code is already live referring to nonexistent columns. Watch the Deploy workflow when migrations are involved; investigate the failure before assuming things are fine.

- **Preview = prod DB.** Mentioned above; worth restating because it bites occasionally.

- **Migration race.** `deploy.yml` is concurrency-locked (`group: supabase-migrations`) so two simultaneous merges can't push migrations in parallel. Without that lock, schema state could diverge.

- **CI says green but production is broken.** CI doesn't run e2e (deferred). A bug only visible end-to-end won't be caught until a human clicks through the preview URL. Treat preview-URL exercise as a real review step, not a formality.

## What's deferred (and why)

- **Staging environment** — production + per-PR previews are sufficient for the MVP demo. A separate Supabase project for previews adds setup and env-var sync work that doesn't pay off yet.
- **e2e in CI** — Playwright runs locally. CI integration deferred until the test suite is stable enough to not generate false-positive flakes.
- **Type generation in CI** — `supabase gen types typescript` runs locally for now; automate when the schema stabilizes.
- **Edge Functions** — no custom server-side logic yet. The Supabase JS client + RLS does it all.
