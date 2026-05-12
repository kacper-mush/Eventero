import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { emailToHandle } from "@/lib/mentions";
import { createClient } from "@/lib/supabase/server";

import { getWorkspaceMembers } from "../../../actions";
import { ChatWindow } from "./chat";
import { GroupShell } from "./drawer";
import {
  AddMemberSection,
  DeleteGroupSection,
  GroupHeader,
  MembersList,
} from "./group-forms";
import { MentionsList } from "./mentions";
import type { ChatMessage, GroupMention } from "./actions";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ workspaceId: string; groupId: string }>;
}) {
  const { workspaceId, groupId } = await params;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  const userEmail =
    typeof claimsData?.claims?.email === "string"
      ? claimsData.claims.email
      : "";
  if (!userId) redirect("/login");

  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("id, workspace_id, name")
    .eq("id", groupId)
    .maybeSingle();
  if (groupErr) throw new Error(groupErr.message);

  if (!group || group.workspace_id !== workspaceId) {
    redirect(`/dashboard/${workspaceId}`);
  }

  const workspaceMembers = await getWorkspaceMembers(workspaceId);
  const me = workspaceMembers.find((m) => m.user_id === userId);
  if (!me) redirect("/dashboard");

  const { data: groupMembershipRows, error: gmErr } = await supabase
    .from("group_memberships")
    .select("user_id, role")
    .eq("group_id", groupId);
  if (gmErr) throw new Error(gmErr.message);

  const emailByUser = new Map(
    workspaceMembers.map((m) => [m.user_id, m.email]),
  );
  const groupMembers = (groupMembershipRows ?? []).map((row) => ({
    user_id: row.user_id,
    role: row.role as "manager" | "member",
    email: emailByUser.get(row.user_id) ?? "(unknown)",
  }));

  const myGroupMembership = groupMembers.find((m) => m.user_id === userId);
  const isWorkspaceAdmin = me.role === "owner" || me.role === "admin";
  const isGroupManager = myGroupMembership?.role === "manager";
  const canManageMembers = isWorkspaceAdmin || isGroupManager;
  const canRename = isWorkspaceAdmin || isGroupManager;
  const canDelete = isWorkspaceAdmin;
  const isGroupMember = !!myGroupMembership;

  const viewerNote = isWorkspaceAdmin
    ? `You are ${me.role === "owner" ? "the workspace owner" : "a workspace admin"} — you have full access to every group in this workspace.`
    : isGroupManager
      ? "You are a manager of this group."
      : "You are a member of this group.";

  const memberIds = new Set(groupMembers.map((m) => m.user_id));
  const candidatesToAdd = workspaceMembers.filter(
    (m) => !memberIds.has(m.user_id),
  );

  // Channel for this group (1:1 — auto-created by the trigger on insert).
  const { data: channel, error: channelErr } = await supabase
    .from("channels")
    .select("id")
    .eq("group_id", group.id)
    .maybeSingle();
  if (channelErr) throw new Error(channelErr.message);

  // Build the chat + mentions UI only when the viewer can actually read
  // messages (group member or workspace admin — RLS will gate the rest).
  const canSeeChat = isGroupMember || isWorkspaceAdmin;

  const memberEmailRecord: Record<string, string> = Object.fromEntries(
    workspaceMembers.map((m) => [m.user_id, m.email]),
  );
  let initialMessages: ChatMessage[] = [];
  let initialMentions: GroupMention[] = [];

  if (channel && canSeeChat) {
    const [msgsRes, mentionsRes] = await Promise.all([
      supabase
        .from("messages")
        .select("id, channel_id, author_id, body, created_at, edited_at")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50),
      supabase
        .from("group_mentions")
        .select(
          "id, message_id, group_id, author_id, seen_at, created_at, messages(body)",
        )
        .eq("group_id", group.id)
        .eq("mentioned_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    if (msgsRes.error) throw new Error(msgsRes.error.message);
    if (mentionsRes.error) throw new Error(mentionsRes.error.message);

    initialMessages = ((msgsRes.data ?? []) as Array<{
      id: number;
      channel_id: string;
      author_id: string;
      body: string;
      created_at: string;
      edited_at: string | null;
    }>)
      .map((m) => ({
        id: m.id,
        channel_id: m.channel_id,
        author_id: m.author_id,
        author_email: memberEmailRecord[m.author_id] ?? "(unknown)",
        body: m.body,
        created_at: m.created_at,
        edited_at: m.edited_at,
      }))
      // Order ascending in the UI (oldest first, newest at bottom).
      .reverse();

    initialMentions = ((mentionsRes.data ?? []) as Array<{
      id: string;
      message_id: number;
      group_id: string;
      author_id: string;
      seen_at: string | null;
      created_at: string;
      messages: { body: string } | { body: string }[] | null;
    }>).map((m) => {
      const msg = Array.isArray(m.messages) ? m.messages[0] : m.messages;
      return {
        id: m.id,
        message_id: m.message_id,
        group_id: m.group_id,
        author_id: m.author_id,
        author_email: memberEmailRecord[m.author_id] ?? "(unknown)",
        body: msg?.body ?? "(message unavailable)",
        seen_at: m.seen_at,
        created_at: m.created_at,
      };
    });
  }

  // A small hint surfaced in the chat area when the user can't post yet.
  const handleHint = `Tip — your handle is @${emailToHandle(userEmail)}`;

  const main =
    channel && canSeeChat ? (
      <ChatWindow
        workspaceId={workspaceId}
        groupId={group.id}
        channelId={channel.id}
        initialMessages={initialMessages}
        viewerUserId={userId}
        viewerEmail={userEmail}
        memberEmails={memberEmailRecord}
      />
    ) : (
      <div className="flex h-full items-center justify-center p-8 text-sm text-neutral-500">
        {channel
          ? "Join this group to send messages."
          : "Chat is not available for this group yet."}
      </div>
    );

  const unreadMentionCount = initialMentions.filter(
    (m) => m.seen_at === null,
  ).length;

  const drawer = (
    <>
      <GroupHeader
        workspaceId={workspaceId}
        groupId={group.id}
        name={group.name}
        canRename={canRename}
        viewerNote={viewerNote}
      />

      {canSeeChat && (
        <DrawerSection
          title="Mentions & activity"
          subtitle="Last 5 @mentions for you in this group."
          badge={unreadMentionCount > 0 ? String(unreadMentionCount) : null}
          defaultOpen
        >
          <MentionsList
            groupId={group.id}
            viewerUserId={userId}
            authorEmails={memberEmailRecord}
            initial={initialMentions}
          />
        </DrawerSection>
      )}

      <DrawerSection
        title="Members"
        subtitle={`${groupMembers.length} total${
          canManageMembers ? "" : " · view only"
        }`}
      >
        <div className="flex flex-col gap-3">
          <MembersList
            workspaceId={workspaceId}
            groupId={group.id}
            members={groupMembers}
            viewerUserId={userId}
            canManage={canManageMembers}
          />
          {canManageMembers && (
            <AddMemberSection
              workspaceId={workspaceId}
              groupId={group.id}
              candidates={candidatesToAdd}
            />
          )}
        </div>
      </DrawerSection>

      {canDelete && (
        <DrawerSection
          title="Danger zone"
          subtitle="Permanently delete this group."
        >
          <DeleteGroupSection
            workspaceId={workspaceId}
            groupId={group.id}
            groupName={group.name}
          />
        </DrawerSection>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GroupShell
        groupName={group.name}
        header={
          <span className="hidden text-[11px] text-neutral-500 sm:inline">
            {handleHint}
          </span>
        }
        main={main}
        drawer={drawer}
      />
    </div>
  );
}

function DrawerSection({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string | null;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-neutral-200 bg-surface-card open:bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-bold text-brand-900 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate">{title}</span>
            {badge && (
              <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {badge}
              </span>
            )}
          </span>
          {subtitle && (
            <span className="text-[11px] font-normal text-neutral-500">
              {subtitle}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className="shrink-0 text-neutral-400 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-neutral-200 px-3 py-3">{children}</div>
    </details>
  );
}
