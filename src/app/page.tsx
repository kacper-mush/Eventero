"use client";

import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "connected"; detail: string }
  | { kind: "missing-env" }
  | { kind: "error"; detail: string };

function checkSupabase(): Status {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { kind: "missing-env" };
  try {
    createClient();
    return { kind: "connected", detail: url };
  } catch (err) {
    return {
      kind: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export default function Home() {
  const status = checkSupabase();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6 font-sans">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Eventero</h1>
        <p className="text-sm text-neutral-500">
          Event-based communicator. MVP scaffold.
        </p>
      </header>

      <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Supabase
        </h2>
        <p className="mt-2 text-base">
          {status.kind === "connected" && "Browser client constructed."}
          {status.kind === "missing-env" &&
            "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set."}
          {status.kind === "error" && "Failed to construct client."}
        </p>
        {"detail" in status && (
          <p className="mt-1 break-all text-xs text-neutral-500">
            {status.detail}
          </p>
        )}
      </section>
    </main>
  );
}
