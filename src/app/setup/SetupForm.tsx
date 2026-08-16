"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { claimMembership } from "@/lib/actions/member-profile";

export function SetupForm({ email, defaultName }: { email: string; defaultName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    setError(null);

    const result = await claimMembership(formData);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not complete your profile.");
      return;
    }
    router.replace("/member");
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="nova-card space-y-4">
      <Field label="Membership Number">
        <input
          name="membership_id"
          className="nova-input font-mono"
          inputMode="numeric"
          placeholder="34"
          required
        />
      </Field>

      <Field label="Full Name">
        <input name="full_name" className="nova-input" required defaultValue={defaultName} />
      </Field>

      <Field label="Mobile Number">
        <input name="phone" type="tel" inputMode="tel" className="nova-input" required />
      </Field>

      <Field label="Email">
        <input className="nova-input opacity-60" value={email} disabled />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <button type="submit" className="nova-btn-primary w-full" disabled={busy}>
        {busy ? (<><Spinner size={16} /> Saving…</>) : "Continue"}
      </button>

      <p className="text-xs text-nova-muted">
        Reception verifies your membership and records your payment. Door access is activated after
        that.
      </p>
    </form>
  );
}
