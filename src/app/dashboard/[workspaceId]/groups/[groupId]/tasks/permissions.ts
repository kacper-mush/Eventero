// Pure permission helpers for tasks. The authoritative enforcement lives in
// the DB trigger `enforce_task_update_rules()`; these helpers mirror those
// rules so the UI can disable controls the user can't use. Keep them in sync
// with the trigger.

import type { TaskRow } from "./actions";

export type ViewerContext = {
  userId: string;
  isGroupManager: boolean;
  isWorkspaceAdmin: boolean; // owner OR admin
};

export function canCreateTask(viewer: ViewerContext): boolean {
  return viewer.isGroupManager || viewer.isWorkspaceAdmin;
}

export function canEditMeta(task: TaskRow, viewer: ViewerContext): boolean {
  return (
    viewer.isGroupManager ||
    viewer.isWorkspaceAdmin ||
    task.reporter_id === viewer.userId
  );
}

export function canSetAssignee(
  task: TaskRow,
  viewer: ViewerContext,
  newAssigneeId: string | null,
): boolean {
  if (viewer.isGroupManager || viewer.isWorkspaceAdmin) {
    // Manager/admin can set anyone (or null). Caller verifies workspace
    // membership of the target if non-null.
    return true;
  }
  // Members: only self-assign into an empty slot, no clearing.
  if (task.assignee_id !== null) return false;
  return newAssigneeId === viewer.userId;
}

export function canChangeReporter(
  _task: TaskRow,
  viewer: ViewerContext,
): boolean {
  return viewer.isGroupManager;
}

export function canMoveStatus(_task: TaskRow, _viewer: ViewerContext): boolean {
  // Any group member may change status. RLS handles the "group member" check.
  return true;
}

export function canDeleteTask(
  _task: TaskRow,
  viewer: ViewerContext,
): boolean {
  return viewer.isGroupManager || viewer.isWorkspaceAdmin;
}
