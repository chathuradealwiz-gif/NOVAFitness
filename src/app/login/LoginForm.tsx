"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui";
import { Spinner } from "@/components/Loading";

/**
 * Two ways in (spec "Login UI"):
 *   - everyone: Supabase magic link
 *   - accounts with a username: username + password, verified server-side by the
 *     super-admin-login Edge Function
 *
 * The username form is behind a toggle and no credentials are ever shown here.
 * After sign-in the caller is routed by their actual role, so a member account
 * with a username lands on /member and staff land on /dashboard.
 */
export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"magic" | "super">("magic");

  return (
    <div className="nova-card">
      {mode === "magic" ? (
        <MagicLinkForm onSuperAdmin={() => setMode("super")} />
      ) : (
        <SuperAdminForm
          onBack={() => setMode("magic")}
          onSuccess={(role) =>
            router.replace(role === "user" ? "/member" : "/dashboard")
          }
        />
      )}
    </div>
  );
}

function MagicLinkForm({ onSuperAdmin }: { onSuperAdmin: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold">Check your email</p>
        <p className="mt-2 text-sm text-nova-muted">
          We sent a sign-in link to <span className="text-nova-text">{email}</span>. Open it on this
          device to continue.
        </p>
        <button className="nova-btn-ghost mt-6 w-full" onClick={() => setStatus("idle")}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Email">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className="nova-input"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <button type="submit" className="nova-btn-primary w-full" disabled={status === "sending"}>
        {status === "sending" ? (<><Spinner size={16} /> Sending…</>) : "Send Magic Link"}
      </button>

      <div className="pt-2 text-center">
        <button
          type="button"
          onClick={onSuperAdmin}
          className="text-xs text-nova-muted underline underline-offset-4 hover:text-nova-text"
        >
          Sign in with username
        </button>
      </div>
    </form>
  );
}

function SuperAdminForm({
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: (role: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/super-admin-login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            // The Functions gateway rejects unauthenticated requests with
            // UNAUTHORIZED_NO_AUTH_HEADER unless a bearer token is present, even
            // for a public endpoint like this one. The anon key is the token.
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ username, password }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many attempts. Try again later."
            : "Invalid username or password.",
        );
        return;
      }

      // The Edge Function verified the password; adopt the returned session so
      // the cookie-based middleware sees a normal Supabase session.
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
      });

      if (error) {
        setError(error.message);
        return;
      }

      onSuccess(body.role ?? "super_admin");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="nova-label">Username sign in</p>

      <Field label="Username">
        <input
          className="nova-input"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>

      <Field label="Password">
        <input
          type="password"
          className="nova-input"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {error && <p className="text-sm text-nova-red">{error}</p>}

      <button type="submit" className="nova-btn-primary w-full" disabled={busy}>
        {busy ? (<><Spinner size={16} /> Signing in…</>) : "Sign In"}
      </button>

      <div className="pt-2 text-center">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-nova-muted underline underline-offset-4 hover:text-nova-text"
        >
          Back to magic link
        </button>
      </div>
    </form>
  );
}
