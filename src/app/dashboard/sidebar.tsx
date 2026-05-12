"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useState } from "react";

import {
  createGroup,
  createWorkspace,
  signOut,
  type ActionState,
  type Group,
  type Workspace,
} from "./actions";
import { Modal, SubmitButton } from "./ui";

export function Sidebar({
  workspaces,
  groups,
  email,
  unreadNotificationCount,
  adminWorkspaceIds,
}: {
  workspaces: Workspace[];
  groups: Group[];
  email: string;
  unreadNotificationCount: number;
  adminWorkspaceIds: string[];
}) {
  const pathname = usePathname();
  const onNotifications = pathname === "/dashboard/notifications";
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newGroupWorkspaceId, setNewGroupWorkspaceId] = useState<string | null>(
    null,
  );
  const adminSet = new Set(adminWorkspaceIds);

  const activeWorkspaceId = pathname?.match(
    /^\/dashboard\/([0-9a-f-]{36})/,
  )?.[1];
  const activeGroupId = pathname?.match(
    /\/groups\/([0-9a-f-]{36})/,
  )?.[1];

  const groupsByWorkspace = new Map<string, Group[]>();
  for (const g of groups) {
    const list = groupsByWorkspace.get(g.workspace_id) ?? [];
    list.push(g);
    groupsByWorkspace.set(g.workspace_id, list);
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-brand-600 text-white">
      <div className="px-4 py-4">
        <Link
          href="/dashboard"
          className="text-lg font-bold tracking-tight text-white"
        >
          Eventero
        </Link>
      </div>

      <Link
        href="/dashboard/notifications"
        aria-current={onNotifications ? "page" : undefined}
        className={`mx-2 mb-3 flex items-center justify-between rounded px-3 py-2 text-sm font-medium transition ${
          onNotifications ? "bg-white/20" : "hover:bg-white/10"
        }`}
      >
        <span>Notifications</span>
        {unreadNotificationCount > 0 && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-brand-700">
            {unreadNotificationCount}
          </span>
        )}
      </Link>

      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
          Workspaces
        </span>
        <button
          type="button"
          onClick={() => setNewWorkspaceOpen(true)}
          aria-label="Create workspace"
          className="flex h-6 w-6 items-center justify-center rounded text-base font-bold transition hover:bg-white/10"
        >
          +
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        {workspaces.length === 0 ? (
          <p className="px-2 py-3 text-xs text-white/70">No workspaces yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {workspaces.map((ws) => {
              const isActive = activeWorkspaceId === ws.id;
              const workspaceGroups = groupsByWorkspace.get(ws.id) ?? [];
              const onChannel =
                isActive &&
                !pathname?.includes("/groups/") &&
                !pathname?.endsWith("/settings");
              const onSettings = isActive && pathname?.endsWith("/settings");
              return (
                <li key={ws.id}>
                  <Link
                    href={`/dashboard/${ws.id}`}
                    className={`block truncate rounded px-3 py-2 text-sm font-medium transition ${
                      isActive ? "bg-white/15" : "hover:bg-white/10"
                    }`}
                  >
                    {ws.name}
                  </Link>

                  {isActive && (
                    <div className="mt-1 mb-2 ml-2 border-l border-white/15 pl-2">
                      <Link
                        href={`/dashboard/${ws.id}`}
                        aria-current={onChannel ? "page" : undefined}
                        className={`block truncate rounded px-2 py-1 text-xs transition ${
                          onChannel
                            ? "bg-white/20 font-semibold"
                            : "hover:bg-white/10"
                        }`}
                      >
                        # general
                      </Link>
                      <Link
                        href={`/dashboard/${ws.id}/settings`}
                        aria-current={onSettings ? "page" : undefined}
                        className={`block truncate rounded px-2 py-1 text-xs transition ${
                          onSettings
                            ? "bg-white/20 font-semibold"
                            : "hover:bg-white/10"
                        }`}
                      >
                        Settings
                      </Link>
                      <div className="flex items-center justify-between px-1 pt-2 pb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">
                          Groups
                        </span>
                        {adminSet.has(ws.id) && (
                          <button
                            type="button"
                            onClick={() => setNewGroupWorkspaceId(ws.id)}
                            aria-label="Create group"
                            className="flex h-5 w-5 items-center justify-center rounded text-sm font-bold transition hover:bg-white/10"
                          >
                            +
                          </button>
                        )}
                      </div>
                      {workspaceGroups.length === 0 ? (
                        <p className="px-1 py-1 text-[11px] text-white/60">
                          No groups yet.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {workspaceGroups.map((g) => {
                            const onGroup = activeGroupId === g.id;
                            return (
                              <li key={g.id}>
                                <Link
                                  href={`/dashboard/${ws.id}/groups/${g.id}`}
                                  aria-current={
                                    onGroup ? "page" : undefined
                                  }
                                  className={`block truncate rounded px-2 py-1 text-xs transition ${
                                    onGroup
                                      ? "bg-white/20 font-semibold"
                                      : "hover:bg-white/10"
                                  }`}
                                >
                                  # {g.name}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <form
        action={signOut}
        className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3"
      >
        <span className="truncate text-xs text-white/80" title={email}>
          {email}
        </span>
        <button
          type="submit"
          className="text-xs text-white/90 underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </form>

      {newWorkspaceOpen && (
        <CreateWorkspaceDialog onClose={() => setNewWorkspaceOpen(false)} />
      )}
      {newGroupWorkspaceId && (
        <CreateGroupDialog
          workspaceId={newGroupWorkspaceId}
          onClose={() => setNewGroupWorkspaceId(null)}
        />
      )}
    </aside>
  );
}

function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [state, action] = useActionState<ActionState, FormData>(
    createWorkspace,
    null,
  );

  return (
    <Modal title="Create workspace" onClose={onClose}>
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            name="name"
            required
            autoFocus
            maxLength={80}
            placeholder="e.g. Summer Festival 2026"
            className="rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        {state?.error && (
          <p className="text-xs text-red-600">{state.error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium"
          >
            Cancel
          </button>
          <SubmitButton>Create</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function CreateGroupDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    createGroup.bind(null, workspaceId),
    null,
  );

  return (
    <Modal title="Create group" onClose={onClose}>
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            name="name"
            required
            autoFocus
            maxLength={80}
            placeholder="e.g. Catering, Stage Crew"
            className="rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        {state?.error && (
          <p className="text-xs text-red-600">{state.error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium"
          >
            Cancel
          </button>
          <SubmitButton>Create</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
