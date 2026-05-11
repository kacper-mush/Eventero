export default function DashboardIndex() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-base font-bold text-brand-900">
        Select a workspace
      </h1>
      <p className="max-w-sm text-sm text-neutral-500">
        Pick one from the sidebar, or create a new workspace to get started.
      </p>
    </div>
  );
}
