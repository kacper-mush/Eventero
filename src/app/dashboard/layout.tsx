import { getSidebarData } from "./actions";
import { Sidebar } from "./sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Single auth + single round-trip for everything the sidebar needs. The
  // shared getSidebarData() validates the session, redirects to /login on
  // missing claims, and fans out the four queries in parallel.
  const data = await getSidebarData();

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      <Sidebar
        workspaces={data.workspaces}
        groups={data.groups}
        email={data.email}
        unreadNotificationCount={data.unreadNotificationCount}
        adminWorkspaceIds={data.adminWorkspaceIds}
      />
      <main className="flex-1 overflow-y-auto bg-white">{children}</main>
    </div>
  );
}
