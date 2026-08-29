"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { updateOwnProfile } from "@/lib/actions/member-profile";
import type { Member } from "@/types/database";

export function ProfileForm({ member }: { member: Member }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    setError(null);
    setSaved(false);

    const result = await updateOwnProfile(formData);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save your details.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="nova-card space-y-4">
      <p className="nova-label">Contact details</p>

      <Field label="Full Name">
        <input name="full_name" className="nova-input" required defaultValue={member.full_name} />
      </Field>

      <Field label="Mobile Number">
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          className="nova-input"
          required
          defaultValue={member.phone ?? ""}
        />
      </Field>

      <Field label="Address">
        <textarea
          name="address"
          rows={2}
          className="nova-input"
          defaultValue={member.address ?? ""}
        />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}
      {saved && <p className="text-sm text-emerald-400">Saved.</p>}

      <button type="submit" className="nova-btn-primary w-full" disabled={busy}>
        {busy ? (<><Spinner size={16} /> Saving…</>) : "Save Changes"}
      </button>

      <p className="text-xs text-nova-muted">
        Your membership number and status are managed by gym staff.
      </p>
    </form>
  );
}
