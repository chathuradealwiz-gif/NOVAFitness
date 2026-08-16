import { requireSuperAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { Profile } from "@/types/database";
import { AdminList } from "./AdminList";

// Super admin only (spec §65).
export default async function AdminsPage() {
  const session = await requireSuperAdmin();
  const supabase = createClient();

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .in("role", ["admin", "super_admin"])
    .order("created_at");

  const { data: recentUsers } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <>
      <PageHeader
        title="Administrators"
        subtitle="Admins sign in with a magic link. Promote an existing account to grant access."
      />
      <AdminList
        admins={(data ?? []) as Profile[]}
        candidates={(recentUsers ?? []) as Profile[]}
        currentUserId={session.userId}
      />
    </>
  );
}
