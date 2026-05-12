import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getMyTasksData } from "../actions";
import { MyTasksView } from "./my-tasks-ui";

export default async function MyTasksPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { userId, tasks, groups } = await getMyTasksData();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Tasks
        </p>
        <h1 className="text-2xl font-bold text-brand-900">My tasks</h1>
        <p className="text-xs text-neutral-500">
          Everything assigned to you, across all your groups.
        </p>
      </header>

      <MyTasksView initialTasks={tasks} groups={groups} userId={userId} />
    </div>
  );
}
