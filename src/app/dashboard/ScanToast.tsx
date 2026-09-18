"use client";

/**
 * Pops the terminal's "Welcome" onto whichever dashboard page is open.
 *
 * The door terminal decides and shows the result on its own TFT. That screen
 * is the only place the decision is visible, so when it is dark or cracked
 * the staff at reception are blind to who just scanned. Every scan is already
 * persisted to `attendance` by the edge function, so the browser just listens
 * for the insert and repeats what the TFT would have said.
 *
 * Deliberately a listener and nothing more: it does not decide, record or
 * open anything, and the terminal keeps working exactly as before whether or
 * not a dashboard is open.
 *
 * Realtime delivers the raw row, which carries a member_id but no name, and a
 * subscription cannot join. One small select per scan resolves it.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconX } from "@/components/icons";

/** How long a popup stays before it clears itself. */
const DISMISS_MS = 6000;

/** Same wording the terminal shows on its TFT. */
const DENIAL_TEXT: Record<string, string> = {
  MEMBERSHIP_EXPIRED: "Membership Expired",
  MEMBERSHIP_SUSPENDED: "Membership Suspended",
  MEMBERSHIP_INACTIVE: "Account Inactive",
  NO_MEMBERSHIP: "No Active Membership",
  FINGERPRINT_NOT_REGISTERED: "Fingerprint Not Registered",
};

interface Scan {
  id: string;
  name: string;
  authorized: boolean;
  message: string;
  offline: boolean;
}

export function ScanToast() {
  const [scan, setScan] = useState<Scan | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("attendance-scans")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "attendance" },
        async ({ new: row }) => {
          let name = "Unknown fingerprint";
          if (row.member_id) {
            const { data } = await supabase
              .from("members")
              .select("full_name")
              .eq("id", row.member_id)
              .maybeSingle();
            if (data?.full_name) name = data.full_name;
          }

          setScan({
            id: row.id,
            name,
            authorized: row.authorized,
            message: row.authorized
              ? "Welcome"
              : DENIAL_TEXT[row.denial_reason ?? ""] ?? "Access Denied",
            offline: row.offline_event,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!scan) return;
    const timer = setTimeout(() => setScan(null), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [scan]);

  if (!scan) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      // Above the mobile bottom nav, top-right on desktop.
      className="pointer-events-none fixed inset-x-4 bottom-24 z-50 lg:inset-x-auto lg:bottom-auto lg:right-6 lg:top-6 lg:w-80"
    >
      <button
        type="button"
        onClick={() => setScan(null)}
        className={`nova-card pointer-events-auto flex w-full items-center gap-3 text-left animate-fade-up ${
          scan.authorized ? "border-emerald-500/40" : "nova-card-accent"
        }`}
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            scan.authorized ? "bg-emerald-500/15 text-emerald-400" : "bg-nova-redGlow text-nova-red"
          }`}
        >
          {scan.authorized ? <IconCheck size={20} /> : <IconX size={20} />}
        </span>
        <span className="min-w-0">
          <span className="nova-label block">
            {scan.message}
            {scan.offline && " · offline scan"}
          </span>
          <span className="block truncate font-display text-lg font-bold">{scan.name}</span>
        </span>
      </button>
    </div>
  );
}
