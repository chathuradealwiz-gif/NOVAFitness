import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { suggestMembershipId } from "@/lib/actions/members";
import { MemberForm } from "../MemberForm";

export default async function NewMemberPage() {
  await requireStaff();
  const suggestedId = await suggestMembershipId();

  return (
    <>
      <PageHeader
        title="Add Member"
        subtitle="The membership number is the gym's official identifier for this member."
      />
      <div className="max-w-2xl">
        <MemberForm suggestedId={suggestedId} />
      </div>
    </>
  );
}
