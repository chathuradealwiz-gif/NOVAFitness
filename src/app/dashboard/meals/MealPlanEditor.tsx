"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { saveMealPlan } from "@/lib/actions/plans";
import { DAYS } from "@/lib/constants";
import type { MealPlan, MealPlanItem, Member } from "@/types/database";

type Day = (typeof DAYS)[number];
const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"] as const;
type MealType = (typeof MEAL_TYPES)[number];

interface Draft {
  day: Day;
  meal_type: MealType;
  description: string;
  calories: string;
}

const emptyRow = (day: Day, meal_type: MealType = "breakfast"): Draft => ({
  day,
  meal_type,
  description: "",
  calories: "",
});

export function MealPlanEditor({
  member,
  plan,
  items,
}: {
  member: Pick<Member, "id" | "full_name" | "membership_id">;
  plan?: MealPlan;
  items?: MealPlanItem[];
}) {
  const router = useRouter();

  const [rows, setRows] = useState<Draft[]>(
    items?.length
      ? items.map((item) => ({
          day: item.day as Day,
          meal_type: item.meal_type as MealType,
          description: item.description,
          calories: item.calories?.toString() ?? "",
        }))
      : MEAL_TYPES.map((type) => emptyRow("monday", type)),
  );

  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [startDate, setStartDate] = useState(plan?.start_date ?? "");
  const [endDate, setEndDate] = useState(plan?.end_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(index: number, patch: Partial<Draft>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    setBusy(true);
    setError(null);

    const result = await saveMealPlan(
      {
        member_id: member.id,
        title,
        description: description || null,
        start_date: startDate || null,
        end_date: endDate || null,
        items: rows
          .filter((row) => row.description.trim())
          .map((row) => ({
            day: row.day,
            meal_type: row.meal_type,
            description: row.description.trim(),
            calories: row.calories ? Number(row.calories) : null,
            notes: null,
          })),
      },
      plan?.id,
    );

    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save the plan.");
      return;
    }
    router.push(`/dashboard/members/${member.id}`);
  }

  return (
    <div className="space-y-4">
      <section className="nova-card space-y-4">
        <p className="text-sm text-nova-muted">
          For <span className="font-medium text-nova-text">{member.full_name}</span> ·{" "}
          <span className="font-mono">{member.membership_id}</span>
        </p>

        <Field label="Plan Title">
          <input
            className="nova-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="High Protein — Weekday"
          />
        </Field>

        <Field label="Description">
          <textarea
            rows={2}
            className="nova-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start Date">
            <input
              type="date"
              className="nova-input"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field label="End Date">
            <input
              type="date"
              className="nova-input"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="nova-card">
        <h2 className="mb-3 text-sm font-semibold">Meals</h2>

        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-xl border border-nova-border p-3 sm:grid-cols-12"
            >
              <select
                className="nova-input py-2 sm:col-span-2"
                value={row.day}
                onChange={(event) => update(index, { day: event.target.value as Day })}
              >
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day[0].toUpperCase() + day.slice(1, 3)}
                  </option>
                ))}
              </select>

              <select
                className="nova-input py-2 sm:col-span-2"
                value={row.meal_type}
                onChange={(event) => update(index, { meal_type: event.target.value as MealType })}
              >
                {MEAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type[0].toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>

              <input
                className="nova-input py-2 sm:col-span-5"
                placeholder="Eggs, oats, fruit"
                value={row.description}
                onChange={(event) => update(index, { description: event.target.value })}
              />

              <input
                className="nova-input py-2 sm:col-span-2"
                placeholder="kcal"
                inputMode="numeric"
                value={row.calories}
                onChange={(event) => update(index, { calories: event.target.value })}
              />

              <button
                className="text-xs text-nova-muted hover:text-nova-red sm:col-span-1"
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                disabled={rows.length === 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          className="nova-btn-ghost mt-3"
          onClick={() =>
            setRows((current) => [...current, emptyRow(current[current.length - 1]?.day ?? "monday")])
          }
        >
          Add Meal
        </button>

        <p className="mt-3 text-xs text-nova-muted">
          These are gym-provided plans, not medical or dietary advice.
        </p>
      </section>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <div className="flex gap-2">
        <button className="nova-btn-primary" onClick={save} disabled={busy}>
          {busy ? (<><Spinner size={16} /> Saving…</>) : "Save Plan"}
        </button>
        <button className="nova-btn-ghost" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
