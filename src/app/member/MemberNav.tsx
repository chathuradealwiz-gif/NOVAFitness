"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Spec §55: Home, Attendance, Workout, Meal Plan, Profile.
// Payments lives inside Home so the bar stays at five thumb-sized targets.
const ITEMS = [
  { href: "/member", label: "Home" },
  { href: "/member/attendance", label: "Attendance" },
  { href: "/member/workout", label: "Workout" },
  { href: "/member/meal-plan", label: "Meals" },
  { href: "/member/profile", label: "Profile" },
];

export function MemberNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto grid max-w-lg grid-cols-5 border-t border-nova-border bg-nova-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {ITEMS.map((item) => {
        const active =
          item.href === "/member" ? pathname === item.href : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex min-h-[58px] flex-col items-center justify-center
              font-display text-[10px] font-bold uppercase tracking-wider transition-colors ${
                active ? "text-nova-red" : "text-nova-muted hover:text-nova-text"
              }`}
          >
            {/* Lit bar above the active tab. */}
            {active && (
              <span className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-nova-red shadow-glowSoft" />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
