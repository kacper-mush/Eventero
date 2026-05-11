import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getNotifications } from "../actions";
import { NotificationsList } from "./notifications-ui";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const notifications = await getNotifications();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Inbox
        </p>
        <h1 className="text-2xl font-bold text-brand-900">Notifications</h1>
        <p className="text-xs text-neutral-500">
          Pending invitations and other heads-ups across your account.
        </p>
      </header>

      {notifications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-surface-card p-6 text-sm text-neutral-500">
          You&apos;re all caught up.
        </p>
      ) : (
        <NotificationsList notifications={notifications} />
      )}
    </div>
  );
}
