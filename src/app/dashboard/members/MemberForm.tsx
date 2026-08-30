"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createMember, updateMember } from "@/lib/actions/members";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { SubmitButton } from "@/components/Button";
import type { Member } from "@/types/database";

export function MemberForm({
  member,
  suggestedId,
  onCreated,
}: {
  member?: Member;
  suggestedId?: string;
  /**
   * Called with the new row instead of navigating to it. The signup wizard uses
   * this to stay put and move on to the fingerprint step; without it the form
   * keeps its old behaviour of going straight to the member's page.
   */
  onCreated?: (member: Member) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Controlled, so a clash can put the next free number straight into the field
  // and reception only has to press Save again.
  //
  // Blank for a new member rather than prefilled with the suggestion: the
  // number is then chosen at insert time, which is the only moment it can be
  // checked against the roster. Prefilling handed two people signing members up
  // at once the same number, and the second one hit a duplicate.
  const [membershipId, setMembershipId] = useState(member?.membership_id ?? "");

  // A ref rather than the `busy` state: two taps in the same tick both read the
  // pre-render value of state and both submit, which on a phone — where the
  // button gives no hover feedback — is an easy thing to do by accident.
  const inFlight = useRef(false);

  async function handleSubmit(formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    const result = member
      ? await updateMember(member.id, formData)
      : await createMember(formData);

    setBusy(false);

    if (!result.ok) {
      inFlight.current = false;
      const suggestion = (result.data as { suggestedId?: string } | undefined)?.suggestedId;
      if (suggestion) setMembershipId(suggestion);
      setError(result.error ?? "Something went wrong.");
      return;
    }

    if (!member && onCreated) {
      // The wizard takes over from here; stay mounted and keep the guard
      // latched so the form cannot be submitted a second time behind it.
      onCreated(result.data as Member);
      return;
    }

    const id = member?.id ?? (result.data as Member).id;
    router.push(`/dashboard/members/${id}`);
  }

  return (
    <form action={handleSubmit} className="nova-card space-y-4">
      {/* Name and mobile are all a signup needs. They come first and are the
          only two marked required, so reception can finish at the counter with
          the member standing there and fill in the rest later. */}
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      <details className="rounded-xl border border-nova-border bg-nova-surface/50" open={!!member}>
        <summary className="nova-tap cursor-pointer list-none px-4 py-3 font-display text-[11px] font-bold uppercase tracking-wider text-nova-muted">
          Optional details
        </summary>

        <div className="space-y-4 border-t border-nova-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Membership Number"
              hint="Left blank, the next free number is assigned automatically."
            >
              <input
                name="membership_id"
                className="nova-input font-mono"
                inputMode="numeric"
                value={membershipId}
                onChange={(event) => setMembershipId(event.target.value)}
                placeholder={suggestedId ? `${suggestedId} (next free)` : "34"}
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
        </div>
      </details>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <div className="flex flex-wrap gap-3 pt-2">
        <SubmitButton
          busy={busy}
          busyLabel={<><Spinner size={16} /> Saving…</>}
        >
          {member ? "Save Changes" : "Create Member"}
        </SubmitButton>
        <button
          type="button"
          className="nova-btn-ghost"
          disabled={busy}
          onClick={() => router.back()}
        >
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
