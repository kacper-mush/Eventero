"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export type TaskRow = {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  reporter_id: string;
  created_at: string;
};

const uuidSchema = z.string().uuid("Invalid id");
const statusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(200, "Title is too long");
const descriptionSchema = z
  .string()
  .trim()
  .max(4000, "Description is too long")
  .optional();

type OkErr<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.sub;
  if (error || !userId) redirect("/login");
  return { supabase, userId };
}

// Fan out a notification to a recipient. Best-effort; failures are swallowed
// because the underlying mutation has already succeeded — RLS or a race on
// the constraint shouldn't undo a successful task action.
async function notify(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    groupId: string;
    authorId: string;
    recipientId: string;
    kind: "task_assigned" | "task_done";
    taskId: string;
  },
) {
  if (params.recipientId === params.authorId) return; // no self-notify
  await supabase.from("group_notifications").insert({
    group_id: params.groupId,
    author_id: params.authorId,
    mentioned_user_id: params.recipientId,
    kind: params.kind,
    task_id: params.taskId,
  });
}

export async function createTask(
  groupId: string,
  input: { title: string; description?: string; assigneeId?: string | null },
): Promise<OkErr<TaskRow>> {
  const { supabase, userId } = await requireUser();

  const grp = uuidSchema.safeParse(groupId);
  if (!grp.success) return { ok: false, error: "Invalid group" };
  const title = titleSchema.safeParse(input.title);
  if (!title.success) {
    return { ok: false, error: title.error.issues[0]?.message ?? "Invalid" };
  }
  const description = descriptionSchema.safeParse(input.description ?? "");
  if (!description.success) {
    return { ok: false, error: description.error.issues[0]?.message ?? "Invalid" };
  }

  let assigneeId: string | null = null;
  if (input.assigneeId) {
    const a = uuidSchema.safeParse(input.assigneeId);
    if (!a.success) return { ok: false, error: "Invalid assignee" };
    assigneeId = a.data;
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      group_id: grp.data,
      title: title.data,
      description: description.data || null,
      reporter_id: userId,
      assignee_id: assigneeId,
      status: "TODO",
    })
    .select(
      "id, group_id, title, description, status, assignee_id, reporter_id, created_at",
    )
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Create failed" };
  }

  if (assigneeId && assigneeId !== userId) {
    await notify(supabase, {
      groupId: grp.data,
      authorId: userId,
      recipientId: assigneeId,
      kind: "task_assigned",
      taskId: data.id,
    });
  }

  return { ok: true, data: data as TaskRow };
}

export async function updateTask(
  taskId: string,
  patch: { title?: string; description?: string | null },
): Promise<OkErr<TaskRow>> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(taskId);
  if (!id.success) return { ok: false, error: "Invalid task" };

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = titleSchema.safeParse(patch.title);
    if (!t.success) return { ok: false, error: t.error.issues[0]?.message ?? "Invalid" };
    update.title = t.data;
  }
  if (patch.description !== undefined) {
    if (patch.description === null || patch.description.trim() === "") {
      update.description = null;
    } else {
      const d = descriptionSchema.safeParse(patch.description);
      if (!d.success) return { ok: false, error: d.error.issues[0]?.message ?? "Invalid" };
      update.description = d.data;
    }
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, error: "Nothing to update" };
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id.data)
    .select(
      "id, group_id, title, description, status, assignee_id, reporter_id, created_at",
    )
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Update failed" };
  }
  return { ok: true, data: data as TaskRow };
}

export async function moveTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<OkErr<TaskRow>> {
  const { supabase, userId } = await requireUser();
  const id = uuidSchema.safeParse(taskId);
  if (!id.success) return { ok: false, error: "Invalid task" };
  const s = statusSchema.safeParse(status);
  if (!s.success) return { ok: false, error: "Invalid status" };

  // Read prior status so we can detect TODO/IN_PROGRESS -> DONE transitions
  // for the reporter notification.
  const { data: before } = await supabase
    .from("tasks")
    .select("status, reporter_id, group_id")
    .eq("id", id.data)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: s.data })
    .eq("id", id.data)
    .select(
      "id, group_id, title, description, status, assignee_id, reporter_id, created_at",
    )
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Move failed" };
  }

  if (
    before &&
    before.status !== "DONE" &&
    s.data === "DONE" &&
    before.reporter_id
  ) {
    await notify(supabase, {
      groupId: before.group_id as string,
      authorId: userId,
      recipientId: before.reporter_id as string,
      kind: "task_done",
      taskId: data.id,
    });
  }

  return { ok: true, data: data as TaskRow };
}

export async function assignTask(
  taskId: string,
  assigneeId: string | null,
): Promise<OkErr<TaskRow>> {
  const { supabase, userId } = await requireUser();
  const id = uuidSchema.safeParse(taskId);
  if (!id.success) return { ok: false, error: "Invalid task" };
  if (assigneeId !== null) {
    const a = uuidSchema.safeParse(assigneeId);
    if (!a.success) return { ok: false, error: "Invalid assignee" };
  }

  const { data: before } = await supabase
    .from("tasks")
    .select("assignee_id, group_id")
    .eq("id", id.data)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tasks")
    .update({ assignee_id: assigneeId })
    .eq("id", id.data)
    .select(
      "id, group_id, title, description, status, assignee_id, reporter_id, created_at",
    )
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Assign failed" };
  }

  if (
    assigneeId &&
    before?.assignee_id !== assigneeId &&
    assigneeId !== userId
  ) {
    await notify(supabase, {
      groupId: data.group_id,
      authorId: userId,
      recipientId: assigneeId,
      kind: "task_assigned",
      taskId: data.id,
    });
  }

  return { ok: true, data: data as TaskRow };
}

export async function deleteTask(
  taskId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(taskId);
  if (!id.success) return { ok: false, error: "Invalid task" };

  const { error } = await supabase.from("tasks").delete().eq("id", id.data);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setTaskReporter(
  taskId: string,
  reporterId: string,
): Promise<OkErr<TaskRow>> {
  const { supabase } = await requireUser();
  const id = uuidSchema.safeParse(taskId);
  if (!id.success) return { ok: false, error: "Invalid task" };
  const r = uuidSchema.safeParse(reporterId);
  if (!r.success) return { ok: false, error: "Invalid reporter" };

  const { data, error } = await supabase
    .from("tasks")
    .update({ reporter_id: r.data })
    .eq("id", id.data)
    .select(
      "id, group_id, title, description, status, assignee_id, reporter_id, created_at",
    )
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Reporter change failed" };
  }
  return { ok: true, data: data as TaskRow };
}
