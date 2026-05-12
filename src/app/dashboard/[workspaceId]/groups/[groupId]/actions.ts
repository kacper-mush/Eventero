"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailToHandle, parseMentions } from "@/lib/mentions";
import { createClient } from "@/lib/supabase/server";

import type { ActionState } from "../../../actions";

export type ChatMessage = {
  id: number;
  channel_id: string;
  author_id: string;
  author_email: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

export type GroupMention = {
  id: string;
  message_id: number;
  group_id: string;
  author_id: string;
  author_email: string;
  body: string;
  seen_at: string | null;
  created_at: string;
};

const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Message can't be empty")
  .max(4000, "Message is too long");

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name must be 80 characters or fewer");

const uuidSchema = z.string().uuid("Invalid id");

const groupRoleSchema = z.enum(["manager", "member"]);

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

export async function renameGroup(
  workspaceId: string,
  groupId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const ws = uuidSchema.safeParse(workspaceId);
  const grp = uuidSchema.safeParse(groupId);
  const name = nameSchema.safeParse(formData.get("name"));
  if (!ws.success || !grp.success) return { ok: false, error: "Invalid group" };
  if (!name.success) {
    return { ok: false, error: name.error.issues[0]?.message };
  }

  const { error } = await supabase
    .from("groups")
    .update({ name: name.data })
    .eq("id", grp.data);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function deleteGroup(
  workspaceId: string,
  groupId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const ws = uuidSchema.safeParse(workspaceId);
  const grp = uuidSchema.safeParse(groupId);
  if (!ws.success || !grp.success) return { ok: false, error: "Invalid group" };

  const { error } = await supabase.from("groups").delete().eq("id", grp.data);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/${ws.data}`);
}

export async function addGroupMember(
  workspaceId: string,
  groupId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const grp = uuidSchema.safeParse(groupId);
  const userId = uuidSchema.safeParse(formData.get("userId"));
  const role = groupRoleSchema.safeParse(formData.get("role"));
  if (!grp.success) return { ok: false, error: "Invalid group" };
  if (!userId.success) return { ok: false, error: "Select a member to add" };
  if (!role.success) return { ok: false, error: "Pick a role" };

  const { error } = await supabase
    .from("group_memberships")
    .insert({ group_id: grp.data, user_id: userId.data, role: role.data });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/${workspaceId}/groups/${grp.data}`);
  // Membership change flips the sidebar's group list for the affected user.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function removeGroupMember(
  workspaceId: string,
  groupId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const grp = uuidSchema.safeParse(groupId);
  const userId = uuidSchema.safeParse(formData.get("userId"));
  if (!grp.success) return { ok: false, error: "Invalid group" };
  if (!userId.success) return { ok: false, error: "Invalid member" };

  const { error } = await supabase
    .from("group_memberships")
    .delete()
    .eq("group_id", grp.data)
    .eq("user_id", userId.data);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/${workspaceId}/groups/${grp.data}`);
  // Membership change flips the sidebar's group list for the affected user.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// =====================================================================
// Chat: send / edit / delete + mention fan-out
// =====================================================================

type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

export async function sendMessage(
  workspaceId: string,
  groupId: string,
  rawBody: string,
): Promise<SendResult> {
  const { supabase, userId, email } = await requireUser();

  const grp = uuidSchema.safeParse(groupId);
  if (!grp.success) return { ok: false, error: "Invalid group" };
  const body = messageBodySchema.safeParse(rawBody);
  if (!body.success) {
    return { ok: false, error: body.error.issues[0]?.message ?? "Invalid" };
  }

  // 1:1 group <-> channel, so look up the channel for this group.
  const { data: channel, error: channelErr } = await supabase
    .from("channels")
    .select("id")
    .eq("group_id", grp.data)
    .maybeSingle();
  if (channelErr) return { ok: false, error: channelErr.message };
  if (!channel) return { ok: false, error: "Channel not found" };

  const { data: inserted, error: insertErr } = await supabase
    .from("messages")
    .insert({
      channel_id: channel.id,
      author_id: userId,
      body: body.data,
    })
    .select("id, channel_id, author_id, body, created_at, edited_at")
    .single();
  if (insertErr || !inserted) {
    return { ok: false, error: insertErr?.message ?? "Send failed" };
  }

  // Fan out mentions. Best-effort — if it errors we still return the message
  // so the sender's UI is consistent; the message itself went through.
  const handles = parseMentions(body.data);
  if (handles.length > 0) {
    const memberRows = await getGroupMemberHandles(supabase, grp.data);
    const recipients = memberRows
      .filter((m) => handles.includes(m.handle) && m.user_id !== userId)
      .map((m) => ({
        group_id: grp.data,
        message_id: inserted.id,
        mentioned_user_id: m.user_id,
        author_id: userId,
      }));
    if (recipients.length > 0) {
      await supabase.from("group_mentions").insert(recipients);
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

async function getGroupMemberHandles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
): Promise<{ user_id: string; handle: string }[]> {
  // get_workspace_members exposes emails for the whole workspace; we filter
  // down to group members. group_memberships -> workspace.id via the group.
  const { data: group } = await supabase
    .from("groups")
    .select("workspace_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return [];

  const [{ data: gm }, { data: members }] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("user_id")
      .eq("group_id", groupId),
    supabase.rpc("get_workspace_members", { _workspace_id: group.workspace_id }),
  ]);

  const groupUserIds = new Set((gm ?? []).map((r) => r.user_id as string));
  return ((members ?? []) as { user_id: string; email: string }[])
    .filter((m) => groupUserIds.has(m.user_id))
    .map((m) => ({ user_id: m.user_id, handle: emailToHandle(m.email) }));
}

export async function editMessage(
  workspaceId: string,
  groupId: string,
  messageId: number,
  rawBody: string,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; error: string }> {
  const { supabase, userId, email } = await requireUser();

  const grp = uuidSchema.safeParse(groupId);
  if (!grp.success) return { ok: false, error: "Invalid group" };
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
  // Suppress unused workspaceId warning while keeping the API symmetrical.
  void workspaceId;
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

export async function deleteMessage(
  workspaceId: string,
  groupId: string,
  messageId: number,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  void workspaceId;
  void groupId;
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", messageId)
    .eq("author_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function markMentionSeen(
  mentionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(mentionId);
  if (!id.success) return { ok: false, error: "Invalid mention" };
  const { error } = await supabase
    .from("group_mentions")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("seen_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteMention(
  mentionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(mentionId);
  if (!id.success) return { ok: false, error: "Invalid mention" };
  const { error } = await supabase
    .from("group_mentions")
    .delete()
    .eq("id", id.data);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setGroupMemberRole(
  workspaceId: string,
  groupId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const grp = uuidSchema.safeParse(groupId);
  const userId = uuidSchema.safeParse(formData.get("userId"));
  const role = groupRoleSchema.safeParse(formData.get("role"));
  if (!grp.success) return { ok: false, error: "Invalid group" };
  if (!userId.success) return { ok: false, error: "Invalid member" };
  if (!role.success) return { ok: false, error: "Pick a role" };

  const { error } = await supabase
    .from("group_memberships")
    .update({ role: role.data })
    .eq("group_id", grp.data)
    .eq("user_id", userId.data);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/${workspaceId}/groups/${grp.data}`);
  // Membership change flips the sidebar's group list for the affected user.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
