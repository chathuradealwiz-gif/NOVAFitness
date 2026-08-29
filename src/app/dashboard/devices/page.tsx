import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { FingerprintArt } from "@/components/illustrations";
import { formatDateTime } from "@/lib/format";
import type { Device } from "@/types/database";

// A device that has not sent a heartbeat in this window is treated as offline,
// regardless of the last status it reported.
const STALE_MS = 3 * 60 * 1000;

export default async function DevicesPage() {
  await requireStaff();
  const supabase = createClient();

  const { data } = await supabase.from("devices").select("*").order("device_code");
  const devices = (data ?? []) as Device[];

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Fingerprint terminals at the gym entrance"
      />

      {devices.length === 0 ? (
        <EmptyState
          title="No devices registered" art={<FingerprintArt />}
          hint="Run scripts/provision-device.mjs to register a terminal and mint its key."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => {
            const lastSeen = device.last_seen_at ? Date.parse(device.last_seen_at) : 0;
            const online = device.status === "online" && Date.now() - lastSeen < STALE_MS;

            return (
              <article key={device.id} className="nova-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-mono text-sm font-bold text-nova-red">
                      {device.device_code}
                    </h2>
                    <p className="text-sm font-medium">{device.name}</p>
                    {device.location && (
                      <p className="text-xs text-nova-muted">{device.location}</p>
                    )}
                  </div>
                  <span
                    className={`nova-pill ${
                      device.status === "disabled"
                        ? "border-nova-border bg-white/5 text-nova-muted"
                        : online
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                          : "border-nova-red/30 bg-nova-red/15 text-nova-red"
                    }`}
                  >
                    {device.status === "disabled" ? "Disabled" : online ? "Online" : "Offline"}
                  </span>
                </div>

                <dl className="mt-4 space-y-2 text-sm">
                  <Row label="Last heartbeat" value={formatDateTime(device.last_seen_at)} />
                  <Row label="Last sync" value={formatDateTime(device.last_sync_at)} />
                  <Row label="Firmware" value={device.firmware_version ?? "—"} />
                  <Row label="4G status" value={device.network_status ?? "—"} />
                  <Row
                    label="Pending events"
                    value={
                      device.pending_events > 0 ? (
                        <span className="text-amber-400">{device.pending_events} queued</span>
                      ) : (
                        "0"
                      )
                    }
                  />
                </dl>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-nova-muted">
        Devices are treated as offline if no heartbeat has arrived in the last 3 minutes. Offline
        terminals keep granting access from their local cache and queue attendance for sync.
      </p>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-nova-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
