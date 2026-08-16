"use client";

import { toCsv } from "@/lib/format";

interface Row {
  occurred_at: string;
  event_type: string;
  authorized: boolean;
  denial_reason: string | null;
  members: { membership_id: string; full_name: string } | null;
  devices: { device_code: string } | null;
}

/** Exports the rows currently on screen. Generated in the browser — no serverless
 *  function is burned on it (spec "Vercel Free Hosting"). */
export function ExportButton({ rows }: { rows: Row[] }) {
  function download() {
    const csv = toCsv(
      rows.map((row) => ({
        timestamp: row.occurred_at,
        membership_id: row.members?.membership_id ?? "",
        member_name: row.members?.full_name ?? "",
        event_type: row.event_type,
        device: row.devices?.device_code ?? "",
        result: row.authorized ? "granted" : "denied",
        reason: row.denial_reason ?? "",
      })),
      ["timestamp", "membership_id", "member_name", "event_type", "device", "result", "reason"],
    );

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nova-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="nova-btn-ghost no-print" onClick={download} disabled={rows.length === 0}>
      Export CSV
    </button>
  );
}
