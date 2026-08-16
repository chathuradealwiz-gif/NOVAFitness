import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { Logo } from "@/components/Logo";
import { SetupForm } from "./SetupForm";

// First-time profile completion after a magic-link signup (spec §40).
// Deliberately NOT under /member: that layout redirects here when the member row
// is missing, so nesting this page inside it would loop.
export default async function MemberSetupPage() {
  const { session, member } = await requireMember();
  if (member) redirect("/member");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 py-10">
      <Logo size={48} />

      <h1 className="mt-8 text-2xl font-bold tracking-tight">Complete your profile</h1>
      <p className="mt-2 text-sm text-nova-muted">
        Enter the membership number printed on your card. Reception can tell you yours if you are
        not sure.
      </p>

      <div className="mt-6">
        <SetupForm email={session.profile.email} defaultName={session.profile.full_name ?? ""} />
      </div>
    </main>
  );
}
