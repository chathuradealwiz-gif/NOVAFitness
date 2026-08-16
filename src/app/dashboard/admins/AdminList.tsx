"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setAdminActive, setUserRole } from "@/lib/actions/settings";
import { formatDate } from "@/lib/format";
import type { Profile } from "@/types/database";

export function AdminList({
  admins,
  candidates,
  currentUserId,
}: {
  admins: Profile[];
  candidates: Profile[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    setError(null);
    const result = await action();
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-nova-red">{error}</p>}

      <section className="nova-card">
        <h2 className="mb-3 text-sm font-semibold">Staff accounts</h2>
        <div className="nova-table-wrap">
          <table className="nova-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Since</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => {
                const isSelf = admin.user_id === currentUserId;
                return (
                  <tr key={admin.id}>
                    <td className="font-medium">
                      {admin.full_name ?? "—"}
                      {isSelf && <span className="ml-2 text-xs text-nova-muted">(you)</span>}
                    </td>
                    <td className="text-nova-muted">{admin.email}</td>
                    <td className="capitalize">{admin.role.replace("_", " ")}</td>
                    <td className="text-nova-muted">{formatDate(admin.created_at)}</td>
                    <td>
                      {admin.is_active ? (
                        <span className="text-emerald-400">Active</span>
                      ) : (
                        <span className="text-nova-red">Disabled</span>
                      )}
                    </td>
                    <td className="text-right">
                      {/* The super admin cannot disable or demote themselves. */}
                      {!isSelf && admin.role !== "super_admin" && (
                        <span className="flex justify-end gap-3 text-xs">
                          <button
                            className="text-nova-muted hover:text-nova-text"
                            disabled={busyId === admin.id}
                            onClick={() => run(admin.id, () => setAdminActive(admin.id, !admin.is_active))}
                          >
                            {admin.is_active ? "Disable" : "Enable"}
                          </button>
                          <button
                            className="text-nova-muted hover:text-nova-red"
                            disabled={busyId === admin.id}
                            onClick={() => run(admin.id, () => setUserRole(admin.id, "user"))}
                          >
                            Revoke admin
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="nova-card">
        <h2 className="mb-1 text-sm font-semibold">Promote an account</h2>
        <p className="mb-3 text-xs text-nova-muted">
          The person must sign in once with a magic link first — that creates the account you can
          promote here.
        </p>

        {candidates.length === 0 ? (
          <p className="py-4 text-sm text-nova-muted">No member accounts to promote.</p>
        ) : (
          <ul className="divide-y divide-nova-border/60">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {candidate.full_name ?? candidate.email}
                  </span>
                  <span className="block truncate text-xs text-nova-muted">{candidate.email}</span>
                </span>
                <button
                  className="nova-btn-ghost px-4 py-2 text-xs"
                  disabled={busyId === candidate.id}
                  onClick={() => run(candidate.id, () => setUserRole(candidate.id, "admin"))}
                >
                  Make Admin
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
