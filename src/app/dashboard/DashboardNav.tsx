"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
  superAdminOnly?: boolean;
  /** Shown in the 5-slot mobile bar; the rest live behind "More" (spec §55). */
  primary?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", primary: true },
  { href: "/dashboard/members", label: "Members", primary: true },
  { href: "/dashboard/attendance", label: "Attendance", primary: true },
  { href: "/dashboard/payments", label: "Payments", primary: true },
  { href: "/dashboard/finance", label: "Financial Reports" },
  { href: "/dashboard/workouts", label: "Workout Plans" },
  { href: "/dashboard/meals", label: "Meal Plans" },
  { href: "/dashboard/broadcasts", label: "Broadcasts" },
  { href: "/dashboard/devices", label: "Devices" },
  { href: "/dashboard/admins", label: "Administrators", superAdminOnly: true },
  { href: "/dashboard/audit", label: "Audit Logs", superAdminOnly: true },
  { href: "/dashboard/settings", label: "Gym Settings" },
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
  const [moreOpen, setMoreOpen] = useState(false);

  const items = ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin);

  if (variant === "sidebar") {
    return (
      <nav className="mt-8 space-y-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`relative block rounded-lg px-3 py-2.5 font-display text-[11px]
              font-bold uppercase tracking-wider transition-all ${
                isActive(pathname, item.href)
                  ? "bg-nova-red/12 text-nova-red shadow-glowSoft"
                  : "text-nova-muted hover:bg-white/5 hover:text-nova-text"
              }`}
          >
            {isActive(pathname, item.href) && (
              <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-nova-red" />
            )}
            {item.label}
          </Link>
        ))}
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
              {secondary.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="rounded-xl border border-nova-border px-3 py-3 text-sm font-medium"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-nova-border bg-nova-surface/95 backdrop-blur lg:hidden">
        {primary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex min-h-[58px] flex-col items-center justify-center px-1
              font-display text-[10px] font-bold uppercase tracking-wide ${
                isActive(pathname, item.href) ? "text-nova-red" : "text-nova-muted"
              }`}
          >
            {isActive(pathname, item.href) && (
              <span className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-nova-red shadow-glowSoft" />
            )}
            {item.label}
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex min-h-[58px] flex-col items-center justify-center font-display
            text-[10px] font-bold uppercase tracking-wide ${
              moreOpen ? "text-nova-red" : "text-nova-muted"
            }`}
        >
          More
        </button>
      </nav>
    </>
  );
}
