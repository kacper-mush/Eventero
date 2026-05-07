"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export default function Home() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count, error } = await supabase
        .from("clicks")
        .select("*", { count: "exact", head: true });
      if (cancelled) return;
      if (error) setError(error.message);
      else setCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleClick() {
    setPending(true);
    setError(null);
    const { error: insertError } = await supabase.from("clicks").insert({});
    if (insertError) {
      setError(insertError.message);
    } else {
      const { count, error: countError } = await supabase
        .from("clicks")
        .select("*", { count: "exact", head: true });
      if (countError) setError(countError.message);
      else setCount(count ?? 0);
    }
    setPending(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6 font-sans">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Eventero</h1>
        <p className="text-sm text-neutral-500">
          Event-based communicator. MVP scaffold.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Global click counter (Proof of concept)
        </h2>
        <p className="text-base">
          {count === null ? "…" : `${count.toLocaleString()} clicks worldwide`}
        </p>
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          className="self-center rounded-lg border border-neutral-300 px-8 py-3 text-lg font-medium transition duration-75 hover:bg-neutral-100 active:scale-95 active:bg-neutral-200 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900 dark:active:bg-neutral-800"
        >
          Click
        </button>
        {error && (
          <p className="break-all text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
