// Plain shared constants.
//
// These deliberately do NOT live in lib/actions/*.ts: those files are marked
// "use server", and a "use server" module may only export async functions —
// exporting a constant from one throws at runtime.

export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Day = (typeof DAYS)[number];

export const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"] as const;

export type MealType = (typeof MEAL_TYPES)[number];

/** Maps JS `Date.getDay()` (0 = Sunday) onto our Monday-first day names. */
export const DAY_BY_INDEX = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** The current day name, e.g. "monday". */
export function today(): Day {
  return DAY_BY_INDEX[new Date().getDay()] as Day;
}
