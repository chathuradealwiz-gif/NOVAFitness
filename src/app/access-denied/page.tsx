import { Logo } from "@/components/Logo";

export const metadata = { title: "Access denied — NOVA FITNESS" };

// Shown when a profile has been deactivated (spec "Session handling").
export default function AccessDeniedPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div className="max-w-sm">
        <Logo size={56} showName={false} />
        <h1 className="mt-6 text-xl font-bold">Access Denied</h1>
        <p className="mt-2 text-sm text-nova-muted">
          Your account is not active. Please contact the gym administrator.
        </p>
        <form action="/auth/signout" method="post" className="mt-8">
          <button className="nova-btn-ghost w-full">Sign out</button>
        </form>
      </div>
    </main>
  );
}
