"use client";

import { useEffect, useState } from "react";
import type { BannerType, BroadcastMessage } from "@/types/database";

const STYLES: Record<BannerType, string> = {
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  danger: "border-nova-red/40 bg-nova-red/10 text-nova-red",
};

const STORAGE_KEY = "nova.dismissed-broadcasts";

/**
 * Announcement banner (spec §56-58). Dismissal is local to the device — no
 * per-user dismissal table, and messages marked `dismissible = false` cannot be
 * hidden at all.
 */
export function BroadcastBanner({ broadcasts }: { broadcasts: BroadcastMessage[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
    } catch {
      setDismissed([]);
    }
    setLoaded(true);
  }, []);

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode or full storage: the banner simply reappears next visit.
    }
  }

  // Render nothing until localStorage is read, so a dismissed banner never flashes.
  if (!loaded) return null;

  const visible = broadcasts.filter(
    (broadcast) => !broadcast.dismissible || !dismissed.includes(broadcast.id),
  );

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((broadcast) => (
        <div
          key={broadcast.id}
          className={`animate-fade-up rounded-2xl border p-4 ${STYLES[broadcast.banner_type]}`}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold">{broadcast.title}</p>
            {broadcast.dismissible && (
              <button
                onClick={() => dismiss(broadcast.id)}
                className="-m-2 p-2 text-xs opacity-70 hover:opacity-100"
                aria-label="Dismiss"
              >
                Dismiss
              </button>
            )}
          </div>
          <p className="mt-1 text-sm">{broadcast.message}</p>
        </div>
      ))}
    </div>
  );
}
