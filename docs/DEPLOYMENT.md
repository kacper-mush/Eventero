# Deployment

One-time setup to wire production. After this, `git push` to `main` deploys both the app (Vercel) and any new schema migrations (Supabase, via GitHub Actions).

## Overview

| Piece | Lives on | Deployed by |
| --- | --- | --- |
| Next.js app | Vercel | Vercel's GitHub integration (auto on push) |
| Postgres + Auth + Realtime | Supabase Cloud | `supabase db push` via `.github/workflows/deploy.yml` |

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> and create a project.
2. Pick a region close to your users (or the demo location).
3. Set a strong database password — **save it**, you'll need it for GitHub secrets.
4. Wait ~1 minute for provisioning.
5. From **Settings → API**, copy these for later:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **`anon` public key**

Also note the **project ref** — the `xxxxx` portion of the URL, also shown in **Settings → General**.

## 2. Create the Vercel project

1. Go to <https://vercel.com/new>, import the GitHub repo.
2. Framework preset auto-detects as **Next.js** — accept defaults.
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key

   Apply both to **Production**, **Preview**, and **Development** (the three checkboxes).
4. Click **Deploy**. First build takes ~2 minutes.

Once deployed, every push to `main` redeploys production and every PR gets its own preview URL automatically.

## 3. Wire the GitHub migration workflow

The `Deploy` workflow runs `supabase db push` whenever a merge to `main` touches `supabase/migrations/`. It needs three secrets.

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret name | Value | Where to get it |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A personal access token | <https://supabase.com/dashboard/account/tokens> → Generate new token |
| `SUPABASE_PROJECT_REF` | Your project ref (e.g. `abcdefghij`) | Supabase **Settings → General** |
| `SUPABASE_DB_PASSWORD` | The password you set in step 1 | You saved it, right? Otherwise reset in **Settings → Database** |

The workflow only triggers on changes under `supabase/migrations/`, so it sits idle until you actually add a migration.

## 4. Link the Supabase CLI locally (one-off)

So you can write migrations and pull schema diffs against the cloud project from your laptop:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

This stores credentials in `~/.supabase` — outside the repo.

## 5. Verify

1. Push any small change to `main` → Vercel rebuilds. Open the production URL and confirm the home page shows "Browser client constructed."
2. Open a PR with a no-op change → confirm the preview URL works the same way.
3. (Later, when you have your first migration) merge a migration PR → check the **Deploy** workflow runs and `supabase db push` completes.

## Custom domain (optional)

In Vercel, **Settings → Domains** → add `eventero.app` (or whatever you bought). Vercel tells you which DNS records to add at your registrar. TLS is auto-issued. Usually live within a few minutes of DNS propagation.

For the demo, the auto-generated `eventero.vercel.app` URL works just as well.

## Day-to-day deployment flow

1. Open a PR. CI runs lint/typecheck/test/build. Vercel posts a preview URL on the PR.
2. Get an approval. Merge (squash).
3. Vercel auto-deploys production.
4. If the PR included migrations, the Deploy workflow runs them against production Supabase.
5. Done — usually 2–3 minutes from merge to live.

If something breaks: Vercel's **Deployments** tab has a one-click rollback to any prior deployment. Database changes are forward-only by convention; for an emergency, restore from a Supabase backup (paid tier) or write a follow-up migration to revert the schema.

## What's not in this scaffold (yet)

- **Staging environment.** Production + per-PR previews cover the MVP. Add a separate Supabase project later if you need an isolated staging DB.
- **Type generation in CI.** Run `supabase gen types typescript --linked > src/lib/database.types.ts` locally for now; can be automated when the schema stabilizes.
- **Edge Functions.** No server-side custom logic exists yet, so no Edge Functions are deployed.
