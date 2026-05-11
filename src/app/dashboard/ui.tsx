"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 text-neutral-900"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  disabled,
}: {
  children: React.ReactNode;
  variant?: "primary" | "danger";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const base =
    "rounded px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
  const styles =
    variant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : "bg-brand-600 text-white hover:bg-brand-700";
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`${base} ${styles}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
