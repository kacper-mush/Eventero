# Data model

The shape of the database, who can read or write each table, and the conventions baked into the schema. Source of truth is `supabase/migrations/`; this doc describes the state those migrations produce.

## Tables

```
auth.users ────┬──── workspaces ───── workspace_memberships
               │         │
               │         └── groups ─┬── group_memberships
               │                     │
               │                     ├── channels ─── messages
               │                     │     (group_id may be null
               │                     │      for workspace-wide channels)
               │                     │
               │                     └── tasks
               │
               └──── invitations  (email-keyed, single-use, 7-day TTL)
```

| Table | Purpose |
| --- | --- |
| `workspaces` | One row per event. Owned by the user who created it. |
| `workspace_memberships` | Composite key `(workspace_id, user_id)`. Role is `owner` \| `admin` \| `member`. |
| `groups` | Sub-units inside a workspace (e.g. "Catering", "Stage Crew"). |
| `group_memberships` | Composite key `(group_id, user_id)`. Role is `manager` \| `member`. |
| `channels` | Chat surfaces. `group_id is null` → workspace-wide; otherwise group-scoped. |
| `messages` | `bigint identity` id for cheap chronological ordering. |
| `tasks` | Per-group. Fields: title, assignee, status (`open`\|`done`), due date. |
| `invitations` | Email-keyed pending memberships with a role and 7-day expiry. |

## Roles

Two scopes, three concepts:

- **Workspace role** (`workspace_memberships.role`): `owner`, `admin`, `member`.
  - `owner` — exactly one per workspace, created automatically when the workspace is inserted. Only an owner can delete the workspace. Ownership transfer is a deliberate later operation, not a plain UPDATE.
  - `admin` — manages groups, channels, invitations, and other memberships (cannot create/update/delete `owner` rows).
  - `member` — read access to the workspace shell and any groups they belong to.
- **Group role** (`group_memberships.role`): `manager`, `member`.
  - `manager` — adds/removes members of the group, deletes tasks.
  - `member` — reads/writes messages and tasks in the group.

Workspace admins always inherit management rights over groups within their workspace (see RLS policies on `group_memberships`).

## Row-level security

Every public table has RLS enabled and explicit `GRANT`s to the `authenticated` role (new tables in `public` are RLS-protected *and* hidden from the Data API by default).

Policies route through these `SECURITY DEFINER` helper functions to avoid recursive policy evaluation:

- `is_workspace_member(workspace_id)` — current user
- `is_workspace_member(workspace_id, user_id)` — an arbitrary user (used when a policy must check the *target* row's user, not the caller)
- `is_workspace_admin(workspace_id)` — true for `owner` or `admin`
- `is_workspace_owner(workspace_id)`
- `is_group_member(group_id)`
- `is_group_manager(group_id)`

`SECURITY DEFINER` lets these helpers read membership tables without triggering the policies on those same tables. `search_path` is pinned to `public` inside each helper.

### Access summary

| Surface | Read | Write | Delete |
| --- | --- | --- | --- |
| `workspaces` | members | any authenticated user can create (becomes owner via trigger); admins can update | owner only |
| `workspace_memberships` | self + workspace admins | workspace admins (only `admin`/`member` roles) | workspace admins (except `owner` row) |
| `groups` | workspace members | workspace admins | workspace admins |
| `group_memberships` | self + group members + workspace admins | group managers + workspace admins (only for users already in the parent workspace) | group managers + workspace admins |
| `channels` | workspace members (workspace-wide) or group members (group channels) | workspace admins (group channels must reference a group in the same workspace) | workspace admins |
| `messages` | anyone who can read the parent channel | same (must set `author_id = auth.uid()`) | the author |
| `tasks` | group members | group members | group managers |
| `invitations` | workspace admins; the invitee can see their own pending invites by matching `auth.jwt() ->> 'email'` | workspace admins | workspace admins |

## Bootstrap trigger

Inserting a workspace fires `workspaces_after_insert_add_owner`, which inserts the `owner` row in `workspace_memberships` for `created_by`. Without this, the RLS policy chain would be circular — only admins can create memberships, but there are no admins for a brand-new workspace.

The trigger is `SECURITY DEFINER` so it bypasses the membership INSERT policy.

## Invitations

- Keyed by **email** (not by `auth.users.id`) so an organizer can invite people before they sign in.
- **Single-use**: `consumed_at timestamptz`. A unique index on `(workspace_id, coalesce(group_id, …), lower(email)) where consumed_at is null` prevents duplicate pending invites.
- **TTL**: `expires_at` defaults to `now() + interval '7 days'`. The accept flow (built later) must check `expires_at > now() and consumed_at is null`.
- Group-scoped invites require both `group_id` *and* `group_role`; workspace-only invites have neither. Enforced by a `CHECK` constraint.
- The actual "accept invitation → create memberships → mark consumed" step is **not** a plain RLS-permitted UPDATE. It needs a `SECURITY DEFINER` RPC (added with the invitation-accept flow in ROADMAP item 4) because the invitee is not yet an admin, so they cannot insert into `workspace_memberships` directly.

## Realtime

`messages` and `tasks` are members of the `supabase_realtime` publication. Clients subscribe via `postgres_changes` and rely on RLS for filtering — a subscriber only receives events for rows their `SELECT` policy allows.

Other tables are intentionally **not** published yet. Membership and channel changes are infrequent and can be refetched on demand; adding them to the publication is a follow-up if a use case justifies the event volume.

## Conventions in the schema

- **`gen_random_uuid()`** for primary keys, except `messages` which uses `bigint generated always as identity` for cheap chronological ordering of a hot, append-heavy table.
- **`on delete cascade`** down the ownership tree (workspace → groups → channels → messages, etc.). Removing a workspace removes everything inside it.
- **`on delete restrict`** on `created_by`/`invited_by` to `auth.users` — we don't want a user deletion to silently take a workspace or audit row with it. (`auth.users` deletion is a rare, explicit operation in Supabase.)
- **`on delete set null`** on `tasks.assignee_id` — a departed assignee leaves the task unassigned, not deleted.
- **`length(trim(...)) > 0`** check constraints on user-facing text fields catch whitespace-only names at the DB layer.
- **Indexes** are added only where a query pattern is already known: membership lookups by `user_id`, message reads by `(channel_id, created_at desc)`, task filters by `(group_id, status)`, pending-invite lookups by `lower(email)`.

## What this doc does *not* describe

- **TypeScript types.** Run `supabase gen types typescript --local > src/lib/database.types.ts` after schema changes. Auto-generation in CI is deferred (see [ROADMAP.md](ROADMAP.md)).
- **Migration mechanics.** See [ARCHITECTURE.md](ARCHITECTURE.md) for how migrations reach Supabase Cloud, and [AGENTS.md](../AGENTS.md) for the forward-only / forward-compatible conventions.
