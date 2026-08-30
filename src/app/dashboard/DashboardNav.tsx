"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ComponentType, MouseEvent } from "react";
import {
  IconAdmins,
  IconAttendance,
  IconAudit,
  IconBroadcast,
  IconDashboard,
  IconDevice,
  IconFinance,
  IconMeal,
  IconMembers,
  IconMore,
  IconPay,
  IconPayments,
  IconSettings,
  IconWorkout,
  type IconProps,
} from "@/components/icons";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  superAdminOnly?: boolean;
  /** Shown in the 5-slot mobile bar; the rest live behind "More" (spec §55). */
  primary?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard, primary: true },
  { href: "/dashboard/members", label: "Members", icon: IconMembers, primary: true },
  { href: "/dashboard/pay", label: "Pay", icon: IconPay, primary: true },
  { href: "/dashboard/attendance", label: "Attendance", icon: IconAttendance, primary: true },
  { href: "/dashboard/payments", label: "Payments", icon: IconPayments },
  { href: "/dashboard/finance", label: "Financial Reports", icon: IconFinance },
  { href: "/dashboard/workouts", label: "Workout Plans", icon: IconWorkout },
  { href: "/dashboard/meals", label: "Meal Plans", icon: IconMeal },
  { href: "/dashboard/broadcasts", label: "Broadcasts", icon: IconBroadcast },
  { href: "/dashboard/devices", label: "Devices", icon: IconDevice },
  { href: "/dashboard/admins", label: "Administrators", icon: IconAdmins, superAdminOnly: true },
  { href: "/dashboard/audit", label: "Audit Logs", icon: IconAudit, superAdminOnly: true },
  { href: "/dashboard/settings", label: "Gym Settings", icon: IconSettings },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function DashboardNav({
  isSuperAdmin,
  variant,
}: {
  isSuperAdmin: boolean;
  variant: "sidebar" | "bottom";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  // Which destination is being loaded. A dashboard route is server-rendered, so
  // between the tap and the new screen there was nothing at all to look at —
  // which is what made the bar feel unresponsive. The tapped item now lights up
  // as if it were already the current page.
  const [target, setTarget] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // The navigation landed (or was abandoned for another route); stop showing
    // the old destination as loading.
    if (!pending) setTarget(null);
  }, [pending, pathname]);

  function go(href: string, event: MouseEvent<HTMLAnchorElement>) {
    // Leave modified clicks (new tab, middle click) to the browser.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    setMoreOpen(false);
    if (href === pathname) return;
    setTarget(href);
    startTransition(() => router.push(href));
  }

  const items = ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin);

  if (variant === "sidebar") {
    return (
      <nav className="mt-8 space-y-1">
        {items.map((item) => {
          const active = target === item.href || (!target && isActive(pathname, item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => go(item.href, event)}
              aria-busy={target === item.href}
              className={`nova-tap relative flex items-center gap-3 rounded-lg px-3 py-2.5 font-display
                text-[11px] font-bold uppercase tracking-wider transition-all ${
                  active
                    ? "bg-nova-red/12 text-nova-red shadow-glowSoft"
                    : "text-nova-muted hover:bg-white/5 hover:text-nova-text"
                }`}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-nova-red" />
              )}
              <Icon size={18} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  const primary = items.filter((item) => item.primary);
  const secondary = items.filter((item) => !item.primary);

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 lg:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-16 rounded-t-2xl border-t border-nova-border bg-nova-surface p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid grid-cols-2 gap-2">
              {secondary.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(event) => go(item.href, event)}
                    aria-busy={target === item.href}
                    className={`nova-tap flex items-center gap-2.5 rounded-xl border px-3 py-3
                      font-display text-[11px] font-bold uppercase tracking-wide ${
                        target === item.href
                          ? "border-nova-red/60 bg-nova-red/15 text-nova-red"
                          : "border-nova-border text-nova-text"
                      }`}
                  >
                    <Icon size={17} className="shrink-0 text-nova-red" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-nova-border bg-nova-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {primary.map((item) => {
          const loading = target === item.href;
          // Treat the destination as current the moment it is tapped. Waiting
          // for the route to commit is the entire delay being complained about.
          const active = loading || (!target && isActive(pathname, item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => go(item.href, event)}
              aria-busy={loading}
              className={`nova-tap relative flex min-h-[58px] flex-col items-center justify-center
                gap-1 px-1 font-display text-[9px] font-bold uppercase tracking-wide ${
                  active ? "text-nova-red" : "text-nova-muted"
                }`}
            >
              {active && (
                <span
                  className={`absolute inset-x-3 top-0 h-[2px] rounded-full bg-nova-red shadow-glowSoft ${
                    loading ? "animate-pulse" : ""
                  }`}
                />
              )}
              <Icon size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          className={`nova-tap flex min-h-[58px] flex-col items-center justify-center gap-1 font-display
            text-[9px] font-bold uppercase tracking-wide ${
              moreOpen ? "text-nova-red" : "text-nova-muted"
            }`}
        >
          <IconMore size={19} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
