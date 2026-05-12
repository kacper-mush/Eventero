import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  getWorkspaceMembers,
  getWorkspacePendingInvitations,
} from "../../actions";
import {
  DeleteWorkspaceSection,
  InviteMembersSection,
  RenameWorkspaceForm,
  TransferOwnershipSection,
} from "../settings-forms";

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!workspace) notFound();

  const members = await getWorkspaceMembers(workspaceId);
  const me = members.find((m) => m.user_id === userId);
  if (!me) notFound();

  const isOwner = me.role === "owner";
  const isAdmin = me.role === "owner" || me.role === "admin";
  const canRename = isAdmin;
  const otherMembers = members.filter((m) => m.user_id !== userId);

  const pendingInvitations = isAdmin
    ? await getWorkspacePendingInvitations(workspaceId)
    : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Workspace settings
        </p>
        <h1 className="text-2xl font-bold text-brand-900">{workspace.name}</h1>
        <p className="text-xs text-neutral-500">
          You are {me.role === "owner" ? "the owner" : `an ${me.role}`}.
        </p>
      </header>

      {canRename && (
        <Section title="Rename">
          <RenameWorkspaceForm
            workspaceId={workspace.id}
            currentName={workspace.name}
          />
        </Section>
      )}

      {isAdmin && (
        <Section
          title="Invite members"
          description="Invite someone with an existing Eventero account. They get an in-app notification to accept; invitations expire after 7 days."
        >
          <InviteMembersSection
            workspaceId={workspace.id}
            pendingInvitations={pendingInvitations}
          />
        </Section>
      )}

      <Section title="Members" description={`${members.length} total`}>
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span className="truncate">{m.email}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {isOwner && (
        <Section
          title="Transfer ownership"
          description="Hand the workspace over to another member. You will become an admin."
        >
          <TransferOwnershipSection
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            candidates={otherMembers}
          />
        </Section>
      )}

      {isOwner && (
        <Section
          title="Delete workspace"
          description="Permanently deletes the workspace and everything inside it. This cannot be undone."
        >
          <DeleteWorkspaceSection
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface-card p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-bold">{title}</h2>
        {description && (
          <p className="text-xs text-neutral-500">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
