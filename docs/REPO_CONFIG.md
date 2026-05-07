# Repository configuration
## Branch protection

`main` is protected by a ruleset:

- Direct pushes blocked. Changes only land via PR.
- 1 approval required; stale reviews are dismissed when new commits land.
- The `check` job (`ci.yml`) must pass and the branch must be up to date.
- Force pushes blocked. `main` cannot be deleted. Linear history enforced.

## Merge behavior

- Squash-merge only — each PR becomes one commit on `main`.
- Head branches auto-delete after merge.
- Allow merge commits / rebase merges are both off.

## CI/CD

- **`.github/workflows/ci.yml`** runs on every PR and push to `main`: `npm ci` → lint → typecheck → unit tests → build. Build uses placeholder Supabase env vars.
- **`.github/workflows/deploy.yml`** runs on push to `main` only when `supabase/migrations/**` changes; runs `supabase db push`.

## GitHub Secrets

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` are configured for `deploy.yml`. Vercel env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) live in Vercel, not here.

## Dependabot

`.github/dependabot.yml` watches:

- **npm** — weekly Monday. Minor + patch updates grouped (production / development); majors come as individual PRs. Cap of 5 open PRs.
- **github-actions** — weekly Monday.

Useful PR commands when triaging Dependabot:

- `@dependabot rebase` — rebase a stale PR.
- `@dependabot merge` — merge once CI passes.
- `@dependabot ignore this major version` — persistent ignore (also closes the PR).
- `@dependabot unignore this major version` — undoes the above.

## Code security

Dependabot alerts, security updates, and secret-scanning + push-protection are all enabled.

## Intentionally not configured

- CODEOWNERS, PR/issue templates, GitHub Environments with required reviewers, pre-commit hooks. None pay off at this team size; revisit when concrete friction shows up.
