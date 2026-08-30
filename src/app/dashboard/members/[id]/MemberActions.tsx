"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { FingerprintScan } from "@/components/FingerprintScan";
import {
  IconAttendance,
  IconEdit,
  IconFingerprint,
  IconMeal,
  IconPayments,
  IconStatus,
  IconWorkout,
} from "@/components/icons";
import { changeMemberStatus, deleteMember } from "@/lib/actions/members";
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

type Panel = "payment" | "status" | "fingerprint" | "delete" | null;

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
          <IconPayments size={16} />
          Record Payment
        </button>
        <button
          className="nova-btn-ghost"
          onClick={() => setPanel(panel === "fingerprint" ? null : "fingerprint")}
        >
          <IconFingerprint size={16} />
          {member.fingerprint_id === null ? "Enroll Fingerprint" : "Manage Fingerprint"}
        </button>
        <button className="nova-btn-ghost" onClick={() => setPanel(panel === "status" ? null : "status")}>
          <IconStatus size={16} />
          Change Status
        </button>
        <Link href={`/dashboard/members/${member.id}/edit`} className="nova-btn-ghost">
          <IconEdit size={16} />
          Edit Member
        </Link>
        <Link href={`/dashboard/workouts/new?member=${member.id}`} className="nova-btn-ghost">
          <IconWorkout size={16} />
          Assign Workout
        </Link>
        <Link href={`/dashboard/meals/new?member=${member.id}`} className="nova-btn-ghost">
          <IconMeal size={16} />
          Assign Meal Plan
        </Link>
        <Link href={`/dashboard/attendance?member=${member.id}`} className="nova-btn-ghost">
          <IconAttendance size={16} />
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
      {panel === "delete" && (
        <DeletePanel member={member} onDone={() => setPanel(null)} />
      )}

      {/* Destructive and irreversible, so it sits apart from the working
          actions rather than in the same row as "Edit Member". */}
      {isSuperAdmin && panel !== "delete" && member.deleted_at === null && (
        <div className="mt-4 border-t border-nova-border pt-4">
          <button
            className="text-xs font-medium text-nova-red transition-opacity hover:opacity-80"
            onClick={() => setPanel("delete")}
          >
            Delete this profile permanently
          </button>
        </div>
      )}
    </section>
  );
}

function DeletePanel({ member, onDone }: { member: Member; onDone: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // Typing the membership number is the confirmation. A yes/no dialog is too
  // easy to click through for something with no undo.
  const armed = typed.trim() === member.membership_id && reason.trim().length > 0;

  async function run() {
    if (inFlight.current || !armed) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    const result = await deleteMember(member.id, reason);

    if (!result.ok) {
      inFlight.current = false;
      setBusy(false);
      setError(result.error ?? "Could not delete this member.");
      return;
    }
    // The profile is gone; there is nothing left on this page to return to.
    router.push("/dashboard/members");
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-nova-red/40 bg-nova-red/5 p-4">
      <div>
        <p className="text-sm font-semibold text-nova-red">Delete this profile permanently</p>
        <p className="mt-1 text-xs text-nova-muted">This cannot be undone.</p>
      </div>

      <ul className="space-y-1 text-xs text-nova-muted">
        <li>• Name, contact details, address and notes are erased.</li>
        <li>
          • The fingerprint is deleted from the sensor itself on the device&apos;s next sync — not
          just unassigned.
        </li>
        <li>• Workout and meal plans are deleted; attendance history is kept, unnamed.</li>
        <li>
          • Payments are <strong>kept</strong>, so finance reports stay correct. Member number{" "}
          {member.membership_id} stays reserved.
        </li>
      </ul>

      <Field label="Reason" hint="Recorded in the audit log.">
        <input
          className="nova-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Member requested their data be removed"
        />
      </Field>

      <Field label={`Type ${member.membership_id} to confirm`}>
        <input
          className="nova-input font-mono"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={member.membership_id}
        />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <div className="flex gap-2">
        <button className="nova-btn-primary" onClick={run} disabled={!armed || busy}>
          {busy ? (<><Spinner size={16} /> Deleting…</>) : "Delete permanently"}
        </button>
        <button className="nova-btn-ghost" onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
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
  // A ref, not the `busy` state: two clicks in the same tick both read the old
  // state and both submit, which is how one payment got recorded twice.
  const inFlight = useRef(false);
  const [token] = useState(() => crypto.randomUUID());

  // Prefill the configured fee for the two standard payment types.
  const defaultAmount =
    type === "monthly_membership"
      ? settings?.monthly_membership_fee
      : type === "registration"
        ? settings?.registration_fee
        : undefined;

  async function handleSubmit(formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await recordPayment(formData);
    setBusy(false);

    if (!result.ok) {
      // Only a failed payment may be retried; a successful one keeps the token
      // spent so a stray resubmit cannot charge the member again.
      inFlight.current = false;
      setError(result.error ?? "Could not record the payment.");
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="mt-4 space-y-4 border-t border-nova-border pt-4">
      <input type="hidden" name="member_id" value={member.id} />
      <input type="hidden" name="client_token" value={token} />

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

  // While a capture is running the device reports a step every couple of
  // seconds; poll so staff watch the bar move instead of pressing Refresh.
  const enrollmentId = activeEnrollment?.id ?? null;
  useEffect(() => {
    if (!enrollmentId) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [enrollmentId, router]);

  if (activeEnrollment) {
    const total = activeEnrollment.progress_total || 4;
    const percent = Math.round((activeEnrollment.progress_step / total) * 100);

    return (
      <div className="mt-4 space-y-3 border-t border-nova-border pt-4">
        <p className="text-sm">
          Enrollment in progress. Ask <strong>{member.full_name}</strong> to follow the prompts on
          the device — the finger must be pressed <strong>flat and still</strong>, in the same spot
          both times.
        </p>

        <div className="flex items-center gap-4">
          <FingerprintScan percent={percent} />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="nova-label">
                {activeEnrollment.progress_message ?? "Waiting for the member at the sensor"}
              </span>
              <span className="font-mono text-sm">{percent}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-nova-border">
              <div
                className="h-full rounded-full bg-nova-red transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-nova-muted">
              Step {activeEnrollment.progress_step} of {total} — press the pad of the finger on the
              marked spot.
            </p>
          </div>
        </div>

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
