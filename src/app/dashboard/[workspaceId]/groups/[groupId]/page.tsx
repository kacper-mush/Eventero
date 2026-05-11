import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getWorkspaceMembers } from "../../../actions";
import {
  AddMemberSection,
  DeleteGroupSection,
  GroupHeader,
  MembersList,
} from "./group-forms";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ workspaceId: string; groupId: string }>;
}) {
  const { workspaceId, groupId } = await params;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("id, workspace_id, name")
    .eq("id", groupId)
    .maybeSingle();
  if (groupErr) throw new Error(groupErr.message);
  if (!group || group.workspace_id !== workspaceId) notFound();

  const workspaceMembers = await getWorkspaceMembers(workspaceId);
  const me = workspaceMembers.find((m) => m.user_id === userId);
  if (!me) notFound();

  const { data: groupMembershipRows, error: gmErr } = await supabase
    .from("group_memberships")
    .select("user_id, role")
    .eq("group_id", groupId);
  if (gmErr) throw new Error(gmErr.message);

  const emailByUser = new Map(
    workspaceMembers.map((m) => [m.user_id, m.email]),
  );
  const groupMembers = (groupMembershipRows ?? []).map((row) => ({
    user_id: row.user_id,
    role: row.role as "manager" | "member",
    email: emailByUser.get(row.user_id) ?? "(unknown)",
  }));

  const myGroupMembership = groupMembers.find((m) => m.user_id === userId);
  const isWorkspaceAdmin = me.role === "owner" || me.role === "admin";
  const isGroupManager = myGroupMembership?.role === "manager";
  const canManageMembers = isWorkspaceAdmin || isGroupManager;
  const canRename = isWorkspaceAdmin || isGroupManager;
  const canDelete = isWorkspaceAdmin;

  const memberIds = new Set(groupMembers.map((m) => m.user_id));
  const candidatesToAdd = workspaceMembers.filter(
    (m) => !memberIds.has(m.user_id),
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <GroupHeader
        workspaceId={workspaceId}
        groupId={group.id}
        name={group.name}
        canRename={canRename}
        viewerLabel={
          isGroupManager
            ? "manager"
            : myGroupMembership
              ? "member"
              : isWorkspaceAdmin
                ? `workspace ${me.role}`
                : "viewer"
        }
      />

      <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface-card p-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-bold">Members</h2>
          <p className="text-xs text-neutral-500">
            {groupMembers.length} total
            {canManageMembers ? "" : " · view only"}
          </p>
        </div>

        <MembersList
          workspaceId={workspaceId}
          groupId={group.id}
          members={groupMembers}
          viewerUserId={userId}
          canManage={canManageMembers}
        />

        {canManageMembers && (
          <AddMemberSection
            workspaceId={workspaceId}
            groupId={group.id}
            candidates={candidatesToAdd}
          />
        )}
      </section>

      {canDelete && (
        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface-card p-5">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-bold">Delete group</h2>
            <p className="text-xs text-neutral-500">
              Permanently removes the group and everything in it. Workspace
              admins only.
            </p>
          </div>
          <DeleteGroupSection
            workspaceId={workspaceId}
            groupId={group.id}
            groupName={group.name}
          />
        </section>
      )}
    </div>
  );
}
