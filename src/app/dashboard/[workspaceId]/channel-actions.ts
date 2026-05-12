"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { emailToHandle, parseMentions } from "@/lib/mentions";
import { createClient } from "@/lib/supabase/server";

import type { ChatMessage } from "./groups/[groupId]/actions";

export type ChannelMention = {
  id: string;
  channel_id: string;
  message_id: number;
  author_id: string;
  author_email: string;
  // The mentioning message's body.
  body: string;
  seen_at: string | null;
  created_at: string;
};

const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Message can't be empty")
  .max(4000, "Message is too long");

const uuidSchema = z.string().uuid("Invalid id");

async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.sub;
  if (error || !userId) {
    redirect("/login");
  }
  const email = typeof claims?.email === "string" ? claims.email : "";
  return { supabase, userId, email };
}

// Resolve the workspace's single group-less channel ("general").
async function getGlobalChannelId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("group_id", null)
    .maybeSingle();
  if (error || !data) return null;
  return data.id;
}

type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

export async function sendChannelMessage(
  workspaceId: string,
  rawBody: string,
): Promise<SendResult> {
  const { supabase, userId, email } = await requireUser();

  const ws = uuidSchema.safeParse(workspaceId);
  if (!ws.success) return { ok: false, error: "Invalid workspace" };
  const body = messageBodySchema.safeParse(rawBody);
  if (!body.success) {
    return { ok: false, error: body.error.issues[0]?.message ?? "Invalid" };
  }

  const channelId = await getGlobalChannelId(supabase, ws.data);
  if (!channelId) return { ok: false, error: "Channel not found" };

  const { data: inserted, error: insertErr } = await supabase
    .from("messages")
    .insert({ channel_id: channelId, author_id: userId, body: body.data })
    .select("id, channel_id, author_id, body, created_at, edited_at")
    .single();
  if (insertErr || !inserted) {
    return { ok: false, error: insertErr?.message ?? "Send failed" };
  }

  // Fan out @mentions into the channel's drawer mailbox. Best-effort — the
  // message itself already went through, so we still return it on failure.
  const handles = parseMentions(body.data);
  if (handles.length > 0) {
    const { data: members } = await supabase.rpc("get_workspace_members", {
      _workspace_id: ws.data,
    });
    const recipients = ((members ?? []) as { user_id: string; email: string }[])
      .filter(
        (m) => m.user_id !== userId && handles.includes(emailToHandle(m.email)),
      )
      .map((m) => ({
        channel_id: channelId,
        message_id: inserted.id,
        mentioned_user_id: m.user_id,
        author_id: userId,
      }));
    if (recipients.length > 0) {
      await supabase.from("channel_mentions").insert(recipients);
    }
  }

  return {
    ok: true,
    message: {
      id: inserted.id,
      channel_id: inserted.channel_id,
      author_id: inserted.author_id,
      author_email: email,
      body: inserted.body,
      created_at: inserted.created_at,
      edited_at: inserted.edited_at,
    },
  };
}

export async function editChannelMessage(
  workspaceId: string,
  messageId: number,
  rawBody: string,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; error: string }> {
  const { supabase, userId, email } = await requireUser();
  void workspaceId;

  const body = messageBodySchema.safeParse(rawBody);
  if (!body.success) {
    return { ok: false, error: body.error.issues[0]?.message ?? "Invalid" };
  }

  const { data: updated, error } = await supabase
    .from("messages")
    .update({ body: body.data, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("author_id", userId)
    .select("id, channel_id, author_id, body, created_at, edited_at")
    .single();
  if (error || !updated) {
    return { ok: false, error: error?.message ?? "Edit failed" };
  }
  return {
    ok: true,
    message: {
      id: updated.id,
      channel_id: updated.channel_id,
      author_id: updated.author_id,
      author_email: email,
      body: updated.body,
      created_at: updated.created_at,
      edited_at: updated.edited_at,
    },
  };
}

export async function deleteChannelMessage(
  workspaceId: string,
  messageId: number,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  void workspaceId;
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", messageId)
    .eq("author_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function markChannelMentionSeen(
  mentionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(mentionId);
  if (!id.success) return { ok: false, error: "Invalid mention" };
  const { error } = await supabase
    .from("channel_mentions")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("seen_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteChannelMention(
  mentionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(mentionId);
  if (!id.success) return { ok: false, error: "Invalid mention" };
  const { error } = await supabase
    .from("channel_mentions")
    .delete()
    .eq("id", id.data);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
