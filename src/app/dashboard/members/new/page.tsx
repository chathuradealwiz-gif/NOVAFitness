import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { suggestMembershipId } from "@/lib/actions/members";
import { NewMemberWizard } from "./NewMemberWizard";
import type { Device, GymSettings } from "@/types/database";

// The suggested membership number must reflect the roster as it is right now.
// A cached render of this page hands the next member a number that is already
// taken, so this route is never served from the full route cache.
export const dynamic = "force-dynamic";

export default async function NewMemberPage() {
  const session = await requireStaff();
  const supabase = createClient();

  // Signup runs details -> fingerprint -> payment without leaving the page, so
  // the devices and fee settings the later steps need are fetched up front
  // rather than after the member row exists.
  const [suggestedId, { data: devices }, { data: settings }] = await Promise.all([
    suggestMembershipId(),
    supabase.from("devices").select("*").neq("status", "disabled").order("name"),
    supabase.from("gym_settings").select("*").maybeSingle(),
  ]);

  return (
    <>
      <PageHeader
        title="Add Member"
        subtitle="Details, fingerprint, then payment. The last two can be done later."
      />
      <NewMemberWizard
        suggestedId={suggestedId}
        devices={(devices ?? []) as Device[]}
        settings={settings as GymSettings | null}
        isSuperAdmin={session.isSuperAdmin}
        // A member that does not exist yet cannot have an enrolment in flight;
        // the panel picks one up from its own refresh once step 2 starts.
        activeEnrollment={null}
      />
    </>
  );
}
