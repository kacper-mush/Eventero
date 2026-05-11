"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; error?: string } | null;

export type Workspace = { id: string; name: string };

export type WorkspaceMember = {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "member";
};

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name must be 80 characters or fewer");

const uuidSchema = z.string().uuid("Invalid id");

async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) {
    redirect("/login");
  }
  return { supabase, userId };
}

export async function getWorkspaces(): Promise<Workspace[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("get_workspace_members", {
    _workspace_id: workspaceId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceMember[];
}

export async function createWorkspace(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, userId } = await requireUser();

  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message };
  }

  const { data, error } = await supabase
    .from("workspaces")
    .insert({ name: parsed.data, created_by: userId })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/${data.id}`);
}

export async function updateWorkspace(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const id = uuidSchema.safeParse(workspaceId);
  const name = nameSchema.safeParse(formData.get("name"));
  if (!id.success) return { ok: false, error: "Invalid workspace" };
  if (!name.success) {
    return { ok: false, error: name.error.issues[0]?.message };
  }

  const { error } = await supabase
    .from("workspaces")
    .update({ name: name.data })
    .eq("id", id.data);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function deleteWorkspace(
  workspaceId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const id = uuidSchema.safeParse(workspaceId);
  if (!id.success) return { ok: false, error: "Invalid workspace" };

  const { error } = await supabase.from("workspaces").delete().eq("id", id.data);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

export async function leaveWorkspace(
  workspaceId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const id = uuidSchema.safeParse(workspaceId);
  if (!id.success) return { ok: false, error: "Invalid workspace" };

  const { error } = await supabase.rpc("leave_workspace", {
    _workspace_id: id.data,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

export async function transferOwnership(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const id = uuidSchema.safeParse(workspaceId);
  const newOwnerId = uuidSchema.safeParse(formData.get("newOwnerId"));
  if (!id.success) return { ok: false, error: "Invalid workspace" };
  if (!newOwnerId.success) {
    return { ok: false, error: "Select a member to transfer ownership to" };
  }

  const { error } = await supabase.rpc("transfer_workspace_ownership", {
    _workspace_id: id.data,
    _new_owner_id: newOwnerId.data,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/${id.data}`);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
