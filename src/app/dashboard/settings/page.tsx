import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { GymSettings } from "@/types/database";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  await requireStaff();
  const supabase = createClient();

  const { data } = await supabase.from("gym_settings").select("*").single();

  return (
    <>
      <PageHeader
        title="Gym Settings"
        subtitle="Branding, contact details and default fees. Fees are configurable, never hard-coded."
      />
      <div className="max-w-2xl">
        <SettingsForm settings={data as GymSettings} />
      </div>
    </>
  );
}
