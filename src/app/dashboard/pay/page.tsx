import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { GymSettings } from "@/types/database";
import { PayClient } from "./PayClient";

/**
 * Quick payment desk (spec: "Pay" tab).
 *
 * Collapses Members -> profile -> Payments -> Record Payment into one screen:
 * search, select, pay. It owns no payment logic of its own — recordPayment() and
 * the database's membership-period triggers do the work, exactly as they do from
 * the member profile.
 */
export default async function PayPage() {
  // Same guard as every other dashboard page: admin and super admin only. The
  // server actions this page calls re-check independently, so hiding the nav
  // item is never the only thing standing between a member and this screen.
  await requireStaff();

  const supabase = createClient();
  const { data: settings } = await supabase.from("gym_settings").select("*").maybeSingle();

  return (
    <>
      <PageHeader
        title="Pay"
        subtitle="Find a member and record a payment"
      />
      <PayClient settings={(settings as GymSettings) ?? null} />
    </>
  );
}
