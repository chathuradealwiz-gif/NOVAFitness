import Link from "next/link";
import { IconPlus } from "@/components/icons";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { DumbbellArt } from "@/components/illustrations";
import { Avatar } from "@/components/Avatar";
import { formatDate } from "@/lib/format";
import type { Member, MemberStatus } from "@/types/database";
import { MemberSearch } from "./MemberSearch";

const PAGE_SIZE = 25;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string };
}) {
  await requireStaff();
  const supabase = createClient();

  const query = (searchParams.q ?? "").trim();
  const status = searchParams.status as MemberStatus | undefined;
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  let members: Member[] = [];
  let total = 0;

  if (query) {
    // Ranked search across every identifier in spec §59.
    const { data } = await supabase.rpc("search_members", { p_query: query, p_limit: 50 });
    members = (data ?? []) as Member[];
    if (status) members = members.filter((member) => member.status === status);
    total = members.length;
  } else {
    let listQuery = supabase
      .from("members")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (status) listQuery = listQuery.eq("status", status);

    const { data, count } = await listQuery;
    members = (data ?? []) as Member[];
    total = count ?? 0;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Members"
        subtitle={`${total} member${total === 1 ? "" : "s"}`}
        action={
          <Link href="/dashboard/members/new" className="nova-btn-primary">
            <IconPlus size={16} />
            Add Member
          </Link>
        }
      />

      <MemberSearch defaultQuery={query} defaultStatus={status} />

      {members.length === 0 ? (
        <EmptyState
          art={<DumbbellArt />}
          title={query ? "No members match that search" : "No members yet"}
          hint={query ? "Try a member number, name, phone or fingerprint ID." : undefined}
        />
      ) : (
        <div className="nova-card mt-4">
          <div className="nova-table-wrap">
            <table className="nova-table">
              <thead>
                <tr>
                  <th>Member No.</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Next Payment</th>
                  <th>Fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-white/5">
                    <td>
                      <Link
                        href={`/dashboard/members/${member.id}`}
                        className="font-mono text-sm font-semibold text-nova-red"
                      >
                        {member.membership_id}
                      </Link>
                    </td>
                    <td>
                      <span className="flex items-center gap-2.5">
                        <Avatar
                          name={member.full_name}
                          src={member.profile_image_url}
                          size={32}
                          rounded="rounded-lg"
                        />
                        <span className="font-medium">{member.full_name}</span>
                      </span>
                    </td>
                    <td className="text-nova-muted">{member.phone ?? "—"}</td>
                    <td>
                      <StatusPill status={member.status} />
                    </td>
                    <td className="text-nova-muted">{formatDate(member.next_payment_date)}</td>
                    <td className="text-nova-muted">
                      {member.fingerprint_id !== null ? `#${member.fingerprint_id}` : "Not enrolled"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!query && pageCount > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm">
              <PageLink
                page={page - 1}
                status={status}
                disabled={page <= 1}
                label="← Previous"
              />
              <span className="text-nova-muted">
                Page {page} of {pageCount}
              </span>
              <PageLink
                page={page + 1}
                status={status}
                disabled={page >= pageCount}
                label="Next →"
              />
            </nav>
          )}
        </div>
      )}
    </>
  );
}

function PageLink({
  page,
  status,
  disabled,
  label,
}: {
  page: number;
  status?: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) return <span className="text-nova-muted/40">{label}</span>;

  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);

  return (
    <Link href={`/dashboard/members?${params}`} className="text-nova-red hover:underline">
      {label}
    </Link>
  );
}
