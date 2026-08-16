import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Member, Profile } from "@/types/database";

export interface SessionContext {
  userId: string;
  profile: Profile;
  isStaff: boolean;
  isSuperAdmin: boolean;
}

/**
 * Current profile, or null when signed out.
 *
 * Wrapped in React `cache()` so the layout and the page it renders share one
 * result per request instead of each paying for their own getUser() round trip.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    userId: user.id,
    profile: profile as Profile,
    isStaff: profile.role === "admin" || profile.role === "super_admin",
    isSuperAdmin: profile.role === "super_admin",
  };
});

/** The caller's member row, deduped per request the same way. */
export const getOwnMember = cache(async (userId: string): Promise<Member | null> => {
  const supabase = createClient();
  const { data } = await supabase
    .from("members")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return (data as Member) ?? null;
});

/** Guard for /dashboard pages. */
export async function requireStaff(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile.is_active) redirect("/access-denied");
  if (!session.isStaff) redirect("/member");
  return session;
}

/** Guard for super-admin-only pages (admin management, voiding payments). */
export async function requireSuperAdmin(): Promise<SessionContext> {
  const session = await requireStaff();
  if (!session.isSuperAdmin) redirect("/dashboard");
  return session;
}

/** Guard for /member pages. Returns the linked member row, if the signup is complete. */
export async function requireMember(): Promise<{ session: SessionContext; member: Member | null }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile.is_active) redirect("/access-denied");

  return { session, member: await getOwnMember(session.userId) };
}
