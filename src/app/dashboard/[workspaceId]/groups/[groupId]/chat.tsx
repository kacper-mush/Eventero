"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { createClient } from "@/lib/supabase/client";

import {
  deleteMessage as deleteMessageAction,
  editMessage as editMessageAction,
  sendMessage as sendMessageAction,
  type ChatMessage,
} from "./actions";

type PendingMessage = {
  tempId: string;
  body: string;
  created_at: string;
};

export function ChatWindow({
  workspaceId,
  groupId,
  channelId,
  initialMessages,
  viewerUserId,
  viewerEmail,
  memberEmails,
}: {
  workspaceId: string;
  groupId: string;
  channelId: string;
  initialMessages: ChatMessage[];
  viewerUserId: string;
  viewerEmail: string;
  memberEmails: Record<string, string>;
}) {
  // Keyed by id — drops realtime echoes for messages we already have.
  const [messages, setMessages] = useState<Map<number, ChatMessage>>(
    () => new Map(initialMessages.map((m) => [m.id, m])),
  );
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, startSending] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  // Hold the latest emails map in a ref so the realtime callbacks don't
  // re-subscribe every time it changes.
  const emailsRef = useRef(memberEmails);
  useEffect(() => {
    emailsRef.current = memberEmails;
  }, [memberEmails]);

  // Subscribe to live message changes on this channel.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: number;
            channel_id: string;
            author_id: string;
            body: string;
            created_at: string;
            edited_at: string | null;
          };
          setMessages((prev) => {
            if (prev.has(row.id)) return prev;
            const next = new Map(prev);
            next.set(row.id, {
              id: row.id,
              channel_id: row.channel_id,
              author_id: row.author_id,
              author_email:
                emailsRef.current[row.author_id] ?? "(unknown)",
              body: row.body,
              created_at: row.created_at,
              edited_at: row.edited_at,
            });
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: number;
            channel_id: string;
            author_id: string;
            body: string;
            created_at: string;
            edited_at: string | null;
          };
          setMessages((prev) => {
            const existing = prev.get(row.id);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(row.id, {
              ...existing,
              body: row.body,
              edited_at: row.edited_at,
            });
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const old = payload.old as { id?: number };
          if (typeof old.id !== "number") return;
          setMessages((prev) => {
            if (!prev.has(old.id!)) return prev;
            const next = new Map(prev);
            next.delete(old.id!);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending.length]);

  const ordered = useMemo(() => {
    return Array.from(messages.values()).sort((a, b) => {
      const t = a.created_at.localeCompare(b.created_at);
      return t !== 0 ? t : a.id - b.id;
    });
  }, [messages]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isSending) return;
      const tempId = crypto.randomUUID();
      const optimistic: PendingMessage = {
        tempId,
        body: trimmed,
        created_at: new Date().toISOString(),
      };
      setPending((p) => [...p, optimistic]);
      setInput("");
      setErrorMsg(null);

      startSending(async () => {
        const res = await sendMessageAction(workspaceId, groupId, trimmed);
        setPending((p) => p.filter((m) => m.tempId !== tempId));
        if (!res.ok) {
          setErrorMsg(res.error);
          // Restore the unsent text so the user doesn't lose it.
          setInput((current) => current || trimmed);
          return;
        }
        const msg = res.message;
        setMessages((prev) => {
          if (prev.has(msg.id)) return prev;
          const next = new Map(prev);
          next.set(msg.id, msg);
          return next;
        });
      });
    },
    [input, isSending, workspaceId, groupId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
      >
        {ordered.length === 0 && pending.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            No messages yet. Say hi.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ordered.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                isAuthor={m.author_id === viewerUserId}
                workspaceId={workspaceId}
                groupId={groupId}
              />
            ))}
            {pending.map((p) => (
              <li key={p.tempId} className="flex flex-col gap-0.5 opacity-60">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-brand-900">
                    {viewerEmail}
                  </span>
                  <span className="text-[11px] text-neutral-500">sending…</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-neutral-800">
                  {p.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-neutral-200 bg-surface-card px-6 py-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Message — use @handle to mention someone"
          className="flex-1 resize-none rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={isSending || input.trim().length === 0}
          className="rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {errorMsg && (
        <p className="px-6 pb-2 text-xs text-red-600">{errorMsg}</p>
      )}
    </div>
  );
}

function MessageRow({
  message,
  isAuthor,
  workspaceId,
  groupId,
}: {
  message: ChatMessage;
  isAuthor: boolean;
  workspaceId: string;
  groupId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.body) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await editMessageAction(
        workspaceId,
        groupId,
        message.id,
        trimmed,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      setError(null);
    });
  }

  function onDelete() {
    if (!window.confirm("Delete this message?")) return;
    startTransition(async () => {
      const res = await deleteMessageAction(workspaceId, groupId, message.id);
      if (!res.ok) setError(res.error ?? "Delete failed");
    });
  }

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-brand-900">
          {message.author_email}
        </span>
        <span
          className="text-[11px] text-neutral-500"
          suppressHydrationWarning
        >
          {new Date(message.created_at).toLocaleString()}
        </span>
        {message.edited_at && (
          <span className="text-[11px] text-neutral-400">(edited)</span>
        )}
      </div>

      {editing ? (
        <form onSubmit={onEditSubmit} className="flex flex-col gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            rows={2}
            maxLength={4000}
            disabled={busy}
            className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(message.body);
                setError(null);
              }}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-neutral-800">
          {message.body}
        </p>
      )}

      {isAuthor && !editing && (
        <div className="flex gap-3 text-[11px] text-neutral-500">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(true);
              setDraft(message.body);
            }}
            className="hover:underline disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="hover:underline disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}
