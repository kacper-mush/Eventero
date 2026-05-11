"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setPending(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6 font-sans">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-neutral-500">
          We&apos;ll email you a magic link.
        </p>
      </header>

      {sent ? (
        <p className="rounded border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          Check <span className="font-medium">{email}</span> for a sign-in link.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-500 dark:border-neutral-700 dark:focus:border-neutral-400"
          />
          <button
            type="submit"
            disabled={pending || email.length === 0}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-base font-medium transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {pending ? "Sending…" : "Send magic link"}
          </button>
          {error && (
            <p className="break-all text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
