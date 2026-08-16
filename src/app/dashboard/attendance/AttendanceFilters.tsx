"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function AttendanceFilters({
  from,
  to,
  type,
}: {
  from: string;
  to: string;
  type?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`/dashboard/attendance?${next}`);
  }

  return (
    <div className="nova-card flex flex-wrap items-end gap-3">
      <label className="flex-1">
        <span className="nova-label">From</span>
        <input
          type="date"
          className="nova-input mt-1"
          value={from}
          max={to}
          onChange={(event) => update("from", event.target.value)}
        />
      </label>

      <label className="flex-1">
        <span className="nova-label">To</span>
        <input
          type="date"
          className="nova-input mt-1"
          value={to}
          min={from}
          onChange={(event) => update("to", event.target.value)}
        />
      </label>

      <label className="flex-1">
        <span className="nova-label">Event</span>
        <select
          className="nova-input mt-1"
          value={type ?? ""}
          onChange={(event) => update("type", event.target.value)}
        >
          <option value="">All events</option>
          <option value="entry">Entry only</option>
          <option value="exit">Exit only</option>
        </select>
      </label>
    </div>
  );
}
