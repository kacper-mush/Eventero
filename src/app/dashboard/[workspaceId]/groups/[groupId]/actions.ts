"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

import type { ActionState } from "../../../actions";

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
  const userId = data?.claims?.sub;
  if (error || !userId) {
    redirect("/login");
  }
  return { supabase, userId };
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
  return { ok: true };
}
