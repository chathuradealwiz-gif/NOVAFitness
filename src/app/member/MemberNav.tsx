"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconAttendance,
  IconHome,
  IconMeal,
  IconProfile,
  IconWorkout,
} from "@/components/icons";

// Spec §55: Home, Attendance, Workout, Meal Plan, Profile.
// Payments lives inside Home so the bar stays at five thumb-sized targets.
const ITEMS = [
  { href: "/member", label: "Home", icon: IconHome },
  { href: "/member/attendance", label: "Attendance", icon: IconAttendance },
  { href: "/member/workout", label: "Workout", icon: IconWorkout },
  { href: "/member/meal-plan", label: "Meals", icon: IconMeal },
  { href: "/member/profile", label: "Profile", icon: IconProfile },
];

export function MemberNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto grid max-w-lg grid-cols-5 border-t border-nova-border bg-nova-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {ITEMS.map((item) => {
        const active =
          item.href === "/member" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1
              font-display text-[9px] font-bold uppercase tracking-wider transition-colors ${
                active ? "text-nova-red" : "text-nova-muted hover:text-nova-text"
              }`}
          >
            {/* Lit bar above the active tab. */}
            {active && (
              <span className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-nova-red shadow-glowSoft" />
            )}
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
