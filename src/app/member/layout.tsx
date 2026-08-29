import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { IconLogout, IconWhatsApp } from "@/components/icons";
import { MemberNav } from "./MemberNav";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { member } = await requireMember();

  const supabase = createClient();
  const { data: settings } = await supabase
    .from("gym_settings")
    .select("gym_name, logo_path, whatsapp_url")
    .maybeSingle();

  // Signup is incomplete until the member has claimed their NOVA ID (spec §40).
  // /setup lives outside this layout on purpose — nesting it here would make this
  // redirect fire again on the setup page itself and loop forever.
  if (!member) redirect("/setup");

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="nova-rail sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-nova-border bg-nova-black/90 px-4 py-3 backdrop-blur">
        <Logo logoPath={settings?.logo_path} size={30} />
        <div className="flex items-center gap-3">
          {settings?.whatsapp_url && (
            <a
              href={settings.whatsapp_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-2 font-display text-[10px] font-bold uppercase tracking-wide text-emerald-400"
            >
              <IconWhatsApp size={14} />
              WhatsApp Us
            </a>
          )}
          <form action="/auth/signout" method="post">
            <button className="flex items-center gap-1 text-xs text-nova-muted" aria-label="Sign out">
              <IconLogout size={16} />
            </button>
          </form>
        </div>
      </header>

      {/* Bottom padding clears the fixed nav bar. */}
      <main className="px-4 pb-28 pt-4">{children}</main>

      <MemberNav />
    </div>
  );
}
