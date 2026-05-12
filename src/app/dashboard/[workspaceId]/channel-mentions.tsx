"use client";

import { useEffect, useState, useTransition } from "react";

import { createClient } from "@/lib/supabase/client";

import {
  deleteChannelMention as deleteMentionAction,
  markChannelMentionSeen as markSeenAction,
  type ChannelMention,
} from "./channel-actions";

export function ChannelMentionsList({
  channelId,
  viewerUserId,
  authorEmails,
  initial,
}: {
  channelId: string;
  viewerUserId: string;
  authorEmails: Record<string, string>;
  initial: ChannelMention[];
}) {
  const [items, setItems] = useState<ChannelMention[]>(initial);

  // Listen for new mentions targeting us in this channel. RLS already scopes
  // rows to the recipient; we filter by mentioned_user_id again client-side
  // since the channel-level subscription sees every insert on the channel.
  useEffect(() => {
    const supabase = createClient();
    let removed = false;
    const channel = supabase
      .channel(`channel_mentions:${channelId}:${viewerUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_mentions",
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            channel_id: string;
            message_id: number;
            author_id: string;
            mentioned_user_id: string;
            seen_at: string | null;
            created_at: string;
          };
          if (row.mentioned_user_id !== viewerUserId) return;
          const { data: msg } = await supabase
            .from("messages")
            .select("body")
            .eq("id", row.message_id)
            .maybeSingle();
          const item: ChannelMention = {
            id: row.id,
            channel_id: row.channel_id,
            message_id: row.message_id,
            author_id: row.author_id,
            author_email: authorEmails[row.author_id] ?? "(unknown)",
            body: msg?.body ?? "(message unavailable)",
            seen_at: row.seen_at,
            created_at: row.created_at,
          };
          setItems((prev) =>
            prev.some((m) => m.id === item.id) ? prev : [item, ...prev],
          );
        },
      );

    // Authenticate the realtime socket before joining (see chat.tsx).
    supabase.realtime.setAuth().then(() => {
      if (!removed) channel.subscribe();
    });

    return () => {
      removed = true;
      supabase.removeChannel(channel);
    };
  }, [channelId, viewerUserId, authorEmails]);

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
          onDelete={() => setItems((prev) => prev.filter((x) => x.id !== m.id))}
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
  mention: ChannelMention;
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
      <p className="font-semibold text-brand-900">{mention.author_email}</p>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-neutral-700">
        {mention.body}
      </p>
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
                const res = await markSeenAction(mention.id);
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
