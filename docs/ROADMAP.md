# Roadmap

Forward-looking. What's left between the current scaffold and a 15-minute demo. Bird's-eye chunks, not implementation specs. Items marked **🔍 Decisions needed** require design thinking before code.

Rough dependency order — earlier chunks unblock later ones.

## 1. Data model & access control

The foundation everything else depends on. Tables for workspaces, memberships, groups, group memberships, channels, messages, tasks, invitations — plus RLS policies that gate access per workspace and per group.

**🔍 Decisions needed:**
- Role taxonomy — what roles exist (admin / manager / worker?), what each is allowed to do.
- Invitation lifecycle — token TTL, single-use vs reusable, what the organizer can edit after sending.
- Realtime strategy per surface — Postgres CDC subscriptions vs broadcast channels for messages, tasks, presence.

## 2. Authentication

Magic-link login page, auth callback route, session-refreshing proxy (`proxy.ts` in Next 16). Standard `@supabase/ssr` Next.js pattern. Builds on the data model only insofar as the proxy needs to read the user's memberships for authorization checks.

## 3. Workspace lifecycle ✅

Authenticated `/dashboard` shell with a sidebar workspace list and a settings page per workspace (rename, transfer ownership, delete). Ownership transfer goes through a `SECURITY DEFINER` RPC (`transfer_workspace_ownership`) so it can safely bypass the `workspace_memberships` RLS that forbids touching `owner` rows.

**Decisions made:**
- **Hard delete** via `on delete cascade`. Deleting a workspace removes everything inside it (groups, channels, messages, tasks, memberships, invitations). No soft-delete column.
- **No self-service leave.** Removal is the only exit and is admin-only. A sole owner who wants out uses Delete workspace. (The `leave_workspace` RPC shipped earlier was dropped in a follow-up migration once this policy landed.)

## 4. Groups & invitations ✅

Within a workspace: create groups, send invitations with a predefined role, accept invites, manage group membership.

**Groups** ✅ — sidebar lists groups under the active workspace; workspace admins create/delete groups, managers rename and run member CRUD on their own group, plain group members see a read-only roster. RLS-gated end-to-end; group managers got `UPDATE` rights on `groups` via a follow-up migration (DELETE stayed admin-only). The sidebar slot is shared with future channels so Step 5 inherits the IA.

**Invitations** ✅ — workspace admins invite by email from the workspace settings page. **In-app only** (no email delivery yet) and **reject-if-no-account** (the invitee must already have an Eventero account); the send RPC raises `no_account` otherwise. Invites are single-use, role-locked, and expire after 7 days. Recipients see them in a sidebar **Notifications** inbox (`/dashboard/notifications`) and accept or decline from there. Lifecycle (`pending` → `accepted` / `declined` / `revoked` / `expired`) lives on `invitations.status`; all transitions go through `SECURITY DEFINER` RPCs because the invitee can't insert into `workspace_memberships` directly. Notifications are a generic polymorphic table so future event types (mentions, task assignments) can reuse the inbox.

**Deferred follow-ups inside this slice:**
- Email delivery (Resend or Supabase Auth invites). Plumbing point: extend `send_workspace_invitation` to enqueue an email after insert.
- Group-scoped invitations. The `invitations` table already supports `group_id` + `group_role`; only the workspace path has a UI today.
- Editing the role on a pending invite (current rule: revoke and resend).

## 5. Channels & messaging ✅

Per-group channels (live chat + @mention drawer) shipped in steps under "Live chats inside groups". The per-workspace **global channel** ("general") shipped after: auto-created per workspace, lives at `/dashboard/[workspaceId]` (the workspace landing page; settings moved to `/dashboard/[workspaceId]/settings`), reuses the group chat window (realtime list, optimistic send, author edit/delete) and the `GroupShell` drawer. `@handle` mentions fan out into a per-channel `channel_mentions` mailbox (in the realtime publication) surfaced in the channel's "Mentions & activity" drawer — exactly mirroring `group_notifications` for group chats. They are *not* in the global Notifications inbox; that surface stays for account-level / cross-workspace events (invitations).

**Decisions made:**
- **No DMs / cross-group channels.** Two scopes only: one global channel per workspace, one per group.
- **Message features:** edit + delete (author only) — already present from the group chat. No threads or reactions.

**Deferred follow-ups inside this slice:**
- Basic formatting / markdown rendering in message bodies.
- Pagination beyond the most-recent 50 messages.

## 6. Task boards ✅

Per-group **Kanban board** (3 columns, drag to change status), create/assign tasks, a per-group task detail modal with field-level permissions, and a **"My tasks"** view at `/dashboard/my-tasks` aggregating everything assigned to the viewer across all workspaces/groups (grouped by status, links back to each group's board). Realtime on `tasks` everywhere — the board filters to one group; the My-tasks view listens unfiltered and adds/removes rows as `assignee_id` changes.

**Decisions made:**
- **Task fields:** title, description, status, assignee, reporter. No due date (dropped in the Kanban migration), labels, priority, comments, or attachments.
- **Lifecycle:** `TODO / IN_PROGRESS / DONE` (migrated from the original `open / done`).
- **Permissions:** INSERT is group-managers + workspace admins/owners; status is any group member; self-assign only into an empty slot for plain members; reporter handoff is manager→manager only; title/description editable by managers or the current reporter. Enforced by a `BEFORE UPDATE` trigger + RLS (see `20260515060000_tasks_kanban.sql`).

**Deferred follow-ups inside this slice:**
- Notifications already fan out on `task_assigned` / `task_done` into the per-group drawer mailbox (`group_notifications`), not the global inbox.

## 7. UI foundation & navigation — *layout done; shadcn not adopted*

The Slack-like layout is built and in use: collapsing sidebar with the workspace list, per-workspace `#general` + Settings + Groups, top-level Notifications and My-tasks links, a mobile off-canvas drawer (#38), `GroupShell` with a content pane + right drawer. Tailwind design tokens live in `globals.css` (see `DESIGN.md`).

**Not done:** `shadcn/ui` was never wired — no `components.json`, no `src/components/ui/`, no Radix deps. Current UI is hand-rolled Tailwind. Adopting shadcn is optional polish, not on the demo path.

## 8. TanStack Query wiring — *not started*

`@tanstack/react-query` is in `package.json` but unused. No provider, no query keys. Realtime currently updates client state directly via `postgres_changes` subscriptions in each surface (chat, kanban, my-tasks, mentions). Either wire Query for caching/invalidation, or consciously cut it for the demo.

## 9. Demo seeding & polish

Seed data for the demo: one workspace, two groups, organizer + a few workers, sample messages and tasks. A Playwright test covering the 90-second demo path so the demo can't silently break before the presentation.

## Deferred / out of scope (for now)

Worth knowing about, not on the path to the demo:

- **Push notifications** — web push is fiddly, especially iOS. Email on task-assigned may be enough.
- **File uploads / attachments** — Supabase Storage. Out of scope for a chat-only MVP.
- **e2e in CI** — runs locally for now.
- **Auto-generated DB types in CI** — run locally on schema change.
- **Staging Supabase project** — preview deployments share production. Add when isolation matters.
- **Edge Functions** — none yet; revisit if any custom server-side logic appears.
