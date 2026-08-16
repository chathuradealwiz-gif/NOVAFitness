"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PAYMENT_TYPE_LABELS } from "@/lib/format";
import type { PaymentType } from "@/types/database";

export function PaymentFilters({
  from,
  to,
  type,
  status,
}: {
  from: string;
  to: string;
  type?: string;
  status?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`/dashboard/payments?${next}`);
  }

  return (
    <div className="nova-card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label>
        <span className="nova-label">From</span>
        <input
          type="date"
          className="nova-input mt-1"
          value={from}
          max={to}
          onChange={(event) => update("from", event.target.value)}
        />
      </label>

      <label>
        <span className="nova-label">To</span>
        <input
          type="date"
          className="nova-input mt-1"
          value={to}
          min={from}
          onChange={(event) => update("to", event.target.value)}
        />
      </label>

      <label>
        <span className="nova-label">Payment Type</span>
        <select
          className="nova-input mt-1"
          value={type ?? ""}
          onChange={(event) => update("type", event.target.value)}
        >
          <option value="">All types</option>
          {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((value) => (
            <option key={value} value={value}>
              {PAYMENT_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="nova-label">Status</span>
        <select
          className="nova-input mt-1"
          value={status ?? ""}
          onChange={(event) => update("status", event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="voided">Voided</option>
          <option value="refunded">Refunded</option>
        </select>
      </label>
    </div>
  );
}
