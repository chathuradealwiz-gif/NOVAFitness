import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { IconLogout } from "@/components/icons";
import { DashboardNav } from "./DashboardNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();

  const supabase = createClient();
  const { data: settings } = await supabase
    .from("gym_settings")
    .select("gym_name, logo_path")
    .maybeSingle();

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar; on mobile this collapses to a bottom bar. */}
      <aside className="hidden w-60 shrink-0 border-r border-nova-border bg-nova-surface lg:block">
        <div className="sticky top-0 p-5">
          <Logo logoPath={settings?.logo_path} size={36} />
          <DashboardNav isSuperAdmin={session.isSuperAdmin} variant="sidebar" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="nova-rail sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-nova-border bg-nova-black/90 px-4 py-3 backdrop-blur lg:hidden">
          <Logo logoPath={settings?.logo_path} size={30} />
          <form action="/auth/signout" method="post">
            <button className="flex items-center gap-1.5 text-xs text-nova-muted" aria-label="Sign out">
              <IconLogout size={16} />
            </button>
          </form>
        </header>

        <main className="flex-1 px-4 pb-28 pt-5 lg:px-8 lg:pb-10">{children}</main>

        <div className="hidden border-t border-nova-border px-8 py-4 text-xs text-nova-muted lg:flex lg:items-center lg:justify-between">
          <span>
            Signed in as {session.profile.full_name ?? session.profile.email} ·{" "}
            {session.isSuperAdmin ? "Super Admin" : "Admin"}
          </span>
          <form action="/auth/signout" method="post">
            <button className="flex items-center gap-1.5 hover:text-nova-text">
              <IconLogout size={15} /> Sign out
            </button>
          </form>
        </div>
      </div>

      <DashboardNav isSuperAdmin={session.isSuperAdmin} variant="bottom" />
    </div>
  );
}
