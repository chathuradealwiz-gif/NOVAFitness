"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { changeMemberStatus } from "@/lib/actions/members";
import { recordPayment } from "@/lib/actions/payments";
import { cancelEnrollment, removeFingerprint, requestEnrollment } from "@/lib/actions/fingerprint";
import { PAYMENT_TYPE_LABELS } from "@/lib/format";
import type {
  Device,
  EnrollmentRequest,
  GymSettings,
  Member,
  MemberStatus,
  PaymentType,
} from "@/types/database";

type Panel = "payment" | "status" | "fingerprint" | null;

export function MemberActions({
  member,
  devices,
  activeEnrollment,
  settings,
  isSuperAdmin,
}: {
  member: Member;
  devices: Device[];
  activeEnrollment: EnrollmentRequest | null;
  settings: GymSettings | null;
  isSuperAdmin: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);

  return (
    <section className="nova-card">
      <h2 className="mb-3 text-sm font-semibold">Actions</h2>

      <div className="flex flex-wrap gap-2">
        <button className="nova-btn-primary" onClick={() => setPanel(panel === "payment" ? null : "payment")}>
          Record Payment
        </button>
        <button
          className="nova-btn-ghost"
          onClick={() => setPanel(panel === "fingerprint" ? null : "fingerprint")}
        >
          {member.fingerprint_id === null ? "Enroll Fingerprint" : "Manage Fingerprint"}
        </button>
        <button className="nova-btn-ghost" onClick={() => setPanel(panel === "status" ? null : "status")}>
          Change Status
        </button>
        <Link href={`/dashboard/members/${member.id}/edit`} className="nova-btn-ghost">
          Edit Member
        </Link>
        <Link href={`/dashboard/workouts/new?member=${member.id}`} className="nova-btn-ghost">
          Assign Workout
        </Link>
        <Link href={`/dashboard/meals/new?member=${member.id}`} className="nova-btn-ghost">
          Assign Meal Plan
        </Link>
        <Link href={`/dashboard/attendance?member=${member.id}`} className="nova-btn-ghost">
          Attendance
        </Link>
      </div>

      {panel === "payment" && (
        <PaymentPanel member={member} settings={settings} onDone={() => setPanel(null)} />
      )}
      {panel === "status" && (
        <StatusPanel member={member} onDone={() => setPanel(null)} />
      )}
      {panel === "fingerprint" && (
        <FingerprintPanel
          member={member}
          devices={devices}
          activeEnrollment={activeEnrollment}
          isSuperAdmin={isSuperAdmin}
          onDone={() => setPanel(null)}
        />
      )}
    </section>
  );
}

const PAYMENT_TYPES: PaymentType[] = [
  "monthly_membership",
  "registration",
  "personal_coaching",
  "other",
];

function PaymentPanel({
  member,
  settings,
  onDone,
}: {
  member: Member;
  settings: GymSettings | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<PaymentType>("monthly_membership");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill the configured fee for the two standard payment types.
  const defaultAmount =
    type === "monthly_membership"
      ? settings?.monthly_membership_fee
      : type === "registration"
        ? settings?.registration_fee
        : undefined;

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    setError(null);
    const result = await recordPayment(formData);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not record the payment.");
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="mt-4 space-y-4 border-t border-nova-border pt-4">
      <input type="hidden" name="member_id" value={member.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payment Type">
          <select
            name="payment_type"
            className="nova-input"
            value={type}
            onChange={(event) => setType(event.target.value as PaymentType)}
          >
            {PAYMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Amount (${settings?.currency ?? "LKR"})`}>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="nova-input"
            key={type} // re-mount so the prefilled default follows the type
            defaultValue={defaultAmount ? String(defaultAmount) : ""}
          />
        </Field>

        <Field label="Payment Date">
          <input
            name="payment_date"
            type="date"
            required
            className="nova-input"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </Field>

        {type === "personal_coaching" && (
          <Field label="Coach">
            <input name="coach_name" className="nova-input" />
          </Field>
        )}
      </div>

      {type === "monthly_membership" && (
        <p className="rounded-xl border border-nova-border bg-nova-surface p-3 text-xs text-nova-muted">
          The membership period is calculated automatically: one calendar month from the payment
          date (or from the day after the current period ends, if the member is renewing early).
          Recording this payment reactivates an expired membership.
        </p>
      )}

      {type === "personal_coaching" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Period Start">
            <input name="period_start" type="date" className="nova-input" />
          </Field>
          <Field label="Period End">
            <input name="period_end" type="date" className="nova-input" />
          </Field>
        </div>
      )}

      <Field label="Description">
        <input name="description" className="nova-input" placeholder="Optional note" />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="nova-btn-primary" disabled={busy}>
          {busy ? (<><Spinner size={16} /> Saving…</>) : "Save Payment"}
        </button>
        <button type="button" className="nova-btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const STATUSES: MemberStatus[] = ["active", "expired", "suspended", "inactive"];

function StatusPanel({ member, onDone }: { member: Member; onDone: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function apply() {
    setBusy(true);
    setError(null);
    const result = await changeMemberStatus(member.id, status, reason);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not change the status.");
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4 border-t border-nova-border pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New Status">
          <select
            className="nova-input"
            value={status}
            onChange={(event) => setStatus(event.target.value as MemberStatus)}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Reason" hint="Recorded in the audit log.">
          <input
            className="nova-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Monthly payment received in cash"
          />
        </Field>
      </div>

      <p className="text-xs text-nova-muted">
        Payment history is the source of truth for paid periods. Use a manual override only when the
        business process requires it.
      </p>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      {confirming ? (
        <div className="rounded-xl border border-nova-red/40 bg-nova-red/10 p-3">
          <p className="text-sm">
            Change <strong>{member.membership_id}</strong> from {member.status} to {status}?
          </p>
          <div className="mt-3 flex gap-2">
            <button className="nova-btn-primary" onClick={apply} disabled={busy}>
              {busy ? (<><Spinner size={16} /> Applying…</>) : "Confirm"}
            </button>
            <button className="nova-btn-ghost" onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            className="nova-btn-primary"
            onClick={() => setConfirming(true)}
            disabled={status === member.status || !reason.trim()}
          >
            Change Status
          </button>
          <button className="nova-btn-ghost" onClick={onDone}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function FingerprintPanel({
  member,
  devices,
  activeEnrollment,
  isSuperAdmin,
  onDone,
}: {
  member: Member;
  devices: Device[];
  activeEnrollment: EnrollmentRequest | null;
  isSuperAdmin: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  if (activeEnrollment) {
    return (
      <div className="mt-4 space-y-3 border-t border-nova-border pt-4">
        <p className="text-sm">
          Enrollment in progress. Ask <strong>{member.full_name}</strong> to place their finger on
          the sensor. The page updates once the device reports the new slot.
        </p>
        <p className="text-xs text-nova-muted">
          Request expires {new Date(activeEnrollment.expires_at).toLocaleTimeString("en-GB")}.
        </p>
        {error && <p className="text-sm text-nova-red">{error}</p>}
        <div className="flex gap-2">
          <button className="nova-btn-ghost" onClick={() => router.refresh()}>
            Refresh
          </button>
          <button
            className="nova-btn-ghost"
            disabled={busy}
            onClick={() => run(() => cancelEnrollment(activeEnrollment.id, member.id))}
          >
            Cancel enrollment
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4 border-t border-nova-border pt-4">
      {member.fingerprint_id === null ? (
        <>
          {devices.length === 0 ? (
            <p className="text-sm text-nova-muted">
              No active devices. Add one under Devices first.
            </p>
          ) : (
            <Field label="Device" hint="The member must be standing at this device.">
              <select
                className="nova-input"
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
              >
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.device_code} — {device.name}
                    {device.status !== "online" ? " (offline)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && <p className="text-sm text-nova-red">{error}</p>}

          <div className="flex gap-2">
            <button
              className="nova-btn-primary"
              disabled={busy || !deviceId}
              onClick={() => run(() => requestEnrollment(member.id, deviceId))}
            >
              {busy ? (<><Spinner size={16} /> Starting…</>) : "Start Enrollment"}
            </button>
            <button className="nova-btn-ghost" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">
            Fingerprint <span className="font-mono">#{member.fingerprint_id}</span> is assigned.
            Removing it keeps the member and all their attendance history — only door access stops.
          </p>
          {!isSuperAdmin && (
            <p className="text-xs text-nova-muted">
              Re-enrolling on another device requires removing this assignment first.
            </p>
          )}
          {error && <p className="text-sm text-nova-red">{error}</p>}
          <div className="flex gap-2">
            <button
              className="nova-btn-primary"
              disabled={busy}
              onClick={() => run(() => removeFingerprint(member.id))}
            >
              {busy ? (<><Spinner size={16} /> Removing…</>) : "Remove Fingerprint"}
            </button>
            <button className="nova-btn-ghost" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
