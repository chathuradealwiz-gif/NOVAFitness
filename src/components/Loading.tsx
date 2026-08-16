/**
 * Loading primitives.
 *
 * `loading.tsx` files across the app render these, so Next shows feedback the
 * instant a link is clicked rather than sitting on the old page while the server
 * component fetches.
 */

/** Red arc spinner on the NOVA ring. */
export function Spinner({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0 animate-spin rounded-full border-[3px] border-nova-border border-t-nova-red"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Full-panel loader used by route-level loading.tsx files. */
export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size={40} />
        <p className="font-display text-xs uppercase tracking-[0.25em] text-nova-muted">{label}</p>
      </div>
    </div>
  );
}

/** Shimmer block for skeleton layouts. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.06] ${className}`} />;
}

/** Skeleton that mirrors the shape of a stat-card grid + table page. */
export function DashboardSkeleton() {
  return (
    <div className="animate-fade-up">
      <Skeleton className="mb-6 h-9 w-56" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 xl:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

/** Skeleton for list/table pages. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-fade-up">
      <Skeleton className="mb-6 h-9 w-48" />
      <Skeleton className="mb-4 h-14" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>
    </div>
  );
}
