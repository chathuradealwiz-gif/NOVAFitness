#!/usr/bin/env node
/**
 * Fills out one existing member with realistic sample data, so a specific profile
 * has something to look at end to end.
 *
 *   node scripts/seed-member.mjs 34
 *   node scripts/seed-member.mjs 34 --remove
 *
 * Adds: registration + monthly payments (which activate the membership through the
 * normal triggers), a fingerprint enrolment on the demo device, two weeks of
 * attendance, a workout plan and a meal plan.
 *
 * Unlike seed-demo.mjs this touches a member you already created, so --remove only
 * deletes the rows this script added — the member record itself is left alone.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch {
  /* fall back to the ambient environment */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const number = args.find((a) => /^\d+$/.test(a));

if (!number) {
  console.error("Usage: node scripts/seed-member.mjs <member-number> [--remove]");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const TAG = `SEED-${number}`;

const { data: member } = await db
  .from("members")
  .select("id, membership_id, full_name, status")
  .eq("membership_id", number)
  .maybeSingle();

if (!member) {
  console.error(`No member with number ${number}.`);
  process.exit(1);
}

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
};
const monthsAgo = (n) => {
  const d = new Date(today);
  d.setMonth(d.getMonth() - n);
  return d;
};

// ---------------------------------------------------------------- teardown

if (remove) {
  console.log(`Removing sample data for No. ${number} (${member.full_name})…`);

  await db.from("attendance").delete().like("event_id", `${TAG}-%`);

  const { data: payments } = await db
    .from("payments")
    .select("id")
    .eq("member_id", member.id)
    .eq("description", TAG);

  if (payments?.length) {
    await db.from("financial_audit_logs").delete().in("payment_id", payments.map((p) => p.id));
    await db.from("payments").delete().in("id", payments.map((p) => p.id));
  }

  await db.from("workout_plans").delete().eq("member_id", member.id);
  await db.from("meal_plans").delete().eq("member_id", member.id);
  await db
    .from("members")
    .update({ fingerprint_id: null, fingerprint_device_id: null })
    .eq("id", member.id);

  console.log("Done. The member record itself was left untouched.");
  process.exit(0);
}

// ---------------------------------------------------------------- device

// Reuse the demo terminal if it exists, otherwise create one.
let { data: device } = await db
  .from("devices")
  .select("id")
  .eq("device_code", "GYM-DEMO")
  .maybeSingle();

if (!device) {
  const key = randomBytes(32).toString("base64url");
  ({ data: device } = await db
    .from("devices")
    .insert({
      device_code: "GYM-DEMO",
      name: "Demo Entrance Terminal",
      location: "Front door (demo)",
      status: "online",
      last_seen_at: new Date().toISOString(),
      firmware_version: "1.0.0-demo",
      network_status: "4G LTE -68 dBm",
      api_key_hash: createHash("sha256").update(key).digest("hex"),
    })
    .select("id")
    .single());
}

const { data: staff } = await db
  .from("profiles")
  .select("id")
  .eq("role", "super_admin")
  .limit(1)
  .maybeSingle();
const recordedBy = staff?.id ?? null;

console.log(`Seeding No. ${number} — ${member.full_name}`);

// ---------------------------------------------------------------- fingerprint

// Pick a free slot on this device so the unique (device, slot) index is respected.
const { data: used } = await db
  .from("members")
  .select("fingerprint_id")
  .eq("fingerprint_device_id", device.id)
  .not("fingerprint_id", "is", null);

const taken = new Set((used ?? []).map((u) => u.fingerprint_id));
let slot = 1;
while (taken.has(slot)) slot++;

await db
  .from("members")
  .update({
    fingerprint_id: slot,
    fingerprint_device_id: device.id,
    date_of_birth: "1996-04-12",
    gender: "male",
    address: "No. 88, Marine Drive, Colombo 03",
  })
  .eq("id", member.id);

console.log(`  ✓ fingerprint slot #${slot} on GYM-DEMO`);

// ---------------------------------------------------------------- payments
//
// period_start/end are left blank so the database applies the real calendar-month
// rule, and the triggers activate the membership.

const payments = [
  { payment_type: "registration",      amount: 5000, payment_date: iso(monthsAgo(3)) },
  { payment_type: "monthly_membership", amount: 3500, payment_date: iso(monthsAgo(2)) },
  { payment_type: "monthly_membership", amount: 3500, payment_date: iso(monthsAgo(1)) },
  { payment_type: "monthly_membership", amount: 3500, payment_date: iso(monthsAgo(0)) },
  {
    payment_type: "personal_coaching",
    amount: 8000,
    payment_date: iso(daysAgo(10)),
    period_start: iso(daysAgo(10)),
    period_end: iso(daysAgo(-20)),
    coach_name: "Coach Ravindu",
  },
];

for (const payment of payments) {
  const { error } = await db
    .from("payments")
    .insert({ ...payment, member_id: member.id, recorded_by: recordedBy, description: TAG });
  if (error) console.error(`  ! payment: ${error.message}`);
}
console.log(`  ✓ ${payments.length} payments`);

// ---------------------------------------------------------------- attendance

const events = [];
let counter = 0;

for (let back = 13; back >= 0; back--) {
  if (back % 3 === 0) continue; // rest days

  const entry = daysAgo(back);
  entry.setHours(7, (back * 11) % 60, 0, 0);
  const exit = new Date(entry);
  exit.setHours(8, entry.getMinutes() + 25);

  events.push(
    {
      event_id: `${TAG}-${++counter}`,
      member_id: member.id,
      fingerprint_id: slot,
      device_id: device.id,
      event_type: "entry",
      occurred_at: entry.toISOString(),
      authorized: true,
    },
    {
      event_id: `${TAG}-${++counter}`,
      member_id: member.id,
      fingerprint_id: slot,
      device_id: device.id,
      event_type: "exit",
      occurred_at: exit.toISOString(),
      authorized: true,
    },
  );
}

await db.from("attendance").insert(events);
console.log(`  ✓ ${events.length} attendance events`);

// ---------------------------------------------------------------- plans

const { data: plan } = await db
  .from("workout_plans")
  .insert({
    member_id: member.id,
    title: "Muscle Gain — Intermediate",
    description: "Four sessions a week, upper/lower split.",
    trainer_name: "Coach Ravindu",
    start_date: iso(daysAgo(14)),
    end_date: iso(daysAgo(-46)),
    assigned_by: recordedBy,
  })
  .select("id")
  .single();

await db.from("workout_exercises").insert([
  { workout_plan_id: plan.id, day: "monday",    exercise_name: "Bench Press",   sets: 4, reps: "8",  weight: "40 kg", sort_order: 0 },
  { workout_plan_id: plan.id, day: "monday",    exercise_name: "Incline Dumbbell Press", sets: 3, reps: "10", sort_order: 1 },
  { workout_plan_id: plan.id, day: "monday",    exercise_name: "Cable Fly",     sets: 3, reps: "12", sort_order: 2 },
  { workout_plan_id: plan.id, day: "tuesday",   exercise_name: "Squats",        sets: 4, reps: "8",  weight: "60 kg", sort_order: 0 },
  { workout_plan_id: plan.id, day: "tuesday",   exercise_name: "Leg Press",     sets: 3, reps: "12", sort_order: 1 },
  { workout_plan_id: plan.id, day: "thursday",  exercise_name: "Deadlift",      sets: 4, reps: "6",  weight: "70 kg", sort_order: 0 },
  { workout_plan_id: plan.id, day: "thursday",  exercise_name: "Lat Pulldown",  sets: 3, reps: "12", sort_order: 1 },
  { workout_plan_id: plan.id, day: "thursday",  exercise_name: "Barbell Row",   sets: 3, reps: "10", sort_order: 2 },
  { workout_plan_id: plan.id, day: "friday",    exercise_name: "Shoulder Press", sets: 4, reps: "10", sort_order: 0 },
  { workout_plan_id: plan.id, day: "friday",    exercise_name: "Lateral Raise", sets: 3, reps: "15", sort_order: 1 },
  { workout_plan_id: plan.id, day: "friday",    exercise_name: "Treadmill",     duration: "15 min", sort_order: 2 },
  { workout_plan_id: plan.id, day: "saturday",  exercise_name: "Plank",         duration: "3 × 60 s", sort_order: 0 },
]);

const { data: meal } = await db
  .from("meal_plans")
  .insert({
    member_id: member.id,
    title: "Lean Bulk — 2,600 kcal",
    description: "Gym-provided guidance, not medical advice.",
    start_date: iso(daysAgo(14)),
    assigned_by: recordedBy,
  })
  .select("id")
  .single();

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
await db.from("meal_plan_items").insert(
  DAYS.flatMap((day, i) => [
    { meal_plan_id: meal.id, day, meal_type: "breakfast", description: "3 eggs, oats with banana, black coffee", calories: 560, sort_order: i * 4 },
    { meal_plan_id: meal.id, day, meal_type: "lunch",     description: "Red rice, grilled chicken, dhal, salad",  calories: 820, sort_order: i * 4 + 1 },
    { meal_plan_id: meal.id, day, meal_type: "snack",     description: "Whey shake and a handful of almonds",     calories: 380, sort_order: i * 4 + 2 },
    { meal_plan_id: meal.id, day, meal_type: "dinner",    description: "Grilled fish, sweet potato, greens",      calories: 640, sort_order: i * 4 + 3 },
  ]),
);

console.log("  ✓ workout plan (12 exercises) and meal plan (28 meals)");

// ---------------------------------------------------------------- summary

const { data: after } = await db
  .from("members")
  .select("membership_id, full_name, status, membership_start, membership_end, next_payment_date, fingerprint_id")
  .eq("id", member.id)
  .single();

console.log("\nResult:");
console.table([after]);
console.log(`Undo with: node scripts/seed-member.mjs ${number} --remove`);
