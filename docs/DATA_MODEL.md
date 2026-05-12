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
               ├──── invitations  (email-keyed, single-use, 7-day TTL)
               └──── notifications  (per-user inbox, polymorphic by type)
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
| `invitations` | Email-keyed pending memberships with a role, 7-day expiry, and a `status` lifecycle (`pending` → `accepted` \| `declined` \| `revoked` \| `expired`). |
| `notifications` | Per-user inbox. `type` discriminates payload; current types: `workspace_invitation`. Inserts/deletes are RPC-only; recipients can read and flip `read_at`. |

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

### Ownership transfer & removal

The membership policies forbid creating, updating, or deleting rows where `role = 'owner'`. **There is no self-service "leave workspace"** — removal is the only exit, and `workspace_memberships` DELETE is admin-only by RLS. A sole owner who wants to back out uses Delete workspace, which cascades through everything inside.

- **`transfer_workspace_ownership(_workspace_id, _new_owner_id)`** — `SECURITY DEFINER`. Caller must be the current owner; target must already be an `admin` or `member` of the workspace. Demotes the caller to `admin` first, then promotes the target to `owner` (the partial unique index allows only one `owner` per workspace, so order matters).

A helper, **`get_workspace_members(_workspace_id)`**, returns `(user_id, email, role)` for fellow members. `auth.users` is not exposed via PostgREST, so any UI that needs to *name* a user (e.g. the transfer dropdown) goes through this function. The caller must be a member of the workspace.

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
| `groups` | workspace admins (all groups in the workspace) + group members (groups they belong to) | workspace admins + group managers (rename) | workspace admins |
| `group_memberships` | self + group members + workspace admins | group managers + workspace admins (only for users already in the parent workspace) | group managers + workspace admins |
| `channels` | workspace members (workspace-wide) or group members (group channels) | workspace admins (group channels must reference a group in the same workspace) | workspace admins |
| `messages` | anyone who can read the parent channel | same (must set `author_id = auth.uid()`) | the author |
| `tasks` | group members | group members | group managers |
| `invitations` | workspace admins; the invitee can see their own pending invites (matching either `invited_user_id` or `auth.jwt() ->> 'email'`) | workspace admins (transitions go through RPCs) | workspace admins |
| `notifications` | self | self (only flips `read_at`) | RPC-only |

## Bootstrap trigger

Inserting a workspace fires `workspaces_after_insert_add_owner`, which inserts the `owner` row in `workspace_memberships` for `created_by`. Without this, the RLS policy chain would be circular — only admins can create memberships, but there are no admins for a brand-new workspace.

The trigger is `SECURITY DEFINER` so it bypasses the membership INSERT policy.

## Invitations

- Keyed by **email** for lookup, with an additional `invited_user_id` populated at send time. The current product rule is **reject-if-no-account**: `send_workspace_invitation` resolves the email to an `auth.users` row up-front and refuses if none exists. Email-keyed storage is retained so a future "invite people before they sign in" mode can be re-enabled without a schema change.
- **Lifecycle** is tracked on `status` (`pending` → `accepted` \| `declined` \| `revoked` \| `expired`). `consumed_at` and `responded_at` are kept in sync as timestamps. A partial unique index on `(workspace_id, coalesce(group_id, …), lower(email)) where status = 'pending'` prevents duplicate live invites.
- **TTL**: `expires_at` defaults to `now() + interval '7 days'`. `accept_workspace_invitation` checks the window and flips the row to `expired` if it has passed.
- Group-scoped invites require both `group_id` *and* `group_role`; workspace-only invites have neither. Enforced by a `CHECK` constraint. Only the workspace-scoped path has a UI today.
- The accept/decline/revoke transitions are **not** plain RLS-permitted UPDATEs. They run through `SECURITY DEFINER` RPCs because the invitee isn't yet a workspace admin and so cannot insert into `workspace_memberships` directly:
  - **`send_workspace_invitation(workspace_id, email, role)`** — admin-only. Raises `no_account` / `already_member` / `already_invited`. On success, inserts the invitation and a matching `notifications` row for the recipient atomically.
  - **`accept_workspace_invitation(invitation_id)`** — invitee-only. Inserts `workspace_memberships`, finalises the invitation, and marks the matching notification read. Returns the workspace id so the caller can redirect.
  - **`decline_workspace_invitation(invitation_id)`** — invitee-only. Flips status without creating a membership.
  - **`revoke_workspace_invitation(invitation_id)`** — admin-only. Flips status and deletes the recipient's notification, since the invite no longer exists from their perspective.
  - **`get_workspace_pending_invitations(workspace_id)`** — admin-only listing helper that joins `auth.users` for the inviter email.

## Notifications

A generic per-user inbox. One row per notification; the `type` column discriminates the shape of `payload jsonb`. Current types:

- `workspace_invitation` — `payload = {"invitation_id": uuid}`. The source of truth for the invitation's current status stays on `invitations`.

RLS:
- **Read** — `user_id = auth.uid()`.
- **Update** — same; recipients can only flip `read_at` (no other field is mutated by any code path).
- **Insert / Delete** — no `GRANT`. Only the invitation RPCs touch these.

`get_my_notifications()` is a `SECURITY DEFINER` helper that joins each notification to its underlying object (currently `invitations` + `workspaces` + `auth.users`) so the `/dashboard/notifications` page can render headlines without a chain of client-side joins.

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
