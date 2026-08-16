import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { BroadcastMessage } from "@/types/database";
import { BroadcastManager } from "./BroadcastManager";

export default async function BroadcastsPage() {
  await requireStaff();
  const supabase = createClient();

  // Staff see archived rows too, so history stays visible (spec §57).
  const { data } = await supabase
    .from("broadcast_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <>
      <PageHeader
        title="Broadcast Messages"
        subtitle="Announcements shown as a banner on the member dashboard."
      />
      <BroadcastManager broadcasts={(data ?? []) as BroadcastMessage[]} />
    </>
  );
}
