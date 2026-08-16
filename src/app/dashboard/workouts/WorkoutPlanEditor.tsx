"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { saveWorkoutPlan } from "@/lib/actions/plans";
import { DAYS } from "@/lib/constants";
import type { Member, WorkoutExercise, WorkoutPlan } from "@/types/database";

type Day = (typeof DAYS)[number];

interface Draft {
  day: Day;
  exercise_name: string;
  sets: string;
  reps: string;
  duration: string;
  notes: string;
}

const emptyRow = (day: Day): Draft => ({
  day,
  exercise_name: "",
  sets: "",
  reps: "",
  duration: "",
  notes: "",
});

export function WorkoutPlanEditor({
  member,
  plan,
  exercises,
}: {
  member: Pick<Member, "id" | "full_name" | "membership_id">;
  plan?: WorkoutPlan;
  exercises?: WorkoutExercise[];
}) {
  const router = useRouter();

  const [rows, setRows] = useState<Draft[]>(
    exercises?.length
      ? exercises.map((exercise) => ({
          day: exercise.day as Day,
          exercise_name: exercise.exercise_name,
          sets: exercise.sets?.toString() ?? "",
          reps: exercise.reps ?? "",
          duration: exercise.duration ?? "",
          notes: exercise.notes ?? "",
        }))
      : [emptyRow("monday")],
  );

  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [trainer, setTrainer] = useState(plan?.trainer_name ?? "");
  const [startDate, setStartDate] = useState(plan?.start_date ?? "");
  const [endDate, setEndDate] = useState(plan?.end_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(index: number, patch: Partial<Draft>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);

    const result = await saveWorkoutPlan(
      {
        member_id: member.id,
        title,
        description: description || null,
        trainer_name: trainer || null,
        start_date: startDate || null,
        end_date: endDate || null,
        exercises: rows
          // Blank rows are scaffolding, not data.
          .filter((row) => row.exercise_name.trim())
          .map((row) => ({
            day: row.day,
            exercise_name: row.exercise_name.trim(),
            sets: row.sets ? Number(row.sets) : null,
            reps: row.reps || null,
            duration: row.duration || null,
            weight: null,
            notes: row.notes || null,
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
            placeholder="Weight Loss — Beginner"
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Trainer / Coach">
            <input
              className="nova-input"
              value={trainer}
              onChange={(event) => setTrainer(event.target.value)}
            />
          </Field>
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
        <h2 className="mb-3 text-sm font-semibold">Exercises</h2>

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

              <input
                className="nova-input py-2 sm:col-span-4"
                placeholder="Exercise"
                value={row.exercise_name}
                onChange={(event) => update(index, { exercise_name: event.target.value })}
              />
              <input
                className="nova-input py-2 sm:col-span-1"
                placeholder="Sets"
                inputMode="numeric"
                value={row.sets}
                onChange={(event) => update(index, { sets: event.target.value })}
              />
              <input
                className="nova-input py-2 sm:col-span-2"
                placeholder="Reps"
                value={row.reps}
                onChange={(event) => update(index, { reps: event.target.value })}
              />
              <input
                className="nova-input py-2 sm:col-span-2"
                placeholder="Duration"
                value={row.duration}
                onChange={(event) => update(index, { duration: event.target.value })}
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
          Add Exercise
        </button>
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
