"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const STATUSES = ["active", "expired", "suspended", "inactive"] as const;

/** Debounced global member search (spec §59). */
export function MemberSearch({
  defaultQuery,
  defaultStatus,
}: {
  defaultQuery: string;
  defaultStatus?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(defaultQuery);

  useEffect(() => {
    // Don't re-navigate when the URL already matches what's typed.
    if (query === (params.get("q") ?? "")) return;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (query.trim()) next.set("q", query.trim());
      else next.delete("q");
      next.delete("page");
      router.replace(`/dashboard/members?${next}`);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, params, router]);

  function setStatus(status: string) {
    const next = new URLSearchParams(params.toString());
    if (status) next.set("status", status);
    else next.delete("status");
    next.delete("page");
    router.replace(`/dashboard/members?${next}`);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        className="nova-input flex-1"
        placeholder="Search member no. 34, name, phone, email or fingerprint ID"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        <FilterChip label="All" active={!defaultStatus} onClick={() => setStatus("")} />
        {STATUSES.map((status) => (
          <FilterChip
            key={status}
            label={status[0].toUpperCase() + status.slice(1)}
            active={defaultStatus === status}
            onClick={() => setStatus(status)}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-nova-red bg-nova-red text-white"
          : "border-nova-border text-nova-muted hover:text-nova-text"
      }`}
    >
      {label}
    </button>
  );
}
