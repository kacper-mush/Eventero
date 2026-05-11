"use client";

import { useActionState, useEffect, useState } from "react";

import {
  deleteWorkspace,
  leaveWorkspace,
  transferOwnership,
  updateWorkspace,
  type ActionState,
  type WorkspaceMember,
} from "../actions";
import { Modal, SubmitButton } from "../ui";

export function RenameWorkspaceForm({
  workspaceId,
  currentName,
}: {
  workspaceId: string;
  currentName: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    updateWorkspace.bind(null, workspaceId),
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input
        name="name"
        defaultValue={currentName}
        required
        maxLength={80}
        className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
      <div className="flex items-center gap-2">
        <SubmitButton>Save</SubmitButton>
        {state?.ok && (
          <span className="text-xs text-green-700">Saved</span>
        )}
        {state?.error && (
          <span className="text-xs text-red-600">{state.error}</span>
        )}
      </div>
    </form>
  );
}

export function TransferOwnershipSection({
  workspaceId,
  workspaceName,
  candidates,
}: {
  workspaceId: string;
  workspaceName: string;
  candidates: WorkspaceMember[];
}) {
  const [open, setOpen] = useState(false);
  const hasCandidates = candidates.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!hasCandidates}
        title={
          hasCandidates ? undefined : "Invite another member before transferring"
        }
        className="self-start rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Transfer ownership…
      </button>
      {open && (
        <TransferOwnershipDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          candidates={candidates}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function TransferOwnershipDialog({
  workspaceId,
  workspaceName,
  candidates,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  candidates: WorkspaceMember[];
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    transferOwnership.bind(null, workspaceId),
    null,
  );

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <Modal title={`Transfer ownership of ${workspaceName}`} onClose={onClose}>
      <form action={action} className="flex flex-col gap-3">
        <p className="text-xs text-neutral-600">
          The new owner gains full control. You will become an admin.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">New owner</span>
          <select
            name="newOwnerId"
            required
            defaultValue=""
            className="rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="" disabled>
              Select a member…
            </option>
            {candidates.map((c) => (
              <option key={c.user_id} value={c.user_id}>
                {c.email} ({c.role})
              </option>
            ))}
          </select>
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
          <SubmitButton>Transfer</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function LeaveWorkspaceSection({
  workspaceId,
  workspaceName,
  canLeave,
  isSoleMember,
}: {
  workspaceId: string;
  workspaceName: string;
  canLeave: boolean;
  isSoleMember: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canLeave}
        title={
          canLeave ? undefined : "Transfer ownership before leaving the workspace"
        }
        className="self-start rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Leave workspace…
      </button>
      {open && (
        <LeaveWorkspaceDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          isSoleMember={isSoleMember}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function LeaveWorkspaceDialog({
  workspaceId,
  workspaceName,
  isSoleMember,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  isSoleMember: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    leaveWorkspace.bind(null, workspaceId),
    null,
  );

  return (
    <Modal title={`Leave ${workspaceName}?`} onClose={onClose}>
      <form action={action} className="flex flex-col gap-3">
        <p className="text-sm text-neutral-700">
          {isSoleMember
            ? "You are the only member. Leaving will delete this workspace and everything in it."
            : "You will lose access to this workspace immediately."}
        </p>
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
          <SubmitButton variant="danger">
            {isSoleMember ? "Leave and delete" : "Leave workspace"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteWorkspaceSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
      >
        Delete workspace…
      </button>
      {open && (
        <DeleteWorkspaceDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DeleteWorkspaceDialog({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    deleteWorkspace.bind(null, workspaceId),
    null,
  );
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === workspaceName;

  return (
    <Modal title={`Delete ${workspaceName}?`} onClose={onClose}>
      <form action={action} className="flex flex-col gap-3">
        <p className="text-sm text-neutral-700">
          This permanently deletes the workspace and everything inside it —
          groups, channels, messages, and tasks. This cannot be undone.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Type{" "}
            <span className="font-mono text-red-600">{workspaceName}</span>{" "}
            to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            className="rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500"
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
          <SubmitButton variant="danger" disabled={!matches}>
            Delete workspace
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
