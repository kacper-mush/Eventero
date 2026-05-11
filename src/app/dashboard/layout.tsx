import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  getGroups,
  getUnreadNotificationCount,
  getWorkspaces,
} from "./actions";
import { Sidebar } from "./sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims) {
    redirect("/login");
  }

  const [workspaces, groups, unreadNotificationCount] = await Promise.all([
    getWorkspaces(),
    getGroups(),
    getUnreadNotificationCount(),
  ]);
  const email = typeof claims.email === "string" ? claims.email : "";

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar
        workspaces={workspaces}
        groups={groups}
        email={email}
        unreadNotificationCount={unreadNotificationCount}
      />
      <main className="flex-1 overflow-y-auto bg-white">{children}</main>
    </div>
  );
}
