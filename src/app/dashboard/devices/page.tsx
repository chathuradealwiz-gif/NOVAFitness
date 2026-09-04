import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { FingerprintArt } from "@/components/illustrations";
import { formatDateTime } from "@/lib/format";
import { DeviceHealthPanel } from "./DeviceHealth";
import { DeviceWifiPanel } from "./DeviceWifi";
import { AutoRefresh } from "@/components/AutoRefresh";
import type { Device, DeviceWifiCommandView } from "@/types/database";

// A device that has not sent a heartbeat in this window is treated as offline,
// regardless of the last status it reported.
const STALE_MS = 3 * 60 * 1000;

// Health arrives on the heartbeat, so a cached render of this page would show a
// snapshot older than the one already in the database — and "Refresh" would
// appear to do nothing.
export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const session = await requireStaff();
  const supabase = createClient();

  const { data } = await supabase.from("devices").select("*").order("device_code");
  const devices = (data ?? []) as Device[];

  // The most recent Wi-Fi request per device, whatever became of it: one that
  // is still waiting drives the panel's state, and a finished one is the answer
  // staff came to read. Fetched in one query rather than per card.
  const { data: wifiRows } = await supabase
    .from("device_wifi_commands")
    // Explicitly not "*": the password column never leaves the server.
    .select("id, device_id, action, ssid, status, result, requested_by, created_at, delivered_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const latestWifi = new Map<string, DeviceWifiCommandView>();
  for (const row of (wifiRows ?? []) as DeviceWifiCommandView[]) {
    if (!latestWifi.has(row.device_id)) latestWifi.set(row.device_id, row);
  }

  // How many enrolled members could survive losing a sensor. The view carries
  // no template bytes — only whether each member has one — because staff need
  // the count, not the biometrics.
  const { data: backups } = await supabase
    .from("fingerprint_backup_status")
    .select("member_id, backed_up");

  const enrolled = backups?.length ?? 0;
  const protectedCount = backups?.filter((b) => b.backed_up).length ?? 0;
  const unprotected = enrolled - protectedCount;

  return (
    <>
      <AutoRefresh intervalSeconds={30} />
      <PageHeader
        title="Devices"
        subtitle="Fingerprint terminals at the gym entrance"
      />

      {/* The sensor's flash is otherwise the only copy of a member's
          fingerprint, and it cannot be regenerated from anything else here —
          an unbacked member is one whose print is lost with the hardware. */}
      {enrolled > 0 && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            unprotected > 0
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          <span className="font-medium">
            {unprotected > 0
              ? `${unprotected} of ${enrolled} fingerprints are not backed up`
              : `All ${enrolled} fingerprints are backed up`}
          </span>
          <p className="mt-1 text-xs opacity-80">
            {unprotected > 0
              ? "These members would have to enrol again if the sensor were replaced. The terminal retries uploads on every sync — if the count stays put, check that it is online."
              : "A replacement sensor can be rebuilt from the terminal: Info → Restore Sensor."}
          </p>
        </div>
      )}

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

                <DeviceWifiPanel
                  device={device}
                  isSuperAdmin={session.isSuperAdmin}
                  command={latestWifi.get(device.id) ?? null}
                />

                <DeviceHealthPanel device={device} />
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
