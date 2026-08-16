import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session on every request and enforces route access by
 * role. This is a convenience layer only — the real enforcement is RLS in
 * Postgres and JWT checks in the Edge Functions (spec "Role enforcement").
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/access-denied");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // The role lookup costs a database round trip, so only run it on the two paths
  // whose routing actually depends on the role. Every /dashboard page still calls
  // requireStaff(), and RLS is the real boundary either way — skipping the check
  // here cannot grant access to anything.
  const needsRole = path.startsWith("/dashboard") || path.startsWith("/login");

  if (user && needsRole) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile && !profile.is_active) {
      const url = request.nextUrl.clone();
      url.pathname = "/access-denied";
      return NextResponse.redirect(url);
    }

    const isStaff = profile?.role === "admin" || profile?.role === "super_admin";

    // Members never reach the admin dashboard; staff land on their own home.
    if (path.startsWith("/dashboard") && !isStaff) {
      const url = request.nextUrl.clone();
      url.pathname = "/member";
      return NextResponse.redirect(url);
    }

    if (path.startsWith("/login")) {
      const url = request.nextUrl.clone();
      url.pathname = isStaff ? "/dashboard" : "/member";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
