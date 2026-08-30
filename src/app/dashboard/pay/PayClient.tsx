"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Field, StatusPill } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { LinkButton, SubmitButton } from "@/components/Button";
import { Avatar } from "@/components/Avatar";
import {
  IconAttendance,
  IconEdit,
  IconFingerprint,
  IconMeal,
  IconPayments,
  IconStatus,
  IconWorkout,
} from "@/components/icons";
import {
  getPayContext,
  recordPayment,
  searchMembersForPay,
  type PayContext,
  type PaySearchResult,
} from "@/lib/actions/payments";
import { formatDate, formatMoney, PAYMENT_TYPE_LABELS } from "@/lib/format";
import type { GymSettings, PaymentType } from "@/types/database";

const PAYMENT_TYPES: PaymentType[] = [
  "monthly_membership",
  "registration",
  "personal_coaching",
  "other",
];

export function PayClient({ settings }: { settings: GymSettings | null }) {
  const [selected, setSelected] = useState<PaySearchResult | null>(null);
  const [context, setContext] = useState<PayContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const currency = settings?.currency ?? "LKR";

  async function loadContext(memberId: string) {
    setLoadingContext(true);
    const result = await getPayContext(memberId);
    setContext(result);
    setLoadingContext(false);
  }

  function selectMember(member: PaySearchResult) {
    setSelected(member);
    setContext(null);
    setFlash(null);
    void loadContext(member.id);
  }

  function changeMember() {
    setSelected(null);
    setContext(null);
    setFlash(null);
  }

  function focusForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    formRef.current?.querySelector("input")?.focus();
  }

  return (
    <div className="space-y-4">
      <section className="nova-card">
        <h2 className="mb-3 text-sm font-semibold">Record Payment</h2>

        {selected ? (
          <SelectedMember member={selected} onChange={changeMember} />
        ) : (
          <MemberSearchBox onSelect={selectMember} />
        )}

        {selected && (
          <div ref={formRef}>
            <PaymentForm
              memberId={selected.id}
              currency={currency}
              settings={settings}
              onSaved={(message) => {
                setFlash(message);
                void loadContext(selected.id);
              }}
              onCancel={changeMember}
            />
          </div>
        )}

        {flash && (
          <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
            {flash}
          </p>
        )}
      </section>

      {selected && (
        <>
          <QuickActions memberId={selected.id} onRecordPayment={focusForm} />
          <PaymentHistory context={context} loading={loadingContext} memberId={selected.id} />
          <AssignedPlans context={context} loading={loadingContext} />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- search */

function MemberSearchBox({ onSelect }: { onSelect: (member: PaySearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Debounced server-side search. Nothing is fetched until there are two
  // characters to match on, so opening the page never pulls the whole roster.
  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      const found = await searchMembersForPay(trimmed);
      if (cancelled) return;
      setResults(found);
      setSearching(false);
      setSearched(true);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div>
      <Field label="Search Member">
        <input
          className="nova-input"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by Member No, Name, or Mobile Number"
        />
      </Field>

      {searching && (
        <p className="mt-3 flex items-center gap-2 text-sm text-nova-muted">
          <Spinner size={16} /> Searching…
        </p>
      )}

      {!searching && searched && results.length === 0 && (
        <p className="mt-3 text-sm text-nova-muted">No members found.</p>
      )}

      {!searching && results.length > 0 && (
        <ul className="mt-3 divide-y divide-nova-border overflow-hidden rounded-xl border border-nova-border">
          {results.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => onSelect(member)}
                className="nova-tap flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/5"
              >
                <Avatar name={member.full_name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{member.full_name}</span>
                  <span className="block text-xs text-nova-muted">
                    Member No: {member.membership_id}
                    {member.phone ? ` · Mobile: ${member.phone}` : ""}
                  </span>
                </span>
                <StatusPill status={member.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectedMember({
  member,
  onChange,
}: {
  member: PaySearchResult;
  onChange: () => void;
}) {
  return (
    <div className="rounded-xl border border-nova-border bg-nova-surface p-3">
      <p className="nova-label">Selected Member</p>
      <div className="mt-2 flex items-center gap-3">
        <Avatar name={member.full_name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{member.full_name}</p>
          <p className="text-xs text-nova-muted">
            Member No: {member.membership_id}
            {member.phone ? ` · Mobile: ${member.phone}` : ""}
          </p>
          <div className="mt-1.5">
            <StatusPill status={member.status} />
          </div>
        </div>
        <button type="button" className="nova-btn-ghost shrink-0" onClick={onChange}>
          Change Member
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- form */

function PaymentForm({
  memberId,
  currency,
  settings,
  onSaved,
  onCancel,
}: {
  memberId: string;
  currency: string;
  settings: GymSettings | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<PaymentType>("monthly_membership");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const inFlight = useRef(false);
  // One idempotency key per filled-in form; the reset that follows a saved
  // payment mints a fresh one, so the next payment is a new token.
  const token = useMemo(() => crypto.randomUUID(), [resetKey]);

  // Same prefill rule as the member profile's payment panel.
  const defaultAmount =
    type === "monthly_membership"
      ? settings?.monthly_membership_fee
      : type === "registration"
        ? settings?.registration_fee
        : undefined;

  async function handleSubmit(formData: FormData) {
    // A ref, not the `busy` state: two clicks in the same tick both read the
    // stale state and both submit. The form also carries an idempotency token
    // so a request that still gets through twice is only recorded once.
    if (inFlight.current) return;
    inFlight.current = true;

    const amount = Number(formData.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) {
      inFlight.current = false;
      setError("Enter a valid amount greater than zero.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await recordPayment(formData);
    setBusy(false);

    if (!result.ok) {
      // Only a failed payment may be retried; a successful one keeps the token
      // spent until the form resets.
      inFlight.current = false;
      setError(result.error ?? "Could not record the payment.");
      return;
    }
    inFlight.current = false;

    // Keep the member selected so another payment can be recorded for them
    // straight away; only the form fields reset.
    setType("monthly_membership");
    setResetKey((key) => key + 1);
    onSaved("Payment recorded.");
  }

  return (
    <form
      key={resetKey}
      action={handleSubmit}
      className="mt-4 space-y-4 border-t border-nova-border pt-4"
    >
      <input type="hidden" name="member_id" value={memberId} />
      <input type="hidden" name="client_token" value={token} />
      <input type="hidden" name="payment_type" value={type} />

      <Field label="Payment Type">
        <div className="flex flex-wrap gap-2">
          {PAYMENT_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                type === value
                  ? "border-nova-red bg-nova-red/12 text-nova-red"
                  : "border-nova-border text-nova-muted hover:text-nova-text"
              }`}
            >
              {PAYMENT_TYPE_LABELS[value]}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Amount (${currency})`}>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            className="nova-input"
            placeholder="Enter amount"
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
        <textarea
          name="description"
          rows={2}
          className="nova-input"
          placeholder="Add a note about this payment..."
        />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <div className="flex gap-2">
        <SubmitButton busy={busy} busyLabel={<><Spinner size={16} /> Saving…</>}>
          Save Payment
        </SubmitButton>
        <button type="button" className="nova-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------- panels */

function QuickActions({
  memberId,
  onRecordPayment,
}: {
  memberId: string;
  onRecordPayment: () => void;
}) {
  return (
    <section className="nova-card">
      <h2 className="mb-3 text-sm font-semibold">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {/* Already on the Pay page, so this scrolls to the form instead of navigating. */}
        <button type="button" className="nova-btn-primary" onClick={onRecordPayment}>
          <IconPayments size={16} />
          Record Payment
        </button>
        {/* Fingerprint and status changes live in the member profile's panels; the
            Pay page links across rather than duplicating that machinery. */}
        <LinkButton href={`/dashboard/members/${memberId}`}>
          <IconFingerprint size={16} />
          Enroll Fingerprint
        </LinkButton>
        <LinkButton href={`/dashboard/members/${memberId}`}>
          <IconStatus size={16} />
          Change Status
        </LinkButton>
        <LinkButton href={`/dashboard/members/${memberId}/edit`}>
          <IconEdit size={16} />
          Edit Member
        </LinkButton>
        <LinkButton href={`/dashboard/workouts/new?member=${memberId}`}>
          <IconWorkout size={16} />
          Assign Workout
        </LinkButton>
        <LinkButton href={`/dashboard/meals/new?member=${memberId}`}>
          <IconMeal size={16} />
          Assign Meal Plan
        </LinkButton>
        <LinkButton href={`/dashboard/attendance?member=${memberId}`}>
          <IconAttendance size={16} />
          Attendance
        </LinkButton>
      </div>
    </section>
  );
}

function PaymentHistory({
  context,
  loading,
  memberId,
}: {
  context: PayContext | null;
  loading: boolean;
  memberId: string;
}) {
  const payments = context?.payments ?? [];

  return (
    <section className="nova-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Payment History</h2>
        <Link
          href={`/dashboard/payments?member=${memberId}`}
          className="text-xs text-nova-red hover:underline"
        >
          View all
        </Link>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-nova-muted">
          <Spinner size={16} /> Loading…
        </p>
      ) : payments.length === 0 ? (
        <p className="py-6 text-center text-sm text-nova-muted">No payments recorded yet.</p>
      ) : (
        <div className="nova-table-wrap">
          <table className="nova-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Period</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className={payment.status !== "paid" ? "opacity-50" : ""}>
                  <td>{formatDate(payment.payment_date)}</td>
                  <td>{PAYMENT_TYPE_LABELS[payment.payment_type]}</td>
                  <td className="text-nova-muted">
                    {payment.period_start
                      ? `${formatDate(payment.period_start)} → ${formatDate(payment.period_end)}`
                      : "—"}
                  </td>
                  <td className="text-nova-muted">{payment.description ?? "—"}</td>
                  <td className="text-right font-medium tabular-nums">
                    {formatMoney(payment.amount, payment.currency)}
                  </td>
                  <td className="capitalize text-nova-muted">{payment.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AssignedPlans({ context, loading }: { context: PayContext | null; loading: boolean }) {
  const workoutPlans = context?.workoutPlans ?? [];
  const mealPlans = context?.mealPlans ?? [];

  return (
    <section className="nova-card">
      <h2 className="mb-3 text-sm font-semibold">Assigned Plans</h2>

      {loading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-nova-muted">
          <Spinner size={16} /> Loading…
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="nova-label">Workout</p>
            {workoutPlans.length === 0 ? (
              <p className="mt-1 text-sm text-nova-muted">None assigned</p>
            ) : (
              workoutPlans.map((plan) => (
                <Link
                  key={plan.id}
                  href={`/dashboard/workouts/${plan.id}`}
                  className="mt-1 block text-sm text-nova-red hover:underline"
                >
                  {plan.title}
                </Link>
              ))
            )}
          </div>

          <div>
            <p className="nova-label">Meal Plan</p>
            {mealPlans.length === 0 ? (
              <p className="mt-1 text-sm text-nova-muted">None assigned</p>
            ) : (
              mealPlans.map((plan) => (
                <Link
                  key={plan.id}
                  href={`/dashboard/meals/${plan.id}`}
                  className="mt-1 block text-sm text-nova-red hover:underline"
                >
                  {plan.title}
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
