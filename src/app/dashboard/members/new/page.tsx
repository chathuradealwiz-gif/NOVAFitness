import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { suggestMembershipId } from "@/lib/actions/members";
import { MemberForm } from "../MemberForm";

// The suggested membership number must reflect the roster as it is right now.
// A cached render of this page hands the next member a number that is already
// taken, so this route is never served from the full route cache.
export const dynamic = "force-dynamic";

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
