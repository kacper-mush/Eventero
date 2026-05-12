"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  acceptInvitation,
  declineInvitation,
  markNotificationRead,
  type ActionState,
  type Notification,
} from "../actions";
import { SubmitButton } from "../ui";

export function NotificationsList({
  notifications,
}: {
  notifications: Notification[];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} />
      ))}
    </ul>
  );
}

function NotificationItem({ notification }: { notification: Notification }) {
  if (notification.type === "workspace_invitation") {
    return <InvitationNotification notification={notification} />;
  }
  if (notification.type === "channel_mention") {
    return <ChannelMentionNotification notification={notification} />;
  }
  return null;
}

function ChannelMentionNotification({
  notification,
}: {
  notification: Notification;
}) {
  const isUnread = notification.read_at === null;
  return (
    <li
      className={`flex flex-col gap-3 rounded-lg border p-4 ${
        isUnread
          ? "border-brand-300 bg-brand-50"
          : "border-neutral-200 bg-surface-card"
      }`}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm">
          <span className="font-semibold">
            {notification.mention_author_email ?? "Someone"}
          </span>{" "}
          mentioned you in{" "}
          {notification.workspace_id ? (
            <Link
              href={`/dashboard/${notification.workspace_id}`}
              className="font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              #general{" "}
              {notification.workspace_name
                ? `· ${notification.workspace_name}`
                : ""}
            </Link>
          ) : (
            <span className="font-semibold">a workspace channel</span>
          )}
          .
        </p>
        {notification.message_body && (
          <p className="line-clamp-3 whitespace-pre-wrap break-words rounded border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
            {notification.message_body}
          </p>
        )}
        <p className="text-[11px] text-neutral-500">
          Received {new Date(notification.created_at).toLocaleString()}
        </p>
      </div>
      {isUnread && <DismissButton notificationId={notification.id} />}
    </li>
  );
}

function InvitationNotification({
  notification,
}: {
  notification: Notification;
}) {
  const isPending = notification.invitation_status === "pending";
  const isUnread = notification.read_at === null;

  return (
    <li
      className={`flex flex-col gap-3 rounded-lg border p-4 ${
        isUnread
          ? "border-brand-300 bg-brand-50"
          : "border-neutral-200 bg-surface-card"
      }`}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm">
          <span className="font-semibold">
            {notification.inviter_email ?? "Someone"}
          </span>{" "}
          invited you to{" "}
          <span className="font-semibold">
            {notification.workspace_name ?? "a workspace"}
          </span>
          {notification.invitation_role && (
            <>
              {" "}
              as <span className="font-semibold">{notification.invitation_role}</span>
            </>
          )}
          .
        </p>
        <p className="text-[11px] text-neutral-500">
          {formatStatusLine(notification)}
        </p>
      </div>

      {isPending && notification.invitation_id && (
        <InvitationActions invitationId={notification.invitation_id} />
      )}

      {!isPending && isUnread && (
        <DismissButton notificationId={notification.id} />
      )}
    </li>
  );
}

function InvitationActions({ invitationId }: { invitationId: string }) {
  const [acceptState, acceptAction] = useActionState<ActionState, FormData>(
    acceptInvitation.bind(null, invitationId),
    null,
  );
  const [declineState, declineAction] = useActionState<ActionState, FormData>(
    declineInvitation.bind(null, invitationId),
    null,
  );
  const error = acceptState?.error ?? declineState?.error;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <form action={acceptAction}>
          <SubmitButton>Accept</SubmitButton>
        </form>
        <form action={declineAction}>
          <button
            type="submit"
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold transition hover:bg-neutral-100"
          >
            Decline
          </button>
        </form>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function DismissButton({ notificationId }: { notificationId: string }) {
  const [, action] = useActionState<ActionState, FormData>(
    markNotificationRead.bind(null, notificationId),
    null,
  );
  return (
    <form action={action} className="self-start">
      <button
        type="submit"
        className="text-xs text-neutral-500 underline-offset-2 hover:underline"
      >
        Dismiss
      </button>
    </form>
  );
}

function formatStatusLine(n: Notification): string {
  const created = new Date(n.created_at).toLocaleString();
  switch (n.invitation_status) {
    case "pending": {
      const expires = n.invitation_expires_at
        ? new Date(n.invitation_expires_at)
        : null;
      const expiresIn = expires ? relativeFromNow(expires) : null;
      return expiresIn
        ? `Received ${created} · expires ${expiresIn}`
        : `Received ${created}`;
    }
    case "accepted":
      return `Accepted · received ${created}`;
    case "declined":
      return `Declined · received ${created}`;
    case "revoked":
      return `Revoked by the inviter · received ${created}`;
    case "expired":
      return `Expired · received ${created}`;
    default:
      return `Received ${created}`;
  }
}

function relativeFromNow(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "soon";
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return "soon";
}
