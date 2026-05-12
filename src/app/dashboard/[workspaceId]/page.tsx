import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { emailToHandle } from "@/lib/mentions";
import { createClient } from "@/lib/supabase/server";

import { getWorkspaceMembers } from "../actions";
import {
  deleteChannelMessage,
  editChannelMessage,
  sendChannelMessage,
  type ChannelMention,
} from "./channel-actions";
import { ChannelMentionsList } from "./channel-mentions";
import { ChatWindow } from "./groups/[groupId]/chat";
import type { ChatMessage } from "./groups/[groupId]/actions";
import { GroupShell } from "./groups/[groupId]/drawer";

export default async function WorkspaceChannelPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  const userEmail =
    typeof claimsData?.claims?.email === "string"
      ? claimsData.claims.email
      : "";
  if (!userId) redirect("/login");

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!workspace) notFound();

  const members = await getWorkspaceMembers(workspaceId);
  const me = members.find((m) => m.user_id === userId);
  if (!me) notFound();

  const memberEmailRecord: Record<string, string> = Object.fromEntries(
    members.map((m) => [m.user_id, m.email]),
  );

  const { data: channel, error: channelErr } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspace.id)
    .is("group_id", null)
    .maybeSingle();
  if (channelErr) throw new Error(channelErr.message);

  let initialMessages: ChatMessage[] = [];
  let initialMentions: ChannelMention[] = [];
  if (channel) {
    const [msgsRes, mentionsRes] = await Promise.all([
      supabase
        .from("messages")
        .select("id, channel_id, author_id, body, created_at, edited_at")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50),
      supabase
        .from("channel_mentions")
        .select("id, channel_id, message_id, author_id, seen_at, created_at, messages(body)")
        .eq("channel_id", channel.id)
        .eq("mentioned_user_id", userId)
        .order("created_at", { ascending: false }),
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
      .reverse();

    initialMentions = ((mentionsRes.data ?? []) as Array<{
      id: string;
      channel_id: string;
      message_id: number;
      author_id: string;
      seen_at: string | null;
      created_at: string;
      messages: { body: string } | { body: string }[] | null;
    }>).map((m) => {
      const msg = Array.isArray(m.messages) ? m.messages[0] : m.messages;
      return {
        id: m.id,
        channel_id: m.channel_id,
        message_id: m.message_id,
        author_id: m.author_id,
        author_email: memberEmailRecord[m.author_id] ?? "(unknown)",
        body: msg?.body ?? "(message unavailable)",
        seen_at: m.seen_at,
        created_at: m.created_at,
      };
    });
  }

  const handleHint = `Tip — your handle is @${emailToHandle(userEmail)}`;
  const unreadMentionCount = initialMentions.filter(
    (m) => m.seen_at === null,
  ).length;

  const main = channel ? (
    <ChatWindow
      channelId={channel.id}
      initialMessages={initialMessages}
      viewerUserId={userId}
      viewerEmail={userEmail}
      memberEmails={memberEmailRecord}
      actions={{
        send: sendChannelMessage.bind(null, workspace.id),
        edit: editChannelMessage.bind(null, workspace.id),
        remove: deleteChannelMessage.bind(null, workspace.id),
      }}
    />
  ) : (
    <div className="flex h-full items-center justify-center p-8 text-sm text-neutral-500">
      The general channel isn&apos;t available yet.
    </div>
  );

  const drawer = (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {workspace.name}
        </p>
        <h2 className="text-base font-bold text-brand-900"># general</h2>
        <p className="text-[11px] text-neutral-500">
          The workspace-wide channel — everyone here can read and post.
        </p>
        <Link
          href={`/dashboard/${workspace.id}/settings`}
          className="mt-1 self-start rounded border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 transition hover:bg-neutral-100"
        >
          Workspace settings
        </Link>
      </div>

      {channel && (
        <ChannelDrawerSection
          title="Mentions & activity"
          subtitle="@mentions for you in this channel."
          badge={unreadMentionCount > 0 ? String(unreadMentionCount) : null}
          defaultOpen
        >
          <ChannelMentionsList
            channelId={channel.id}
            viewerUserId={userId}
            authorEmails={memberEmailRecord}
            initial={initialMentions}
          />
        </ChannelDrawerSection>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GroupShell
        groupName="general"
        detailsLabel="Channel details"
        header={
          <span className="hidden flex-1 truncate text-[11px] text-neutral-500 sm:inline">
            {handleHint}
          </span>
        }
        main={main}
        drawer={drawer}
      />
    </div>
  );
}

function ChannelDrawerSection({
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
