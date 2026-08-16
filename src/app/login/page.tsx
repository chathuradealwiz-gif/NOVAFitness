import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — NOVA FITNESS" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          {/* Logo sits in a glowing ring — the one big brand moment in the app. */}
          <span className="relative grid place-items-center">
            <span className="absolute h-28 w-28 rounded-full bg-nova-red/20 blur-2xl" aria-hidden />
            <span className="relative rounded-2xl border border-nova-red/30 bg-nova-card p-3 shadow-glow">
              <Logo size={64} showName={false} />
            </span>
          </span>

          <div>
            <h1 className="font-display text-2xl font-black uppercase tracking-[0.16em]">
              NOVA{" "}
              <span className="text-nova-red [text-shadow:0_0_22px_rgba(255,30,60,0.6)]">
                FITNESS
              </span>
            </h1>
            <p className="mt-2 font-display text-[10px] uppercase tracking-widest text-nova-muted">
              Membership &amp; Access Control
            </p>
          </div>
        </div>

        <LoginForm />

        <p className="mt-8 text-center text-xs text-nova-muted">
          Trouble signing in? Contact the gym reception.
        </p>
      </div>
    </main>
  );
}
