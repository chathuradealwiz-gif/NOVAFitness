#!/usr/bin/env node
/**
 * Seeds 10 demo members so the dashboard, reports and member app have realistic
 * data to look at.
 *
 *   node scripts/seed-demo.mjs            # create
 *   node scripts/seed-demo.mjs --remove   # delete everything it created
 *
 * Demo rows are deliberately identifiable:
 *   - member numbers 101-110
 *   - members.notes = 'DEMO'
 *   - attendance.event_id starts with 'DEMO-'
 *   - device code GYM-DEMO
 * so --remove can clean up without touching real records.
 *
 * Statuses are produced the way the real app produces them — by recording
 * payments and letting the database triggers compute the period and activate the
 * member — rather than by writing `status` directly. That means this seed also
 * exercises the monthly-period rule.
 *
 * NOT for production. It uses the service-role key and bypasses RLS.
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

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const remove = process.argv.includes("--remove");

const DEVICE_CODE = "GYM-DEMO";
const NUMBERS = Array.from({ length: 10 }, (_, i) => String(101 + i));

/** date helpers — all dates are relative to today so the seed never goes stale */
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
  console.log("Removing demo data…");

  const { data: members } = await db.from("members").select("id").eq("notes", "DEMO");
  const ids = (members ?? []).map((m) => m.id);

  await db.from("attendance").delete().like("event_id", "DEMO-%");

  if (ids.length) {
    // payments is ON DELETE RESTRICT, so financial rows must go first.
    const { data: payments } = await db.from("payments").select("id").in("member_id", ids);
    if (payments?.length) {
      await db
        .from("financial_audit_logs")
        .delete()
        .in("payment_id", payments.map((p) => p.id));
      await db.from("payments").delete().in("member_id", ids);
    }
    // workout/meal plans and their children cascade from members.
    await db.from("members").delete().in("id", ids);
  }

  await db.from("audit_logs").delete().in("entity_id", ids);
  await db.from("devices").delete().eq("device_code", DEVICE_CODE);

  console.log(`Removed ${ids.length} demo member(s) and their related rows.`);
  process.exit(0);
}

// ---------------------------------------------------------------- guard

const { data: existing } = await db.from("members").select("id").eq("notes", "DEMO").limit(1);
if (existing?.length) {
  console.error("Demo data already present. Run with --remove first to reseed.");
  process.exit(1);
}

const { data: clash } = await db.from("members").select("membership_id").in("membership_id", NUMBERS);
if (clash?.length) {
  console.error(
    `Member number(s) already in use: ${clash.map((c) => c.membership_id).join(", ")}.\n` +
      "Edit NUMBERS in this script to a free range.",
  );
  process.exit(1);
}

// Payments are attributed to the super admin if one exists.
const { data: staff } = await db
  .from("profiles")
  .select("id")
  .eq("role", "super_admin")
  .limit(1)
  .maybeSingle();
const recordedBy = staff?.id ?? null;

// ---------------------------------------------------------------- device

const deviceKey = randomBytes(32).toString("base64url");
const { data: device } = await db
  .from("devices")
  .upsert(
    {
      device_code: DEVICE_CODE,
      name: "Demo Entrance Terminal",
      location: "Front door (demo)",
      status: "online",
      last_seen_at: new Date().toISOString(),
      last_sync_at: new Date().toISOString(),
      firmware_version: "1.0.0-demo",
      network_status: "4G LTE -68 dBm",
      pending_events: 0,
      api_key_hash: createHash("sha256").update(deviceKey).digest("hex"),
    },
    { onConflict: "device_code" },
  )
  .select("id")
  .single();

// ---------------------------------------------------------------- members
//
// `plan` drives what payments get recorded, which in turn drives the status the
// triggers compute. `hold` is applied afterwards for the suspended case.

const PEOPLE = [
  { name: "Kasun Perera",       phone: "0771234501", gender: "male",   plan: "current",  fp: 1,    coaching: true },
  { name: "Nimali Fernando",    phone: "0771234502", gender: "female", plan: "current",  fp: 2 },
  { name: "Dilshan Silva",      phone: "0771234503", gender: "male",   plan: "current",  fp: 3 },
  { name: "Tharushi Jayawardena", phone: "0771234504", gender: "female", plan: "current", fp: 4, coaching: true },
  { name: "Ruwan Bandara",      phone: "0771234505", gender: "male",   plan: "current",  fp: 5 },
  { name: "Ishara Wickrama",    phone: "0771234506", gender: "female", plan: "duesoon",  fp: 6 },
  { name: "Chamara Gunasekara", phone: "0771234507", gender: "male",   plan: "expired",  fp: 7 },
  { name: "Sanduni Rathnayake", phone: "0771234508", gender: "female", plan: "expired" },
  { name: "Malith Abeysinghe",  phone: "0771234509", gender: "male",   plan: "current",  fp: 8, hold: "suspended" },
  { name: "Hasini Karunaratne", phone: "0771234510", gender: "female", plan: "none" },
];

console.log("Seeding demo members…");

const created = [];

for (let i = 0; i < PEOPLE.length; i++) {
  const person = PEOPLE[i];
  const number = NUMBERS[i];

  const { data: member, error } = await db
    .from("members")
    .insert({
      membership_id: number,
      full_name: person.name,
      email: `${person.name.split(" ")[0].toLowerCase()}.demo@example.com`,
      phone: person.phone,
      gender: person.gender,
      date_of_birth: iso(new Date(1990 + i, (i * 3) % 12, ((i * 7) % 28) + 1)),
      address: `No. ${10 + i}, Galle Road, Colombo`,
      emergency_contact: `07712345${20 + i}`,
      join_date: iso(monthsAgo(6 - (i % 5))),
      notes: "DEMO",
      // Fingerprint slots are per-device and unrelated to the member number.
      fingerprint_id: person.fp ?? null,
      fingerprint_device_id: person.fp ? device.id : null,
    })
    .select("id, membership_id, full_name")
    .single();

  if (error) {
    console.error(`  ✗ ${person.name}: ${error.message}`);
    continue;
  }

  const payments = [];

  // Everyone who ever joined paid a registration fee.
  if (person.plan !== "none") {
    payments.push({
      member_id: member.id,
      payment_type: "registration",
      amount: 5000,
      payment_date: iso(monthsAgo(6 - (i % 5))),
      description: "Joining fee",
      recorded_by: recordedBy,
    });
  }

  // Monthly membership history, as payment dates. period_start/end are left
  // blank on purpose so the database computes them with the real calendar-month
  // rule — this seed doubles as a check of that rule.
  const monthlyDates = {
    // Three consecutive months, the latest paid this month -> currently active.
    current: [monthsAgo(2), monthsAgo(1), monthsAgo(0)],
    // A single payment 23 days ago, so the period ends about five days from now
    // and the member shows the "payment due soon" warning.
    duesoon: [daysAgo(26)],
    // Last paid months ago -> lapsed.
    expired: [monthsAgo(5), monthsAgo(4)],
  }[person.plan] ?? [];

  for (const date of monthlyDates) {
    payments.push({
      member_id: member.id,
      payment_type: "monthly_membership",
      amount: 3500,
      payment_date: iso(date),
      recorded_by: recordedBy,
    });
  }

  if (person.coaching) {
    payments.push({
      member_id: member.id,
      payment_type: "personal_coaching",
      amount: 8000,
      payment_date: iso(daysAgo(12)),
      period_start: iso(daysAgo(12)),
      period_end: iso(daysAgo(-18)),
      coach_name: "Coach Ravindu",
      description: "8 sessions",
      recorded_by: recordedBy,
    });
  }

  if (payments.length) {
    // Sequential: each insert fires the recompute trigger, so ordering matters
    // for the early-renewal rule.
    for (const payment of payments) {
      const { error: payError } = await db.from("payments").insert(payment);
      if (payError) console.error(`  ! payment for ${person.name}: ${payError.message}`);
    }
  }

  // Administrative hold, applied after payments so it is not overwritten.
  if (person.hold) {
    await db.from("members").update({ status: person.hold }).eq("id", member.id);
  }

  created.push({ ...member, plan: person.plan, fp: person.fp ?? null });
  console.log(`  ✓ No. ${number}  ${person.name}`);
}

// ---------------------------------------------------------------- attendance
//
// 14 days of gym traffic so the dashboard trend chart and the member attendance
// list are not empty.

console.log("Seeding attendance…");

const events = [];
let counter = 0;

for (let back = 13; back >= 0; back--) {
  const day = daysAgo(back);

  for (const member of created) {
    if (!member.fp) continue;                    // no fingerprint, no scans
    if (member.plan === "expired") continue;     // lapsed members stopped coming
    if ((back + Number(member.membership_id)) % 3 === 0) continue; // rest days

    const entry = new Date(day);
    entry.setHours(6 + (Number(member.membership_id) % 5), (back * 7) % 60, 0, 0);

    const exit = new Date(entry);
    exit.setHours(entry.getHours() + 1, entry.getMinutes() + 20);

    events.push(
      {
        event_id: `DEMO-${++counter}`,
        member_id: member.id,
        fingerprint_id: member.fp,
        device_id: device.id,
        event_type: "entry",
        occurred_at: entry.toISOString(),
        authorized: true,
      },
      {
        event_id: `DEMO-${++counter}`,
        member_id: member.id,
        fingerprint_id: member.fp,
        device_id: device.id,
        event_type: "exit",
        occurred_at: exit.toISOString(),
        authorized: true,
      },
    );
  }
}

// One denied scan, so the "denied" styling has something to render.
const suspended = created.find((m) => m.plan === "current" && m.fp === 8);
if (suspended) {
  const when = daysAgo(1);
  when.setHours(18, 42, 0, 0);
  events.push({
    event_id: `DEMO-${++counter}`,
    member_id: suspended.id,
    fingerprint_id: suspended.fp,
    device_id: device.id,
    event_type: "entry",
    occurred_at: when.toISOString(),
    authorized: false,
    denial_reason: "MEMBERSHIP_SUSPENDED",
  });
}

for (let i = 0; i < events.length; i += 200) {
  const { error } = await db.from("attendance").insert(events.slice(i, i + 200));
  if (error) console.error(`  ! attendance batch: ${error.message}`);
}
console.log(`  ✓ ${events.length} attendance events`);

// ---------------------------------------------------------------- plans

console.log("Seeding workout and meal plans…");

const withPlans = created.filter((m) => m.fp).slice(0, 3);

for (const member of withPlans) {
  const { data: plan } = await db
    .from("workout_plans")
    .insert({
      member_id: member.id,
      title: "Strength & Conditioning — Beginner",
      description: "Three sessions a week, full body.",
      trainer_name: "Coach Ravindu",
      start_date: iso(daysAgo(20)),
      end_date: iso(daysAgo(-40)),
      assigned_by: recordedBy,
    })
    .select("id")
    .single();

  if (plan) {
    await db.from("workout_exercises").insert([
      { workout_plan_id: plan.id, day: "monday",    exercise_name: "Treadmill",    duration: "20 min", sort_order: 0 },
      { workout_plan_id: plan.id, day: "monday",    exercise_name: "Squats",       sets: 3, reps: "12", sort_order: 1 },
      { workout_plan_id: plan.id, day: "monday",    exercise_name: "Leg Press",    sets: 3, reps: "10", sort_order: 2 },
      { workout_plan_id: plan.id, day: "wednesday", exercise_name: "Bench Press",  sets: 3, reps: "10", sort_order: 0 },
      { workout_plan_id: plan.id, day: "wednesday", exercise_name: "Lat Pulldown", sets: 3, reps: "12", sort_order: 1 },
      { workout_plan_id: plan.id, day: "friday",    exercise_name: "Deadlift",     sets: 3, reps: "8",  sort_order: 0 },
      { workout_plan_id: plan.id, day: "friday",    exercise_name: "Plank",        duration: "3 × 45 s", sort_order: 1 },
    ]);
  }

  const { data: meal } = await db
    .from("meal_plans")
    .insert({
      member_id: member.id,
      title: "High Protein — Weekday",
      description: "Gym-provided guidance, not medical advice.",
      start_date: iso(daysAgo(20)),
      assigned_by: recordedBy,
    })
    .select("id")
    .single();

  if (meal) {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    await db.from("meal_plan_items").insert(
      days.flatMap((day, index) => [
        { meal_plan_id: meal.id, day, meal_type: "breakfast", description: "Eggs, oats and fruit",       calories: 450, sort_order: index * 4 },
        { meal_plan_id: meal.id, day, meal_type: "lunch",     description: "Rice, chicken, vegetables",  calories: 700, sort_order: index * 4 + 1 },
        { meal_plan_id: meal.id, day, meal_type: "snack",     description: "Yoghurt and a banana",       calories: 220, sort_order: index * 4 + 2 },
        { meal_plan_id: meal.id, day, meal_type: "dinner",    description: "Grilled fish and salad",     calories: 550, sort_order: index * 4 + 3 },
      ]),
    );
  }
}
console.log(`  ✓ plans for ${withPlans.length} member(s)`);

// ---------------------------------------------------------------- summary

const { data: summary } = await db
  .from("members")
  .select("membership_id, full_name, status, membership_end, next_payment_date")
  .eq("notes", "DEMO")
  .order("membership_id");

console.log("\nDemo members:");
console.table(summary);
console.log(`Demo device ${DEVICE_CODE} key (not stored anywhere): ${deviceKey}`);
console.log("\nRemove it all again with: node scripts/seed-demo.mjs --remove");
