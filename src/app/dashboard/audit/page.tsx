import { requireSuperAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { AuditLog } from "@/types/database";

interface AuditRow extends AuditLog {
  profiles: { full_name: string | null; email: string } | null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { entity?: string };
}) {
  await requireSuperAdmin();
  const supabase = createClient();

  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (searchParams.entity) query = query.eq("entity_type", searchParams.entity);

  const [{ data: logs }, { data: financial }] = await Promise.all([
    query,
    supabase
      .from("financial_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const rows = (logs ?? []) as unknown as AuditRow[];

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Every sensitive administrative change, newest first."
      />

      <section className="nova-card">
        <h2 className="mb-3 text-sm font-semibold">System changes</h2>
        {rows.length === 0 ? (
          <EmptyState title="Nothing logged yet" />
        ) : (
          <div className="nova-table-wrap">
            <table className="nova-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Change</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap text-nova-muted">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="capitalize">{log.action.replace(/_/g, " ")}</td>
                    <td className="text-nova-muted">
                      {log.entity_type}
                      {log.entity_id && (
                        <span className="ml-1 font-mono text-xs">
                          {log.entity_id.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs text-nova-muted">
                      {summarise(log.old_data)} → {summarise(log.new_data)}
                    </td>
                    <td className="text-nova-muted">{log.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="nova-card mt-4">
        <h2 className="mb-3 text-sm font-semibold">Financial corrections</h2>
        {(financial ?? []).length === 0 ? (
          <p className="py-4 text-sm text-nova-muted">No payment corrections recorded.</p>
        ) : (
          <ul className="divide-y divide-nova-border/60 text-sm">
            {(financial as { id: string; action: string; reason: string | null; created_at: string }[]).map(
              (entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                  <span className="capitalize">{entry.action}</span>
                  <span className="text-nova-muted">{entry.reason ?? "—"}</span>
                  <span className="text-nova-muted">{formatDateTime(entry.created_at)}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

/** Compact one-line rendering of a JSON diff payload. */
function summarise(data: Record<string, unknown> | null): string {
  if (!data) return "—";
  const entries = Object.entries(data).filter(([, value]) => value !== null);
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
