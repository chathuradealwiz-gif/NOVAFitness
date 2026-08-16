import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

// Entry point: send everyone to where they belong (spec "Redirect rules").
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(session.isStaff ? "/dashboard" : "/member");
}
