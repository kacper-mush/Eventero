"use client";

import { useState, type ReactNode } from "react";

export function GroupShell({
  groupName,
  header,
  main,
  drawer,
}: {
  groupName: string;
  header: ReactNode;
  main: ReactNode;
  drawer: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-surface-card px-6 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-xl font-bold text-brand-900">#</span>
            <h1 className="truncate text-lg font-bold text-brand-900">
              {groupName}
            </h1>
          </div>
          {header}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="group-drawer"
            className="shrink-0 rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100"
          >
            {open ? "Hide details" : "Group details"}
          </button>
        </header>
        <div className="flex-1 min-h-0">{main}</div>
      </div>

      {open && (
        <aside
          id="group-drawer"
          className="flex w-96 shrink-0 flex-col gap-5 overflow-y-auto border-l border-neutral-200 bg-surface-app px-5 py-5"
          aria-label={`${groupName} details`}
        >
          {drawer}
        </aside>
      )}
    </div>
  );
}
