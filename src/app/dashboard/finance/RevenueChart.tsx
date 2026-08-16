"use client";

import { formatMoney } from "@/lib/format";

export function RevenueChart({
  data,
  currency,
}: {
  data: { day: string; total: number }[];
  currency: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-nova-muted">No revenue this month.</p>;
  }

  const max = Math.max(1, ...data.map((point) => Number(point.total)));
  const peak = data.reduce((best, point) =>
    Number(point.total) > Number(best.total) ? point : best,
  );

  return (
    <figure>
      <div className="flex h-40 items-end gap-[2px]" role="img" aria-label="Daily revenue">
        {data.map((point) => {
          const value = Number(point.total);
          return (
            <div
              key={point.day}
              className="flex-1 rounded-t-sm bg-nova-red/80"
              style={{ height: `${Math.max(1, (value / max) * 100)}%` }}
              title={`${point.day}: ${formatMoney(value, currency)}`}
            />
          );
        })}
      </div>

      <figcaption className="mt-3 flex justify-between text-xs text-nova-muted">
        <span>{new Date(data[0].day).getDate()}</span>
        <span>
          Peak {formatMoney(peak.total, currency)} on{" "}
          {new Date(peak.day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </span>
        <span>{new Date(data[data.length - 1].day).getDate()}</span>
      </figcaption>
    </figure>
  );
}
