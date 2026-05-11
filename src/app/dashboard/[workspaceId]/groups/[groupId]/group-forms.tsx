"use client";

import { useActionState, useState, useTransition } from "react";

import type {
  ActionState,
  WorkspaceMember,
} from "../../../actions";
import { Modal, SubmitButton } from "../../../ui";
import {
  addGroupMember,
  deleteGroup,
  removeGroupMember,
  renameGroup,
  setGroupMemberRole,
} from "./actions";

type GroupMember = {
  user_id: string;
  email: string;
  role: "manager" | "member";
};

export function GroupHeader({
  workspaceId,
  groupId,
  name,
  canRename,
  viewerLabel,
}: {
  workspaceId: string;
  groupId: string;
  name: string;
  canRename: boolean;
  viewerLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await renameGroup(workspaceId, groupId, null, formData);
      if (result?.ok) {
        setError(null);
        setEditing(false);
        setJustSaved(true);
      } else {
        setError(result?.error ?? "Failed to rename group");
      }
    });
  }

  if (editing && canRename) {
    return (
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Group
        </p>
        <form action={handleSubmit} className="flex items-center gap-2">
          <input
            name="name"
            defaultValue={name}
            required
            autoFocus
            maxLength={80}
            disabled={isPending}
            className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-lg font-bold text-brand-900 outline-none focus:border-brand-500 disabled:opacity-50"
          />
          <SubmitButton>Save</SubmitButton>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={isPending}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
        </form>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </header>
    );
  }

  return (
    <header className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        Group
      </p>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-brand-900"># {name}</h1>
        {canRename && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setJustSaved(false);
            }}
            className="text-xs text-brand-700 underline-offset-2 hover:underline"
          >
            Rename
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500">You are a {viewerLabel}.</p>
      {justSaved && <p className="text-xs text-green-700">Saved.</p>}
    </header>
  );
}

export function MembersList({
  workspaceId,
  groupId,
  members,
  viewerUserId,
  canManage,
}: {
  workspaceId: string;
  groupId: string;
  members: GroupMember[];
  viewerUserId: string;
  canManage: boolean;
}) {
  if (members.length === 0) {
    return (
      <p className="rounded border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
        No members yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
      {members.map((m) => (
        <MemberRow
          key={m.user_id}
          workspaceId={workspaceId}
          groupId={groupId}
          member={m}
          isSelf={m.user_id === viewerUserId}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

function MemberRow({
  workspaceId,
  groupId,
  member,
  isSelf,
  canManage,
}: {
  workspaceId: string;
  groupId: string;
  member: GroupMember;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState<
    ActionState,
    FormData
  >(setGroupMemberRole.bind(null, workspaceId, groupId), null);
  const [removeState, removeAction, removePending] = useActionState<
    ActionState,
    FormData
  >(removeGroupMember.bind(null, workspaceId, groupId), null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{member.email}</span>
        {isSelf && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
            you
          </span>
        )}
      </div>

      {canManage ? (
        <div className="flex items-center gap-2">
          <form action={roleAction} className="flex items-center gap-1">
            <input type="hidden" name="userId" value={member.user_id} />
            <select
              name="role"
              defaultValue={member.role}
              disabled={rolePending}
              onChange={(e) => {
                const next = e.currentTarget.value;
                const promoting =
                  next === "manager" && member.role !== "manager";
                const demotingSelf =
                  isSelf && member.role === "manager" && next === "member";
                const confirmMsg = promoting
                  ? `Promote ${member.email} to manager? Managers can rename the group and add, remove, or re-role members.`
                  : demotingSelf
                    ? "Demote yourself? You'll lose manager rights on this group."
                    : null;
                if (confirmMsg && !window.confirm(confirmMsg)) {
                  e.currentTarget.value = member.role;
                  return;
                }
                e.currentTarget.form?.requestSubmit();
              }}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs outline-none focus:border-brand-500 disabled:opacity-50"
            >
              <option value="member">member</option>
              <option value="manager">manager</option>
            </select>
            {rolePending && (
              <span className="text-[10px] text-neutral-500">saving…</span>
            )}
          </form>

          <form action={removeAction}>
            <input type="hidden" name="userId" value={member.user_id} />
            <button
              type="submit"
              disabled={removePending}
              onClick={(e) => {
                const msg = isSelf
                  ? "Remove yourself from this group? You'll lose access until an admin or manager re-adds you."
                  : `Remove ${member.email} from this group?`;
                if (!window.confirm(msg)) e.preventDefault();
              }}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              {removePending ? "Removing…" : "Remove"}
            </button>
          </form>

          {(roleState?.error || removeState?.error) && (
            <span className="basis-full text-xs text-red-600">
              {roleState?.error ?? removeState?.error}
            </span>
          )}
        </div>
      ) : (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {member.role}
        </span>
      )}
    </li>
  );
}

export function AddMemberSection({
  workspaceId,
  groupId,
  candidates,
}: {
  workspaceId: string;
  groupId: string;
  candidates: WorkspaceMember[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    addGroupMember.bind(null, workspaceId, groupId),
    null,
  );

  if (candidates.length === 0) {
    return (
      <p className="rounded border border-dashed border-neutral-300 px-3 py-3 text-xs text-neutral-500">
        Everyone in the workspace is already in this group.
      </p>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-2 rounded border border-neutral-200 bg-white p-3 sm:flex-row sm:items-end"
    >
      <label className="flex flex-1 flex-col gap-1 text-xs">
        <span className="font-semibold">Add member</span>
        <select
          name="userId"
          required
          defaultValue=""
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        >
          <option value="" disabled>
            Pick a workspace member…
          </option>
          {candidates.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.email} ({c.role})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold">Role</span>
        <select
          name="role"
          defaultValue="member"
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        >
          <option value="member">member</option>
          <option value="manager">manager</option>
        </select>
      </label>

      <SubmitButton>Add</SubmitButton>

      {state?.error && (
        <p className="basis-full text-xs text-red-600">{state.error}</p>
      )}
    </form>
  );
}

export function DeleteGroupSection({
  workspaceId,
  groupId,
  groupName,
}: {
  workspaceId: string;
  groupId: string;
  groupName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
      >
        Delete group…
      </button>
      {open && (
        <DeleteGroupDialog
          workspaceId={workspaceId}
          groupId={groupId}
          groupName={groupName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DeleteGroupDialog({
  workspaceId,
  groupId,
  groupName,
  onClose,
}: {
  workspaceId: string;
  groupId: string;
  groupName: string;
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    deleteGroup.bind(null, workspaceId, groupId),
    null,
  );
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === groupName;

  return (
    <Modal title={`Delete ${groupName}?`} onClose={onClose}>
      <form action={action} className="flex flex-col gap-3">
        <p className="text-sm text-neutral-700">
          This permanently deletes the group and everything inside it —
          memberships, channels, messages, and tasks. This cannot be undone.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Type{" "}
            <span className="font-mono text-red-600">{groupName}</span> to
            confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            className="rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500"
          />
        </label>
        {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium"
          >
            Cancel
          </button>
          <SubmitButton variant="danger" disabled={!matches}>
            Delete group
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
