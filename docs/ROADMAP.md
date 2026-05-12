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

## 5. Channels & messaging

Per-workspace global channel + per-group channels. Message list with realtime updates, send box, basic formatting.

**🔍 Decisions needed:**
- Channel scope — per-group only, or also DMs / cross-group?
- Message features — threads, reactions, edit, delete? (MVP-likely answer: none.)

## 6. Task boards

Per-group task list, create/assign/complete tasks, "my tasks" view aggregated across groups, realtime updates.

**🔍 Decisions needed:**
- Task fields — minimum (title, assignee, status, due) vs richer (labels, priority, comments, attachments).
- Task lifecycle — `open / done`, or also `in-progress`?

## 7. UI foundation & navigation

Slack-like layout: sidebar (workspaces switcher, groups, channels), main content area, top bar. Wire `shadcn/ui` with a small starting set: sidebar, button, input, card, dialog, dropdown.

**🔍 Decisions needed:**
- Information architecture — where the workspace switcher lives, how groups vs channels are visually distinguished, mobile collapse behavior.

## 8. TanStack Query wiring

Provider in root layout. Per-route query keys. Realtime subscriptions invalidate the relevant queries on insert/update/delete.

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
