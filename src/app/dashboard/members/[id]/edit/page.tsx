import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { Member } from "@/types/database";
import { MemberForm } from "../../MemberForm";

export default async function EditMemberPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const supabase = createClient();

  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!member) notFound();

  return (
    <>
      <PageHeader title="Edit Member" subtitle={(member as Member).membership_id} />
      <div className="max-w-2xl">
        <MemberForm member={member as Member} />
      </div>
    </>
  );
}
