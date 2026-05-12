"use client";

import { useEffect, useState, useTransition } from "react";

import { createClient } from "@/lib/supabase/client";

import {
  deleteMention as deleteMentionAction,
  markMentionSeen as markMentionSeenAction,
  type GroupMention,
} from "./actions";

export function MentionsList({
  groupId,
  viewerUserId,
  authorEmails,
  initial,
}: {
  groupId: string;
  viewerUserId: string;
  authorEmails: Record<string, string>;
  initial: GroupMention[];
}) {
  const [items, setItems] = useState<GroupMention[]>(initial);

  // Listen for new mentions targeting us in this group. Server filters by
  // mentioned_user_id (RLS) but the client subscription gets a row when the
  // INSERT hits the publication; we filter again client-side to be safe.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`group_notifications:${groupId}:${viewerUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_notifications",
          filter: `group_id=eq.${groupId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            kind: "mention" | "task_assigned" | "task_done";
            message_id: number | null;
            task_id: string | null;
            group_id: string;
            author_id: string;
            mentioned_user_id: string;
            seen_at: string | null;
            created_at: string;
          };
          if (row.mentioned_user_id !== viewerUserId) return;
          let body = "(unavailable)";
          if (row.kind === "mention" && row.message_id !== null) {
            const { data: msg } = await supabase
              .from("messages")
              .select("body")
              .eq("id", row.message_id)
              .maybeSingle();
            body = msg?.body ?? "(message unavailable)";
          } else if (row.task_id) {
            const { data: tsk } = await supabase
              .from("tasks")
              .select("title")
              .eq("id", row.task_id)
              .maybeSingle();
            body = tsk?.title ?? "(task unavailable)";
          }
          const item: GroupMention = {
            id: row.id,
            kind: row.kind,
            message_id: row.message_id,
            task_id: row.task_id,
            group_id: row.group_id,
            author_id: row.author_id,
            author_email: authorEmails[row.author_id] ?? "(unknown)",
            body,
            seen_at: row.seen_at,
            created_at: row.created_at,
          };
          setItems((prev) => {
            if (prev.some((m) => m.id === item.id)) return prev;
            return [item, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, viewerUserId, authorEmails]);

  if (items.length === 0) {
    return (
      <p className="rounded border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
        No mentions yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((m) => (
        <MentionRow
          key={m.id}
          mention={m}
          onSeen={() =>
            setItems((prev) =>
              prev.map((x) =>
                x.id === m.id ? { ...x, seen_at: new Date().toISOString() } : x,
              ),
            )
          }
          onDelete={() =>
            setItems((prev) => prev.filter((x) => x.id !== m.id))
          }
        />
      ))}
    </ul>
  );
}

function MentionRow({
  mention,
  onSeen,
  onDelete,
}: {
  mention: GroupMention;
  onSeen: () => void;
  onDelete: () => void;
}) {
  const [busy, startTransition] = useTransition();
  const unread = mention.seen_at === null;

  return (
    <li
      className={`flex flex-col gap-1 rounded border px-3 py-2 text-xs ${
        unread
          ? "border-brand-300 bg-brand-50"
          : "border-neutral-200 bg-surface-card"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-brand-900">{mention.author_email}</p>
        <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
          {mention.kind === "mention"
            ? "Mention"
            : mention.kind === "task_assigned"
              ? "Assigned"
              : "Done"}
        </span>
      </div>
      <NotificationContent mention={mention} />
      <p className="text-[10px] text-neutral-500" suppressHydrationWarning>
        {new Date(mention.created_at).toLocaleString()}
      </p>
      <div className="flex gap-3 text-[11px] text-neutral-600">
        {unread && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              startTransition(async () => {
                const res = await markMentionSeenAction(mention.id);
                if (res.ok) onSeen();
              })
            }
            className="hover:underline disabled:opacity-50"
          >
            Mark seen
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              const res = await deleteMentionAction(mention.id);
              if (res.ok) onDelete();
            })
          }
          className="hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function NotificationContent({ mention }: { mention: GroupMention }) {
  if (mention.kind === "task_assigned") {
    return (
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-neutral-700">
        Task <span className="font-semibold">{mention.body}</span> was assigned
        to you.
      </p>
    );
  }
  if (mention.kind === "task_done") {
    return (
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-neutral-700">
        Task <span className="font-semibold">{mention.body}</span> you are
        managing is marked as done.
      </p>
    );
  }
  // mention: render the message body preview verbatim.
  return (
    <p className="line-clamp-3 whitespace-pre-wrap break-words text-neutral-700">
      {mention.body}
    </p>
  );
}
