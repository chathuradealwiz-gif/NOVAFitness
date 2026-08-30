import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { MealPlanEditor } from "../MealPlanEditor";

export default async function NewMealPlanPage({
  searchParams,
}: {
  searchParams: { member?: string };
}) {
  await requireStaff();

  if (!searchParams.member) redirect("/dashboard/members");

  const supabase = createClient();
  const { data: member } = await supabase
    .from("members")
    .select("id, full_name, membership_id")
    .eq("id", searchParams.member)
    .is("deleted_at", null)
    .maybeSingle();

  if (!member) notFound();

  return (
    <>
      <PageHeader title="Assign Meal Plan" />
      <MealPlanEditor member={member} />
    </>
  );
}
