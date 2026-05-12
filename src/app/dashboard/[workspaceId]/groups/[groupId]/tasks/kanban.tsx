"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { createClient } from "@/lib/supabase/client";

import {
  assignTask as assignTaskAction,
  createTask as createTaskAction,
  deleteTask as deleteTaskAction,
  moveTaskStatus as moveTaskStatusAction,
  setTaskReporter as setTaskReporterAction,
  updateTask as updateTaskAction,
  type TaskRow,
  type TaskStatus,
} from "./actions";
import {
  canChangeReporter as canChangeReporterFn,
  canDeleteTask as canDeleteTaskFn,
  canEditMeta as canEditMetaFn,
  canSetAssignee as canSetAssigneeFn,
} from "./permissions";

type Member = { user_id: string; email: string; role?: "manager" | "member" };

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: "TODO", title: "To do" },
  { id: "IN_PROGRESS", title: "In progress" },
  { id: "DONE", title: "Done" },
];

export function KanbanBoard({
  groupId,
  viewerUserId,
  canCreate,
  isGroupManager,
  isWorkspaceAdmin,
  initialTasks,
  workspaceMembers,
  groupMembers,
}: {
  groupId: string;
  viewerUserId: string;
  canCreate: boolean;
  isGroupManager: boolean;
  isWorkspaceAdmin: boolean;
  initialTasks: TaskRow[];
  workspaceMembers: Member[];
  groupMembers: Member[];
}) {
  const [tasks, setTasks] = useState<Map<string, TaskRow>>(
    () => new Map(initialTasks.map((t) => [t.id, t])),
  );
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const emailByUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of workspaceMembers) m.set(u.user_id, u.email);
    return m;
  }, [workspaceMembers]);

  // Realtime subscription on tasks for this group.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`tasks:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (!old.id) return;
            setTasks((prev) => {
              if (!prev.has(old.id!)) return prev;
              const next = new Map(prev);
              next.delete(old.id!);
              return next;
            });
            return;
          }
          const row = payload.new as TaskRow;
          setTasks((prev) => {
            const next = new Map(prev);
            next.set(row.id, row);
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);

  const tasksByColumn = useMemo(() => {
    const by: Record<TaskStatus, TaskRow[]> = {
      TODO: [],
      IN_PROGRESS: [],
      DONE: [],
    };
    for (const t of tasks.values()) by[t.status].push(t);
    for (const k of Object.keys(by) as TaskStatus[]) {
      by[k].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return by;
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const [, startTransition] = useTransition();

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const taskId = event.active.id as string;
      const overId = event.over?.id as TaskStatus | undefined;
      if (!overId) return;
      const current = tasks.get(taskId);
      if (!current || current.status === overId) return;

      // Optimistic update.
      setTasks((prev) => {
        const next = new Map(prev);
        const t = next.get(taskId);
        if (!t) return prev;
        next.set(taskId, { ...t, status: overId });
        return next;
      });

      startTransition(async () => {
        const res = await moveTaskStatusAction(taskId, overId);
        if (!res.ok) {
          setError(res.error);
          // Roll back.
          setTasks((prev) => {
            const next = new Map(prev);
            const t = next.get(taskId);
            if (!t) return prev;
            next.set(taskId, { ...t, status: current.status });
            return next;
          });
        }
      });
    },
    [tasks],
  );

  const openTask = openTaskId ? tasks.get(openTaskId) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-surface-card px-6 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand-900">
            Tasks
          </h2>
          <span className="text-xs text-neutral-500">
            {tasks.size} total
          </span>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            + New task
          </button>
        ) : (
          <span className="text-[11px] text-neutral-500">
            Managers and workspace admins can create tasks.
          </span>
        )}
      </div>

      {error && (
        <p className="border-b border-red-200 bg-red-50 px-6 py-1.5 text-xs text-red-700">
          {error}
        </p>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto px-4 py-4">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={tasksByColumn[col.id]}
              activeDragId={activeDragId}
              emailByUser={emailByUser}
              onOpenTask={setOpenTaskId}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragId
            ? (() => {
                const t = tasks.get(activeDragId);
                if (!t) return null;
                const email = t.assignee_id
                  ? emailByUser.get(t.assignee_id) ?? null
                  : null;
                return <TaskCardPreview task={t} assigneeEmail={email} />;
              })()
            : null}
        </DragOverlay>
      </DndContext>

      {creating && (
        <CreateTaskModal
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setTasks((prev) => {
              const next = new Map(prev);
              next.set(t.id, t);
              return next;
            });
            setCreating(false);
          }}
          groupId={groupId}
          assignableMembers={
            isGroupManager || isWorkspaceAdmin ? workspaceMembers : []
          }
        />
      )}

      {openTask && (
        <TaskDetailModal
          task={openTask}
          viewerUserId={viewerUserId}
          isGroupManager={isGroupManager}
          isWorkspaceAdmin={isWorkspaceAdmin}
          workspaceMembers={workspaceMembers}
          groupMembers={groupMembers}
          emailByUser={emailByUser}
          onClose={() => setOpenTaskId(null)}
          onLocalChange={(t) => {
            setTasks((prev) => {
              const next = new Map(prev);
              next.set(t.id, t);
              return next;
            });
          }}
          onLocalDelete={(taskId) => {
            setTasks((prev) => {
              if (!prev.has(taskId)) return prev;
              const next = new Map(prev);
              next.delete(taskId);
              return next;
            });
            setOpenTaskId(null);
          }}
        />
      )}
    </div>
  );
}

function KanbanColumn({
  column,
  tasks,
  activeDragId,
  emailByUser,
  onOpenTask,
}: {
  column: { id: TaskStatus; title: string };
  tasks: TaskRow[];
  activeDragId: string | null;
  emailByUser: Map<string, string>;
  onOpenTask: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-surface-app ${
        isOver
          ? "border-brand-400 ring-2 ring-brand-200"
          : "border-neutral-200"
      }`}
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-brand-900">
          {column.title}
        </span>
        <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-neutral-700">
          {tasks.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 px-3 py-6 text-center text-[11px] text-neutral-400">
            Drop tasks here
          </p>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              isDragSource={activeDragId === t.id}
              assigneeEmail={
                t.assignee_id ? emailByUser.get(t.assignee_id) ?? null : null
              }
              onOpen={() => onOpenTask(t.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  isDragSource,
  assigneeEmail,
  onOpen,
}: {
  task: TaskRow;
  isDragSource: boolean;
  assigneeEmail: string | null;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      className={`group rounded border bg-white p-2 text-xs shadow-sm transition-opacity ${
        isDragSource
          ? "border-dashed border-brand-300 opacity-30"
          : "border-neutral-200 hover:border-brand-300"
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag"
          className="mt-0.5 cursor-grab select-none text-neutral-400 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 text-left"
        >
          <p className="font-semibold text-brand-900">{task.title}</p>
          {task.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-600">
              {task.description}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <Avatar email={assigneeEmail} />
            <span className="text-[10px] text-neutral-500">
              {assigneeEmail ?? "Unassigned"}
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}

// Visual clone rendered by DragOverlay so the dragged card always sits above
// columns (DragOverlay portals into a top-level element, escaping the column
// stacking contexts that previously hid the card during drag).
function TaskCardPreview({
  task,
  assigneeEmail,
}: {
  task: TaskRow;
  assigneeEmail: string | null;
}) {
  return (
    <div className="w-72 cursor-grabbing rounded border border-brand-400 bg-white p-2 text-xs shadow-lg ring-2 ring-brand-200">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 select-none text-neutral-400">
          ⋮⋮
        </span>
        <div className="flex-1">
          <p className="font-semibold text-brand-900">{task.title}</p>
          {task.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-600">
              {task.description}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <Avatar email={assigneeEmail} />
            <span className="text-[10px] text-neutral-500">
              {assigneeEmail ?? "Unassigned"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar({ email }: { email: string | null }) {
  const letter = email ? email[0]?.toUpperCase() ?? "?" : "·";
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
        email ? "bg-brand-100 text-brand-900" : "bg-neutral-100 text-neutral-400"
      }`}
      aria-hidden
    >
      {letter}
    </span>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-brand-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 text-lg text-neutral-500 hover:bg-neutral-100"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateTaskModal({
  groupId,
  assignableMembers,
  onClose,
  onCreated,
}: {
  groupId: string;
  assignableMembers: Member[];
  onClose: () => void;
  onCreated: (t: TaskRow) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createTaskAction(groupId, {
        title,
        description: description.trim() || undefined,
        assigneeId: assigneeId || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.data);
    });
  }

  return (
    <ModalShell title="New task" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold text-neutral-700">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            maxLength={200}
            autoFocus
            required
            className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold text-neutral-700">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={4}
            maxLength={4000}
            className="resize-y rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        {assignableMembers.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-neutral-700">Assignee</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={busy}
              className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
            >
              <option value="">Unassigned</option>
              {assignableMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.email}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || title.trim().length === 0}
            className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TaskDetailModal({
  task,
  viewerUserId,
  isGroupManager,
  isWorkspaceAdmin,
  workspaceMembers,
  groupMembers,
  emailByUser,
  onClose,
  onLocalChange,
  onLocalDelete,
}: {
  task: TaskRow;
  viewerUserId: string;
  isGroupManager: boolean;
  isWorkspaceAdmin: boolean;
  workspaceMembers: Member[];
  groupMembers: Member[];
  emailByUser: Map<string, string>;
  onClose: () => void;
  onLocalChange: (t: TaskRow) => void;
  onLocalDelete: (taskId: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keep local state in sync if the task is updated via realtime while open.
  const lastSeenId = useRef(task.id);
  useEffect(() => {
    if (lastSeenId.current !== task.id) {
      lastSeenId.current = task.id;
      setTitle(task.title);
      setDescription(task.description ?? "");
    }
  }, [task]);

  const viewer = { userId: viewerUserId, isGroupManager, isWorkspaceAdmin };
  const canEditMeta = canEditMetaFn(task, viewer);
  const canReassignAnyone = isGroupManager || isWorkspaceAdmin;
  const canSelfAssign = canSetAssigneeFn(task, viewer, viewerUserId);
  const canChangeReporter = canChangeReporterFn(task, viewer);
  const canDelete = canDeleteTaskFn(task, viewer);
  const groupManagers = groupMembers.filter((m) => m.role === "manager");

  function onDelete() {
    if (
      !window.confirm(
        `Delete task "${task.title}"? This can't be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteTaskAction(task.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLocalDelete(task.id);
    });
  }

  function onSaveMeta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const patch: { title?: string; description?: string | null } = {};
    if (title !== task.title) patch.title = title;
    const desc = description.trim();
    const prevDesc = task.description ?? "";
    if (desc !== prevDesc) patch.description = desc === "" ? null : desc;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    startTransition(async () => {
      const res = await updateTaskAction(task.id, patch);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLocalChange(res.data);
    });
  }

  function changeAssignee(newId: string) {
    setError(null);
    const value = newId === "" ? null : newId;
    startTransition(async () => {
      const res = await assignTaskAction(task.id, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLocalChange(res.data);
    });
  }

  function changeReporter(newId: string) {
    setError(null);
    if (!newId) return;
    startTransition(async () => {
      const res = await setTaskReporterAction(task.id, newId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLocalChange(res.data);
    });
  }

  const assigneeEmail = task.assignee_id
    ? emailByUser.get(task.assignee_id) ?? "(unknown)"
    : "Unassigned";

  return (
    <ModalShell title="Task" onClose={onClose}>
      <form onSubmit={onSaveMeta} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold text-neutral-700">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy || !canEditMeta}
            maxLength={200}
            className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 disabled:bg-neutral-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold text-neutral-700">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy || !canEditMeta}
            rows={4}
            maxLength={4000}
            className="resize-y rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 disabled:bg-neutral-50"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-neutral-700">Assignee</span>
            {canReassignAnyone ? (
              <select
                value={task.assignee_id ?? ""}
                onChange={(e) => changeAssignee(e.target.value)}
                disabled={busy}
                className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500"
              >
                <option value="">Unassigned</option>
                {workspaceMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.email}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm">
                <span>{assigneeEmail}</span>
                {task.assignee_id !== viewerUserId && canSelfAssign && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeAssignee(viewerUserId)}
                    className="text-[11px] font-semibold text-brand-700 hover:underline disabled:opacity-50"
                  >
                    Assign me
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-neutral-700">Reporter</span>
            {canChangeReporter ? (
              <select
                value={task.reporter_id}
                onChange={(e) => changeReporter(e.target.value)}
                disabled={busy}
                className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500"
              >
                {groupManagers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.email}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm">
                {emailByUser.get(task.reporter_id) ?? "(unknown)"}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-xs">
          <span className="font-semibold text-neutral-700">Status</span>
          <span className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm">
            {task.status === "TODO"
              ? "To do"
              : task.status === "IN_PROGRESS"
                ? "In progress"
                : "Done"}{" "}
            <span className="text-[10px] text-neutral-500">
              (drag the card on the board to change status)
            </span>
          </span>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                Delete task
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium"
            >
              Close
            </button>
            {canEditMeta && (
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
