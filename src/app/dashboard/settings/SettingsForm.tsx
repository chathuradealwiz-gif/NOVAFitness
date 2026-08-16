"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";
import { updateGymSettings } from "@/lib/actions/settings";
import type { GymSettings } from "@/types/database";

export function SettingsForm({ settings }: { settings: GymSettings }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    setError(null);
    setSaved(false);

    const result = await updateGymSettings(formData);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save the settings.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="nova-card space-y-4">
      <Field label="Gym Name">
        <input name="gym_name" className="nova-input" required defaultValue={settings.gym_name} />
      </Field>

      <Field
        label="Logo URL"
        hint="Upload the logo to the `branding` storage bucket and paste its public URL. Swapping it needs no code change."
      >
        <input name="logo_path" className="nova-input" defaultValue={settings.logo_path ?? ""} />
      </Field>

      <Field
        label="WhatsApp Link"
        hint="Shown as the 'WhatsApp Us' button on the member dashboard. Leave blank until the gym provides the official number."
      >
        <input
          name="whatsapp_url"
          type="url"
          className="nova-input"
          placeholder="https://wa.me/94XXXXXXXXX"
          defaultValue={settings.whatsapp_url ?? ""}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone">
          <input name="phone" className="nova-input" defaultValue={settings.phone ?? ""} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" className="nova-input" defaultValue={settings.email ?? ""} />
        </Field>
      </div>

      <Field label="Address">
        <textarea name="address" rows={2} className="nova-input" defaultValue={settings.address ?? ""} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Currency">
          <input name="currency" className="nova-input" required defaultValue={settings.currency} />
        </Field>
        <Field label="Monthly Fee">
          <input
            name="monthly_membership_fee"
            type="number"
            step="0.01"
            min="0"
            className="nova-input"
            defaultValue={settings.monthly_membership_fee}
          />
        </Field>
        <Field label="Registration Fee">
          <input
            name="registration_fee"
            type="number"
            step="0.01"
            min="0"
            className="nova-input"
            defaultValue={settings.registration_fee}
          />
        </Field>
      </div>

      <Field
        label="Scan Cooldown (seconds)"
        hint="Repeat scans inside this window do not create duplicate attendance events."
      >
        <input
          name="scan_cooldown_seconds"
          type="number"
          min="0"
          max="600"
          className="nova-input"
          defaultValue={settings.scan_cooldown_seconds}
        />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}
      {saved && <p className="text-sm text-emerald-400">Settings saved.</p>}

      <button type="submit" className="nova-btn-primary" disabled={busy}>
        {busy ? (<><Spinner size={16} /> Saving…</>) : "Save Settings"}
      </button>
    </form>
  );
}
