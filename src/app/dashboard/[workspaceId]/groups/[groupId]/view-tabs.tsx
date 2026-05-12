"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type View = "chat" | "tasks";

export function ViewTabs({ current }: { current: View }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(view: View) {
    const next = new URLSearchParams(params.toString());
    if (view === "chat") next.delete("view");
    else next.set("view", view);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div
      role="tablist"
      aria-label="Group view"
      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-surface-card p-0.5 text-[11px] font-semibold"
    >
      <TabLink href={hrefFor("chat")} active={current === "chat"} label="Chat" />
      <TabLink
        href={hrefFor("tasks")}
        active={current === "tasks"}
        label="Tasks"
      />
    </div>
  );
}

function TabLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      href={href}
      scroll={false}
      className={`rounded-full px-3 py-1 uppercase tracking-wide transition ${
        active
          ? "bg-brand-600 text-white shadow-sm"
          : "text-neutral-600 hover:text-brand-900"
      }`}
    >
      {label}
    </Link>
  );
}
