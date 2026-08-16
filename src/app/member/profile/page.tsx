import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DetailRow, StatusPill } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { GymSettings } from "@/types/database";
import { ProfileForm } from "./ProfileForm";
import { AvatarUpload } from "./AvatarUpload";

export default async function MemberProfilePage() {
  const { session, member } = await requireMember();
  if (!member) return null;

  const supabase = createClient();
  const { data: settings } = await supabase
    .from("gym_settings")
    .select("gym_name, phone, email, address, whatsapp_url")
    .maybeSingle();

  const gym = settings as Pick<
    GymSettings,
    "gym_name" | "phone" | "email" | "address" | "whatsapp_url"
  > | null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>

      <section className="nova-card">
        <div className="flex items-center gap-4">
          <AvatarUpload
            userId={session.userId}
            currentUrl={member.profile_image_url}
            name={member.full_name}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold">{member.full_name}</p>
            <p className="font-display text-sm font-bold text-nova-red">No. {member.membership_id}</p>
            <div className="mt-1">
              <StatusPill status={member.status} />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <DetailRow label="Email" value={member.email ?? session.profile.email} />
          <DetailRow label="Member since" value={formatDate(member.join_date)} />
          <DetailRow label="Next payment" value={formatDate(member.next_payment_date)} />
        </div>
      </section>

      <ProfileForm member={member} />

      {gym && (
        <section className="nova-card">
          <p className="nova-label">Contact {gym.gym_name}</p>
          <div className="mt-2">
            {gym.phone && <DetailRow label="Phone" value={gym.phone} />}
            {gym.email && <DetailRow label="Email" value={gym.email} />}
            {gym.address && <DetailRow label="Address" value={gym.address} />}
          </div>

          {gym.whatsapp_url && (
            <a
              href={gym.whatsapp_url}
              target="_blank"
              rel="noopener noreferrer"
              className="nova-btn mt-4 w-full bg-emerald-600 text-white hover:bg-emerald-700"
            >
              WhatsApp Us
            </a>
          )}
        </section>
      )}

      <form action="/auth/signout" method="post">
        <button className="nova-btn-ghost w-full">Sign out</button>
      </form>
    </div>
  );
}
