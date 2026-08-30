"use client";

/**
 * Buttons that confirm they were pressed.
 *
 * Reception works the dashboard one-handed on a phone, where a fingertip covers
 * the control it is pressing and there is no hover state to fall back on. An
 * action that only reacts once the server answers reads as a dead button, so
 * staff tap it again — which is how a member ended up with a second enrollment
 * request. Every button here therefore does three things:
 *
 *   - shrinks and dims under the finger (see .nova-btn:active in globals.css),
 *     visible around the fingertip rather than beneath it;
 *   - shows a bar sweeping across its foot for as long as the work is running;
 *   - refuses to fire again while that bar is showing.
 *
 * The guard is a ref, not the busy state: two taps in the same tick both read
 * the pre-render value of state and both get through. This mirrors the token
 * ref already guarding the payment form.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "nova-btn-primary",
  ghost: "nova-btn-ghost",
};

function classes(variant: Variant, busy: boolean, extra?: string) {
  return [VARIANT[variant], busy && "nova-btn-progress", extra]
    .filter(Boolean)
    .join(" ");
}

/**
 * A button whose `onClick` returns a promise. Stays busy until it settles.
 *
 * `busyLabel` replaces the label while running. Leave it out to keep the label
 * steady — better for short actions, where swapping the text makes the button
 * flicker without telling staff anything the bar has not already said.
 */
export function ActionButton({
  onClick,
  children,
  busyLabel,
  variant = "primary",
  className,
  disabled,
  busy: externalBusy = false,
  ...rest
}: {
  onClick: () => void | Promise<unknown>;
  children: ReactNode;
  busyLabel?: ReactNode;
  variant?: Variant;
  /**
   * Keeps the button busy for work it cannot see the end of — a navigation
   * started inside `onClick` outlives the promise, so without this the bar
   * stops the instant the handler returns and the button looks finished while
   * the next screen is still loading.
   */
  busy?: boolean;
} & Omit<ComponentProps<"button">, "onClick" | "children" | "busy">) {
  const [internalBusy, setInternalBusy] = useState(false);
  const busy = internalBusy || externalBusy;
  const running = useRef(false);
  // The action can navigate or unmount the panel it lives in; setting state on
  // the way out would warn and, worse, leave the guard latched.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handle = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setInternalBusy(true);
    try {
      await onClick();
    } finally {
      running.current = false;
      if (mounted.current) setInternalBusy(false);
    }
  }, [onClick]);

  return (
    <button
      type="button"
      {...rest}
      onClick={handle}
      disabled={disabled || busy}
      aria-busy={busy}
      className={classes(variant, busy, className)}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/**
 * Submit button for a `<form action={...}>`. The form owns the pending state,
 * so this only needs to be told about it.
 */
export function SubmitButton({
  busy,
  children,
  busyLabel,
  variant = "primary",
  className,
  disabled,
  ...rest
}: {
  busy: boolean;
  children: ReactNode;
  busyLabel?: ReactNode;
  variant?: Variant;
} & Omit<ComponentProps<"button">, "children">) {
  return (
    <button
      type="submit"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy}
      className={classes(variant, busy, className)}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/**
 * A link styled as a button that shows it was pressed.
 *
 * A plain <Link> to a server-rendered route sits inert while the server works —
 * the route's loading.tsx only appears once navigation actually commits, which
 * on a phone on gym wi-fi is well after the tap. useTransition gives us the gap
 * in between, which is exactly the window staff were tapping twice in.
 */
export function LinkButton({
  href,
  children,
  variant = "ghost",
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
} & Omit<ComponentProps<typeof Link>, "href" | "children">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Link
      href={href}
      {...rest}
      onClick={(event) => {
        // Let the browser handle modified clicks (new tab, etc.) untouched.
        if (event.defaultPrevented || event.metaKey || event.ctrlKey ||
            event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        startTransition(() => router.push(href));
      }}
      aria-busy={pending}
      className={classes(variant, pending, className)}
    >
      {children}
    </Link>
  );
}

/**
 * Toggle for a disclosure panel — "Record Payment", "Enroll Fingerprint".
 *
 * These were the worst offenders on a phone: they open a panel further down the
 * page, so on a small screen the tap appeared to do nothing at all. The button
 * now holds an obviously-selected state while its panel is open, and the caller
 * scrolls the panel into view.
 */
export function PanelToggle({
  open,
  children,
  className,
  ...rest
}: { open: boolean; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      aria-expanded={open}
      className={[
        open
          ? "nova-btn border border-nova-red/60 bg-nova-red/15 text-nova-red"
          : "nova-btn-ghost",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}
