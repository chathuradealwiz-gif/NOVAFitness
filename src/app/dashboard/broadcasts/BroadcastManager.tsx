"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { archiveBroadcast, saveBroadcast, setBroadcastActive } from "@/lib/actions/settings";
import { formatDateTime } from "@/lib/format";
import type { BannerType, BroadcastMessage } from "@/types/database";

const BANNER_STYLES: Record<BannerType, string> = {
  info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  danger: "border-nova-red/30 bg-nova-red/10 text-nova-red",
};

export function BroadcastManager({ broadcasts }: { broadcasts: BroadcastMessage[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<BroadcastMessage | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    setError(null);
    const result = await saveBroadcast(formData, editing?.id);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save the message.");
      return;
    }
    setEditing(null);
    setCreating(false);
    router.refresh();
  }

  async function toggle(broadcast: BroadcastMessage) {
    await setBroadcastActive(broadcast.id, !broadcast.is_active);
    router.refresh();
  }

  async function archive(broadcast: BroadcastMessage) {
    await archiveBroadcast(broadcast.id);
    router.refresh();
  }

  const showForm = creating || editing !== null;

  return (
    <div className="space-y-4">
      {!showForm && (
        <button className="nova-btn-primary" onClick={() => setCreating(true)}>
          New Message
        </button>
      )}

      {showForm && (
        <form action={handleSubmit} className="nova-card space-y-4">
          <h2 className="text-sm font-semibold">{editing ? "Edit message" : "New message"}</h2>

          <Field label="Title">
            <input name="title" className="nova-input" required defaultValue={editing?.title} />
          </Field>

          <Field label="Message">
            <textarea
              name="message"
              rows={3}
              className="nova-input"
              required
              defaultValue={editing?.message}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Banner Type">
              <select
                name="banner_type"
                className="nova-input"
                defaultValue={editing?.banner_type ?? "info"}
              >
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="danger">Danger</option>
              </select>
            </Field>

            <Field label="Dismissible" hint="Uncheck for messages members must not hide.">
              <label className="flex min-h-[44px] items-center gap-2">
                <input
                  type="checkbox"
                  name="dismissible"
                  className="h-5 w-5 accent-nova-red"
                  defaultChecked={editing?.dismissible ?? true}
                />
                <span className="text-sm">Members can dismiss this</span>
              </label>
            </Field>

            <Field label="Show From">
              <input
                name="start_at"
                type="datetime-local"
                className="nova-input"
                required
                defaultValue={(editing?.start_at ?? new Date().toISOString()).slice(0, 16)}
              />
            </Field>

            <Field label="Show Until" hint="Leave blank to show indefinitely.">
              <input
                name="end_at"
                type="datetime-local"
                className="nova-input"
                defaultValue={editing?.end_at ? editing.end_at.slice(0, 16) : ""}
              />
            </Field>
          </div>

          {error && <p className="text-sm text-nova-red">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" className="nova-btn-primary" disabled={busy}>
              {busy ? (<><Spinner size={16} /> Saving…</>) : "Save Message"}
            </button>
            <button
              type="button"
              className="nova-btn-ghost"
              onClick={() => {
                setEditing(null);
                setCreating(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {broadcasts.length === 0 ? (
        <p className="nova-card py-10 text-center text-sm text-nova-muted">No messages yet.</p>
      ) : (
        <ul className="space-y-3">
          {broadcasts.map((broadcast) => (
            <li
              key={broadcast.id}
              className={`nova-card ${broadcast.archived_at ? "opacity-50" : ""}`}
            >
              <div className={`rounded-xl border p-3 ${BANNER_STYLES[broadcast.banner_type]}`}>
                <p className="text-sm font-semibold">{broadcast.title}</p>
                <p className="mt-1 text-sm">{broadcast.message}</p>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-nova-muted">
                <span>
                  {formatDateTime(broadcast.start_at)} →{" "}
                  {broadcast.end_at ? formatDateTime(broadcast.end_at) : "no end"}
                  {broadcast.archived_at && " · archived"}
                  {!broadcast.dismissible && " · not dismissible"}
                </span>

                {!broadcast.archived_at && (
                  <span className="flex gap-3">
                    <button className="hover:text-nova-text" onClick={() => toggle(broadcast)}>
                      {broadcast.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="hover:text-nova-text" onClick={() => setEditing(broadcast)}>
                      Edit
                    </button>
                    <button className="hover:text-nova-red" onClick={() => archive(broadcast)}>
                      Archive
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
