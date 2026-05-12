"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import type { MyTask, MyTaskGroup, MyTaskStatus } from "../actions";

const STATUS_ORDER: MyTaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];
const STATUS_LABEL: Record<MyTaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

// Realtime payloads carry the full task row (replica identity full); pick just
// the fields the list renders.
type TaskRowPayload = MyTask & { assignee_id: string | null };

function pickTask(row: TaskRowPayload): MyTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    group_id: row.group_id,
    created_at: row.created_at,
  };
}

export function MyTasksView({
  initialTasks,
  groups,
  userId,
}: {
  initialTasks: MyTask[];
  groups: MyTaskGroup[];
  userId: string;
}) {
  const [tasks, setTasks] = useState<Map<string, MyTask>>(
    () => new Map(initialTasks.map((t) => [t.id, t])),
  );
  const groupById = useMemo(
    () => new Map(groups.map((g) => [g.id, g])),
    [groups],
  );

  // Listen to every task change the viewer's RLS policy lets through (their
  // groups) — no `assignee_id` filter, because a task reassigned *away* from
  // the viewer must also be removed, and a filtered binding would never
  // deliver that update.
  useEffect(() => {
    const supabase = createClient();
    let removed = false;
    const channel = supabase
      .channel(`my-tasks:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks" },
        (payload) => {
          const row = payload.new as TaskRowPayload;
          if (row.assignee_id !== userId) return;
          setTasks((prev) => new Map(prev).set(row.id, pickTask(row)));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload) => {
          const row = payload.new as TaskRowPayload;
          setTasks((prev) => {
            const next = new Map(prev);
            if (row.assignee_id === userId) next.set(row.id, pickTask(row));
            else next.delete(row.id);
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "tasks" },
        (payload) => {
          const old = payload.old as { id?: string };
          if (!old.id) return;
          setTasks((prev) => {
            if (!prev.has(old.id!)) return prev;
            const next = new Map(prev);
            next.delete(old.id!);
            return next;
          });
        },
      );
    // Authenticate the realtime socket before joining (see kanban.tsx) — an
    // anon join gets its postgres_changes bindings rejected.
    supabase.realtime.setAuth().then(() => {
      if (!removed) channel.subscribe();
    });
    return () => {
      removed = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const byStatus = useMemo(() => {
    const m: Record<MyTaskStatus, MyTask[]> = {
      TODO: [],
      IN_PROGRESS: [],
      DONE: [],
    };
    for (const t of tasks.values()) m[t.status].push(t);
    for (const k of STATUS_ORDER) {
      m[k].sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return m;
  }, [tasks]);

  if (tasks.size === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 bg-surface-card p-6 text-sm text-neutral-500">
        Nothing assigned to you right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {STATUS_ORDER.map((status) =>
        byStatus[status].length === 0 ? null : (
          <section key={status} className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-brand-900">
              {STATUS_LABEL[status]}{" "}
              <span className="text-neutral-400">
                ({byStatus[status].length})
              </span>
            </h2>
            <ul className="flex flex-col gap-2">
              {byStatus[status].map((t) => {
                const g = groupById.get(t.group_id);
                return (
                  <li key={t.id}>
                    <Link
                      href={
                        g
                          ? `/dashboard/${g.workspace_id}/groups/${g.id}?view=tasks`
                          : "#"
                      }
                      className="block rounded-lg border border-neutral-200 bg-white p-3 transition hover:border-brand-300"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm font-semibold text-brand-900">
                          {t.title}
                        </span>
                        {g && (
                          <span className="shrink-0 text-[11px] text-neutral-500">
                            {g.workspace_name} · #{g.name}
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-neutral-600">
                          {t.description}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
