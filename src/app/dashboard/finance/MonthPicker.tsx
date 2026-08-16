"use client";

import { useRouter } from "next/navigation";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();

  return (
    <input
      type="month"
      className="nova-input py-2"
      value={month}
      max={new Date().toISOString().slice(0, 7)}
      onChange={(event) => router.replace(`/dashboard/finance?month=${event.target.value}`)}
      aria-label="Report month"
    />
  );
}
