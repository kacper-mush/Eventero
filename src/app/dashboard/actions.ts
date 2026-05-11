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

export type Group = { id: string; workspace_id: string; name: string };

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

export async function getGroups(): Promise<Group[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("groups")
    .select("id, workspace_id, name")
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

  // 1. Generate the ID ahead of time
  const workspaceId = crypto.randomUUID();

  // 2. Insert without calling .select().single()
  const { error } = await supabase
    .from("workspaces")
    .insert({ id: workspaceId, name: parsed.data, created_by: userId });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/${workspaceId}`);
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

export async function createGroup(
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

  const groupId = crypto.randomUUID();
  const { error } = await supabase
    .from("groups")
    .insert({ id: groupId, workspace_id: id.data, name: name.data });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/${id.data}/groups/${groupId}`);
}

export type WorkspaceInvitation = {
  id: string;
  email: string;
  workspace_role: "admin" | "member";
  expires_at: string;
  created_at: string;
  invited_by_email: string | null;
};

export type Notification = {
  id: string;
  type: "workspace_invitation";
  read_at: string | null;
  created_at: string;
  invitation_id: string | null;
  invitation_status:
    | "pending"
    | "accepted"
    | "declined"
    | "revoked"
    | "expired"
    | null;
  invitation_expires_at: string | null;
  invitation_role: "admin" | "member" | null;
  workspace_id: string | null;
  workspace_name: string | null;
  inviter_email: string | null;
};

const emailSchema = z
  .string()
  .trim()
  .min(3, "Email is required")
  .max(254, "Email is too long")
  .email("Enter a valid email");

const roleSchema = z.enum(["admin", "member"]);

// Map Postgres RAISE errors from the invitation RPCs to UI strings. The RPC
// raises `exception '<code>'`; postgres-js surfaces it on `error.message`.
function invitationErrorMessage(message: string): string {
  if (message.includes("no_account")) {
    return "No Eventero account is registered with that email.";
  }
  if (message.includes("already_member")) {
    return "That user already belongs to this workspace.";
  }
  if (message.includes("already_invited")) {
    return "A pending invitation for that email already exists.";
  }
  if (message.includes("cannot invite yourself")) {
    return "You cannot invite yourself.";
  }
  if (message.includes("invitation_expired")) {
    return "This invitation has expired.";
  }
  if (message.includes("invitation_not_pending")) {
    return "This invitation is no longer pending.";
  }
  if (message.includes("invitation_not_yours")) {
    return "This invitation is not addressed to you.";
  }
  if (message.includes("invitation_not_found")) {
    return "Invitation not found.";
  }
  if (message.includes("only workspace admins")) {
    return "Only workspace admins can do this.";
  }
  return message;
}

export async function getWorkspacePendingInvitations(
  workspaceId: string,
): Promise<WorkspaceInvitation[]> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(workspaceId);
  if (!id.success) return [];

  const { data, error } = await supabase.rpc(
    "get_workspace_pending_invitations",
    { _workspace_id: id.data },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceInvitation[];
}

export async function getNotifications(): Promise<Notification[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("get_my_notifications");
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { supabase } = await requireUser();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function sendWorkspaceInvitation(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const id = uuidSchema.safeParse(workspaceId);
  const email = emailSchema.safeParse(formData.get("email"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!id.success) return { ok: false, error: "Invalid workspace" };
  if (!email.success) {
    return { ok: false, error: email.error.issues[0]?.message };
  }
  if (!role.success) return { ok: false, error: "Select a role" };

  const { error } = await supabase.rpc("send_workspace_invitation", {
    _workspace_id: id.data,
    _email: email.data,
    _role: role.data,
  });
  if (error) {
    return { ok: false, error: invitationErrorMessage(error.message) };
  }

  revalidatePath(`/dashboard/${id.data}`);
  return { ok: true };
}

export async function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const ws = uuidSchema.safeParse(workspaceId);
  const inv = uuidSchema.safeParse(invitationId);
  if (!ws.success) return { ok: false, error: "Invalid workspace" };
  if (!inv.success) return { ok: false, error: "Invalid invitation" };

  const { error } = await supabase.rpc("revoke_workspace_invitation", {
    _invitation_id: inv.data,
  });
  if (error) {
    return { ok: false, error: invitationErrorMessage(error.message) };
  }

  revalidatePath(`/dashboard/${ws.data}`);
  return { ok: true };
}

export async function acceptInvitation(
  invitationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const inv = uuidSchema.safeParse(invitationId);
  if (!inv.success) return { ok: false, error: "Invalid invitation" };

  const { data, error } = await supabase.rpc("accept_workspace_invitation", {
    _invitation_id: inv.data,
  });
  if (error) {
    return { ok: false, error: invitationErrorMessage(error.message) };
  }

  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/notifications");
  if (typeof data === "string") {
    redirect(`/dashboard/${data}`);
  }
  return { ok: true };
}

export async function declineInvitation(
  invitationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const inv = uuidSchema.safeParse(invitationId);
  if (!inv.success) return { ok: false, error: "Invalid invitation" };

  const { error } = await supabase.rpc("decline_workspace_invitation", {
    _invitation_id: inv.data,
  });
  if (error) {
    return { ok: false, error: invitationErrorMessage(error.message) };
  }

  revalidatePath("/dashboard/notifications");
  return { ok: true };
}

export async function markNotificationRead(
  notificationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();

  const id = uuidSchema.safeParse(notificationId);
  if (!id.success) return { ok: false, error: "Invalid notification" };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
