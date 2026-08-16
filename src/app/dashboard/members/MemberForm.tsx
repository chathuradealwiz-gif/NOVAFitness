"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createMember, updateMember } from "@/lib/actions/members";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import type { Member } from "@/types/database";

export function MemberForm({
  member,
  suggestedId,
}: {
  member?: Member;
  suggestedId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    setError(null);

    const result = member
      ? await updateMember(member.id, formData)
      : await createMember(formData);

    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }

    const id = member?.id ?? (result.data as { id: string }).id;
    router.push(`/dashboard/members/${id}`);
  }

  return (
    <form action={handleSubmit} className="nova-card space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Membership Number"
          hint="The gym's official member number. Digits only, e.g. 34."
        >
          <input
            name="membership_id"
            className="nova-input font-mono"
            inputMode="numeric"
            required
            defaultValue={member?.membership_id ?? suggestedId}
            placeholder="34"
          />
        </Field>

        <Field label="Full Name">
          <input name="full_name" className="nova-input" required defaultValue={member?.full_name} />
        </Field>

        <Field label="Mobile Number">
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            className="nova-input"
            required
            defaultValue={member?.phone ?? ""}
          />
        </Field>

        <Field label="Email" hint="Used to link their magic-link sign-in.">
          <input
            name="email"
            type="email"
            className="nova-input"
            defaultValue={member?.email ?? ""}
          />
        </Field>

        <Field label="Date of Birth">
          <input
            name="date_of_birth"
            type="date"
            className="nova-input"
            defaultValue={member?.date_of_birth ?? ""}
          />
        </Field>

        <Field label="Gender">
          <select name="gender" className="nova-input" defaultValue={member?.gender ?? ""}>
            <option value="">Not specified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>

      <Field label="Address">
        <textarea
          name="address"
          rows={2}
          className="nova-input"
          defaultValue={member?.address ?? ""}
        />
      </Field>

      <Field label="Emergency Contact">
        <input
          name="emergency_contact"
          className="nova-input"
          defaultValue={member?.emergency_contact ?? ""}
        />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <div className="flex flex-wrap gap-3 pt-2">
        <button type="submit" className="nova-btn-primary" disabled={busy}>
          {busy ? (<><Spinner size={16} /> Saving…</>) : member ? "Save Changes" : "Create Member"}
        </button>
        <button type="button" className="nova-btn-ghost" onClick={() => router.back()}>
          Cancel
        </button>
      </div>

      {!member && (
        <p className="text-xs text-nova-muted">
          New members start as <strong>Inactive</strong>. Recording a registration or monthly
          payment activates the membership.
        </p>
      )}
    </form>
  );
}
