import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { AttendanceArt } from "@/components/illustrations";
import { formatDateTime } from "@/lib/format";
import type { Attendance, Member } from "@/types/database";
import { AttendanceFilters } from "./AttendanceFilters";
import { ExportButton } from "./ExportButton";
import { AutoRefresh } from "@/components/AutoRefresh";

const PAGE_SIZE = 50;

interface AttendanceRow extends Attendance {
  members: Pick<Member, "id" | "membership_id" | "full_name"> | null;
  devices: { device_code: string } | null;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; type?: string; member?: string; page?: string };
}) {
  await requireStaff();
  const supabase = createClient();

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  // Default to the last 7 days so the first paint is never a full-table scan.
  const from = searchParams.from ?? new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const to = searchParams.to ?? new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("attendance")
    .select("*, members(id, membership_id, full_name), devices(device_code)", { count: "exact" })
    .gte("occurred_at", `${from}T00:00:00Z`)
    .lte("occurred_at", `${to}T23:59:59Z`)
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (searchParams.type === "entry" || searchParams.type === "exit") {
    query = query.eq("event_type", searchParams.type);
  }
  if (searchParams.member) {
    query = query.eq("member_id", searchParams.member);
  }

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as AttendanceRow[];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <AutoRefresh intervalSeconds={60} />
      <PageHeader
        title="Attendance"
        subtitle={`${total} event${total === 1 ? "" : "s"} between ${from} and ${to}`}
        action={<ExportButton rows={rows} />}
      />

      <AttendanceFilters from={from} to={to} type={searchParams.type} />

      {rows.length === 0 ? (
        <EmptyState title="No attendance in this range" art={<AttendanceArt />} hint="Try widening the date filter." />
      ) : (
        <div className="nova-card mt-4">
          <div className="nova-table-wrap">
            <table className="nova-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Member No.</th>
                  <th>Member</th>
                  <th>Event</th>
                  <th>Device</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{formatDateTime(row.occurred_at)}</td>
                    <td className="font-mono text-xs">
                      {row.members ? (
                        <Link
                          href={`/dashboard/members/${row.members.id}`}
                          className="text-nova-red hover:underline"
                        >
                          {row.members.membership_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{row.members?.full_name ?? "Unknown fingerprint"}</td>
                    <td className="capitalize">{row.event_type}</td>
                    <td className="text-nova-muted">
                      {row.devices?.device_code ?? "—"}
                      {row.offline_event && (
                        <span className="ml-2 text-xs text-amber-400">offline</span>
                      )}
                    </td>
                    <td>
                      {row.authorized ? (
                        <span className="text-emerald-400">Granted</span>
                      ) : (
                        <span className="text-nova-red">
                          Denied
                          {row.denial_reason ? ` · ${row.denial_reason.toLowerCase().replace(/_/g, " ")}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm">
              <PageLink searchParams={searchParams} page={page - 1} disabled={page <= 1} label="← Previous" />
              <span className="text-nova-muted">
                Page {page} of {pageCount}
              </span>
              <PageLink
                searchParams={searchParams}
                page={page + 1}
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
  searchParams,
  page,
  disabled,
  label,
}: {
  searchParams: Record<string, string | undefined>;
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) return <span className="text-nova-muted/40">{label}</span>;

  const params = new URLSearchParams(
    Object.entries(searchParams).filter(([, value]) => value) as [string, string][],
  );
  params.set("page", String(page));

  return (
    <Link href={`/dashboard/attendance?${params}`} className="text-nova-red hover:underline">
      {label}
    </Link>
  );
}
