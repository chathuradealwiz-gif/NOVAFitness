"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { voidPayment } from "@/lib/actions/payments";

/** Super-admin correction flow. The row is never deleted (spec §44). */
export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"voided" | "refunded">("voided");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await voidPayment(paymentId, status, reason);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not update the payment.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="text-xs text-nova-muted hover:text-nova-red" onClick={() => setOpen(true)}>
        Correct
      </button>
    );
  }

  return (
    <div className="min-w-[220px] space-y-2 rounded-xl border border-nova-border bg-nova-surface p-3">
      <select
        className="nova-input py-2 text-sm"
        value={status}
        onChange={(event) => setStatus(event.target.value as "voided" | "refunded")}
      >
        <option value="voided">Void (entered in error)</option>
        <option value="refunded">Refunded</option>
      </select>

      <input
        className="nova-input py-2 text-sm"
        placeholder="Reason (required)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      {error && <p className="text-xs text-nova-red">{error}</p>}

      <div className="flex gap-2">
        <button
          className="nova-btn-primary px-3 py-2 text-xs"
          disabled={busy || !reason.trim()}
          onClick={submit}
        >
          {busy ? "Saving…" : "Confirm"}
        </button>
        <button className="nova-btn-ghost px-3 py-2 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
