"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useState } from "react";

import {
  createWorkspace,
  signOut,
  type ActionState,
  type Workspace,
} from "./actions";
import { Modal, SubmitButton } from "./ui";

export function Sidebar({
  workspaces,
  email,
}: {
  workspaces: Workspace[];
  email: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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

      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
          Workspaces
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
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
              const active = pathname?.startsWith(`/dashboard/${ws.id}`);
              return (
                <li key={ws.id}>
                  <Link
                    href={`/dashboard/${ws.id}`}
                    aria-current={active ? "page" : undefined}
                    className={`block truncate rounded px-3 py-2 text-sm font-medium transition ${
                      active ? "bg-white/20" : "hover:bg-white/10"
                    }`}
                  >
                    {ws.name}
                  </Link>
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

      {open && <CreateWorkspaceDialog onClose={() => setOpen(false)} />}
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
