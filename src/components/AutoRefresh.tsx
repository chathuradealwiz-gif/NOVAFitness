"use client";

/**
 * Re-fetches the page it sits on when staff arrive at it, and again whenever
 * they come back to the tab.
 *
 * Dashboard routes are server-rendered per request, so the data is fresh the
 * first time. What is not fresh is a return visit: Next keeps a client-side
 * Router Cache, and navigating back to a page seen moments ago replays the
 * cached payload rather than asking the server. Most screens can live with
 * that — but this gym's data changes without anyone touching the dashboard.
 * The door terminal writes attendance, completes a fingerprint enrolment and
 * reports its own health on its own schedule, so a member page opened right
 * after a scan would show the state from before it.
 *
 * `router.refresh()` re-runs the server components and reconciles in place: no
 * spinner, no lost scroll position, and anything the member is halfway through
 * typing in a panel stays put.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({
  /**
   * Also refresh on a timer, in seconds. Only worth it for a screen someone
   * leaves open and watches — the terminal's own polling is the floor on how
   * fresh anything can be, so anything under that is just extra load.
   */
  intervalSeconds,
}: {
  intervalSeconds?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    // On arrival, including a back-navigation that the Router Cache served.
    router.refresh();

    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Reception locks the phone between members; coming back to it is the most
    // common way to land on a stale screen.
    window.addEventListener("focus", onVisible);

    const timer = intervalSeconds
      ? setInterval(() => {
          // Refreshing a hidden tab spends the gym's bandwidth on a screen
          // nobody is reading.
          if (document.visibilityState === "visible") router.refresh();
        }, intervalSeconds * 1000)
      : null;

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [router, intervalSeconds]);

  return null;
}
