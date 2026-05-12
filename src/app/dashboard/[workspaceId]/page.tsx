import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { emailToHandle } from "@/lib/mentions";
import { createClient } from "@/lib/supabase/server";

import { getWorkspaceMembers } from "../actions";
import {
  deleteChannelMessage,
  editChannelMessage,
  sendChannelMessage,
} from "./channel-actions";
import { ChatWindow } from "./groups/[groupId]/chat";
import type { ChatMessage } from "./groups/[groupId]/actions";

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
  if (channel) {
    const { data: rows, error: msgErr } = await supabase
      .from("messages")
      .select("id, channel_id, author_id, body, created_at, edited_at")
      .eq("channel_id", channel.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (msgErr) throw new Error(msgErr.message);
    initialMessages = ((rows ?? []) as Array<{
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
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-surface-card px-6 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-xl font-bold text-brand-900">#</span>
          <h1 className="truncate text-lg font-bold text-brand-900">general</h1>
          <span className="hidden truncate text-xs text-neutral-500 sm:inline">
            {workspace.name} — everyone in the workspace
          </span>
        </div>
        <span className="hidden text-[11px] text-neutral-500 md:inline">
          Tip — your handle is @{emailToHandle(userEmail)}
        </span>
        <Link
          href={`/dashboard/${workspace.id}/settings`}
          className="shrink-0 rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100"
        >
          Workspace settings
        </Link>
      </header>
      <div className="flex-1 min-h-0">
        {channel ? (
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
        )}
      </div>
    </div>
  );
}
