"use client";

/**
 * Signing up a member, in the order reception actually does it:
 *
 *   1. Details   — creates the member row.
 *   2. Biometric — the member is standing right there, so capture now.
 *   3. Payment   — take the registration or first month's fee.
 *
 * Steps 2 and 3 are prompted but skippable. The member row is committed at the
 * end of step 1 rather than at the end of the wizard, for two reasons: the
 * enrollment request needs a member_id to point at, and a terminal that is
 * offline or a member who pays later must not cost the gym the whole signup.
 * Anything skipped stays visible as an outstanding action on the member's page,
 * which is the same place staff would have gone to do it before this flow
 * existed.
 *
 * Because of that commit point, leaving the wizard after step 1 is not a
 * cancel — the member exists. The footer says so plainly rather than offering a
 * "Cancel" that cannot undo what it implies.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MemberForm } from "../MemberForm";
import { FingerprintPanel, PaymentPanel } from "../[id]/MemberActions";
import { getEnrollmentState } from "@/lib/actions/fingerprint";
import { ActionButton } from "@/components/Button";
import type {
  Device,
  EnrollmentRequest,
  GymSettings,
  Member,
} from "@/types/database";

type Step = 1 | 2 | 3;

const STEPS: { n: Step; label: string; hint: string }[] = [
  { n: 1, label: "Details", hint: "Who they are" },
  { n: 2, label: "Fingerprint", hint: "Door access" },
  { n: 3, label: "Payment", hint: "Activates membership" },
];

export function NewMemberWizard({
  suggestedId,
  devices,
  settings,
  isSuperAdmin,
  activeEnrollment,
}: {
  suggestedId?: string;
  devices: Device[];
  settings: GymSettings | null;
  isSuperAdmin: boolean;
  activeEnrollment: EnrollmentRequest | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [member, setMember] = useState<Member | null>(null);
  const [paid, setPaid] = useState(false);
  // FingerprintPanel follows a capture by refreshing the route it sits on. That
  // works on the member page, which re-renders with the new enrolment; here the
  // route is /members/new and knows nothing about a member created seconds ago
  // in the browser. So the wizard does the polling and hands the panel the
  // result as props.
  const [live, setLive] = useState(activeEnrollment);
  // Each step replaces the one above it, so on a phone the new step opens
  // scrolled halfway down. Pull the heading back to the top on every change.
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const memberId = member?.id ?? null;
  useEffect(() => {
    if (step !== 2 || !memberId) return;

    let cancelled = false;
    const poll = async () => {
      const state = await getEnrollmentState(memberId);
      if (cancelled) return;
      setLive(state.enrollment);
      // The capture is finished the moment the slot lands on the member row.
      if (state.fingerprintId != null) {
        setMember((current) =>
          current ? { ...current, fingerprint_id: state.fingerprintId } : current,
        );
      }
    };

    // Same 2s cadence the member page uses; the device reports a step every
    // couple of seconds during a capture.
    const timer = setInterval(poll, 2000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, memberId]);

  const enrolled = member?.fingerprint_id != null;

  return (
    <div className="max-w-2xl" ref={top}>
      <StepBar current={step} />

      {step === 1 && (
        <MemberForm
          suggestedId={suggestedId}
          // Hand the created row back instead of navigating away, so the
          // wizard can carry straight on to the sensor.
          onCreated={(created) => {
            setMember(created);
            setStep(2);
          }}
        />
      )}

      {step === 2 && member && (
        <section className="nova-card">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider">
            Enroll Fingerprint
          </h2>
          <p className="mt-1 text-xs text-nova-muted">
            {member.full_name} must be standing at the terminal. This can wait —
            the door simply will not open for them until it is done.
          </p>

          {devices.length === 0 ? (
            <p className="mt-4 text-sm text-nova-muted">
              No active devices yet, so there is nothing to enroll against. Skip this
              step and come back once a terminal is set up.
            </p>
          ) : (
            <FingerprintPanel
              member={member}
              devices={devices}
              activeEnrollment={live}
              isSuperAdmin={isSuperAdmin}
              onDone={() => setStep(3)}
            />
          )}

          <StepFooter
            onSkip={() => setStep(3)}
            skipLabel={enrolled ? "Continue to payment" : "Skip for now"}
          />
        </section>
      )}

      {step === 3 && member && (
        <section className="nova-card">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider">
            Record Payment
          </h2>
          <p className="mt-1 text-xs text-nova-muted">
            New members start inactive. Recording the registration or first monthly
            payment is what activates the membership.
          </p>

          <PaymentPanel
            member={member}
            settings={settings}
            onDone={() => {
              setPaid(true);
              router.push(`/dashboard/members/${member.id}`);
            }}
          />

          <StepFooter
            onSkip={() => router.push(`/dashboard/members/${member.id}`)}
            skipLabel={paid ? "Done" : "Finish without payment"}
          />
        </section>
      )}

      {member && (
        <p className="mt-4 text-xs text-nova-muted">
          <strong className="text-nova-text">{member.full_name}</strong> has been
          created. Anything skipped here stays available on their member page.
        </p>
      )}
    </div>
  );
}

function StepBar({ current }: { current: Step }) {
  return (
    <ol className="mb-5 flex gap-2" aria-label="Progress">
      {STEPS.map(({ n, label, hint }) => {
        const done = n < current;
        const active = n === current;

        return (
          <li key={n} className="min-w-0 flex-1" aria-current={active ? "step" : undefined}>
            <div
              className={`h-1 rounded-full transition-colors ${
                done || active ? "bg-nova-red" : "bg-nova-border"
              }`}
            />
            <p
              className={`mt-2 truncate font-display text-[10px] font-bold uppercase tracking-wider ${
                active ? "text-nova-red" : done ? "text-nova-text" : "text-nova-muted"
              }`}
            >
              {n}. {label}
            </p>
            {/* The hint is the first thing to go when the screen is narrow. */}
            <p className="hidden truncate text-[10px] text-nova-muted sm:block">{hint}</p>
          </li>
        );
      })}
    </ol>
  );
}

function StepFooter({ onSkip, skipLabel }: { onSkip: () => void; skipLabel: string }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-nova-border pt-4">
      <ActionButton variant="ghost" onClick={onSkip}>
        {skipLabel}
      </ActionButton>
    </div>
  );
}

