"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Loading";
import type { Device, DeviceHealth as Health } from "@/types/database";

/**
 * Component health for one terminal.
 *
 * The device is outbound-only behind the gym router, so nothing here polls it:
 * this renders the snapshot it pushed on its last heartbeat, and always says how
 * old that is. "Check health" re-reads the row — it cannot make the terminal
 * answer sooner than its next heartbeat, and the panel says so rather than
 * pretending to be a live probe.
 */

type Level = "good" | "warn" | "bad" | "idle";

// Status colours are reserved for state and never used decoratively; each one
// ships with a glyph and a word, so state never rests on colour alone.
const LEVEL: Record<Level, { text: string; fill: string; track: string; glyph: string }> = {
  good: { text: "text-emerald-400", fill: "bg-emerald-400", track: "bg-emerald-400/15", glyph: "✓" },
  warn: { text: "text-amber-400", fill: "bg-amber-400", track: "bg-amber-400/15", glyph: "!" },
  bad: { text: "text-nova-red", fill: "bg-nova-red", track: "bg-nova-red/15", glyph: "✕" },
  idle: { text: "text-nova-muted", fill: "bg-nova-muted", track: "bg-white/5", glyph: "–" },
};

function kb(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function since(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

function uptime(secs: number | undefined): string {
  if (secs === undefined) return "—";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86_400)}d ${Math.floor((secs % 86_400) / 3600)}h`;
}

/**
 * A ratio against a limit. The fill carries severity and the track is a lighter
 * step of the same colour, so the state reads across the whole bar rather than
 * only where it happens to end.
 */
function Meter({ value, max, level }: { value: number; max: number; level: Level }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const tone = LEVEL[level];
  return (
    <div className={`mt-1.5 h-2 overflow-hidden rounded-full ${tone.track}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${tone.fill}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Wi-Fi strength as four steps. dBm means nothing to most people; bars do, and
 * the number stays beside them for whoever does read it.
 */
function SignalBars({ rssi }: { rssi: number | null | undefined }) {
  const bars =
    rssi === null || rssi === undefined
      ? 0
      : rssi >= -55
        ? 4
        : rssi >= -67
          ? 3
          : rssi >= -78
            ? 2
            : 1;
  const level: Level = bars >= 3 ? "good" : bars === 2 ? "warn" : "bad";
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={`w-1 rounded-sm ${step <= bars ? LEVEL[level].fill : "bg-white/10"}`}
          style={{ height: `${3 + step * 2}px` }}
        />
      ))}
    </span>
  );
}

function StatusRow({
  label,
  value,
  level,
  extra,
}: {
  label: string;
  value: string;
  level: Level;
  extra?: React.ReactNode;
}) {
  const tone = LEVEL[level];
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2 text-sm text-nova-muted">
        <span className={`w-3 text-center text-xs font-bold ${tone.text}`} aria-hidden>
          {tone.glyph}
        </span>
        {label}
      </span>
      <span className="flex items-center gap-2">
        {extra}
        <span className={`text-sm font-medium ${tone.text}`}>{value}</span>
      </span>
    </div>
  );
}

export function DeviceHealthPanel({ device }: { device: Device }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const health = device.health;

  function refresh() {
    setBusy(true);
    router.refresh();
    // router.refresh() gives no completion signal to the caller; this only keeps
    // the spinner up long enough to read as a response to the press.
    setTimeout(() => setBusy(false), 600);
  }

  if (!open) {
    return (
      <button
        className="nova-btn-ghost mt-4 w-full justify-center text-sm"
        onClick={() => setOpen(true)}
      >
        Check Health
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-nova-border bg-nova-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="nova-label">Component Health</p>
          <p className="mt-0.5 text-xs text-nova-muted">
            Reported {since(device.health_reported_at)}
          </p>
        </div>
        <button className="nova-btn-ghost shrink-0 text-xs" onClick={refresh} disabled={busy}>
          {busy ? <Spinner size={14} /> : "Refresh"}
        </button>
      </div>

      {!health ? (
        <p className="mt-3 text-xs text-nova-muted">
          This terminal has not reported component health yet. It is sent with the heartbeat, so it
          appears within a minute of the device running firmware that reports it.
        </p>
      ) : (
        <HealthBody health={health} />
      )}

      <button
        className="mt-3 w-full text-xs text-nova-muted transition-colors hover:text-nova-text"
        onClick={() => setOpen(false)}
      >
        Hide
      </button>
    </div>
  );
}

function HealthBody({ health }: { health: Health }) {
  const sensorOk = health.sensor === "ok";
  const capacity = health.capacity ?? 0;
  const enrolled = health.enrolled ?? 0;
  const free = health.free_slots ?? Math.max(0, capacity - enrolled);

  // The warning point scales with the library rather than sitting at a fixed
  // ten: ten free is a fifth of a warning on a 200-slot R503 and a rounding
  // error on the R307's 1000, where a busy month can eat fifty slots.
  const lowWater = Math.max(10, Math.floor(capacity / 20));
  const slotLevel: Level = !sensorOk
    ? "idle"
    : free <= 0
      ? "bad"
      : free < lowWater
        ? "warn"
        : "good";
  const ramLevel: Level =
    health.free_ram === undefined
      ? "idle"
      : health.free_ram < 16_000
        ? "bad"
        : health.free_ram < 40_000
          ? "warn"
          : "good";
  const flashLevel: Level =
    health.free_flash === undefined ? "idle" : health.free_flash < 20_000 ? "bad" : "good";

  const faults: string[] = [];
  if (!sensorOk) faults.push(`Sensor: ${health.sensor_error ?? "not responding"}`);
  if (health.wifi === false) faults.push("Wi-Fi offline");
  if (health.clock_synced === false) faults.push("Clock not set");
  if (sensorOk && free <= 0) faults.push("Sensor full — no slots left to enrol into");
  if (health.last_error) faults.push(`Last error: ${health.last_error}`);

  return (
    <>
      <div
        className={`mt-3 flex items-center gap-2 rounded-lg border p-2 text-sm ${
          faults.length
            ? "border-nova-red/30 bg-nova-red/10 text-nova-red"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        }`}
      >
        <span className="font-bold" aria-hidden>
          {faults.length ? "✕" : "✓"}
        </span>
        <span className="font-medium">
          {faults.length
            ? `${faults.length} fault${faults.length === 1 ? "" : "s"}`
            : "All checks pass"}
        </span>
      </div>

      {/* Fingerprint capacity is a ratio against a hard limit, so: a meter. The
          number people came for is the one that is left, not the one used. */}
      {sensorOk && capacity > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="nova-label">Fingerprint Slots</span>
            <span className="text-xs text-nova-muted">
              {health.sensor_model ? `${health.sensor_model} · ` : ""}
              {capacity} total
            </span>
          </div>
          <p className={`mt-1 text-2xl font-semibold ${LEVEL[slotLevel].text}`}>
            {free} <span className="text-sm font-normal text-nova-muted">free</span>
          </p>
          <Meter value={enrolled} max={capacity} level={slotLevel} />
          <p className="mt-1 text-xs text-nova-muted">
            {enrolled} enrolled · {free} remaining
          </p>
        </div>
      )}

      <div className="mt-4 divide-y divide-nova-border border-t border-nova-border">
        {/* Named rather than a bare "OK": the two modules that fit this door
            differ in capacity and supply voltage, so which one is on it is the
            first thing worth knowing when the slot count looks wrong. */}
        <StatusRow
          label="Fingerprint sensor"
          value={
            sensorOk
              ? (health.sensor_model ?? "OK")
              : (health.sensor_error ?? "No reply")
          }
          level={sensorOk ? "good" : "bad"}
        />
        <StatusRow
          label="Wi-Fi"
          value={
            health.wifi === false
              ? "Offline"
              : health.rssi != null
                ? `${health.rssi} dBm`
                : "Connected"
          }
          level={health.wifi === false ? "bad" : "good"}
          extra={health.wifi !== false ? <SignalBars rssi={health.rssi} /> : undefined}
        />
        <StatusRow
          label="Clock"
          value={health.clock_synced === false ? "Not set" : "Synced"}
          level={health.clock_synced === false ? "warn" : "good"}
        />
        <StatusRow
          label="Offline queue"
          value={`${health.queue ?? 0} events`}
          level={(health.queue ?? 0) > 0 ? "warn" : "good"}
        />
        {(health.pending_erasures ?? 0) > 0 && (
          <StatusRow
            label="Pending erasures"
            value={`${health.pending_erasures} slots`}
            level="warn"
          />
        )}
        <StatusRow label="Uptime" value={uptime(health.uptime_s)} level="idle" />
      </div>

      {/* Board resources are ratios too, so meters again rather than a second
          visual language on the same card. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="nova-label">Memory</span>
            <span className={`text-xs font-medium ${LEVEL[ramLevel].text}`}>
              {kb(health.free_ram)} free
            </span>
          </div>
          <Meter
            value={(health.total_ram ?? 0) - (health.free_ram ?? 0)}
            max={health.total_ram ?? 0}
            level={ramLevel}
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="nova-label">Flash</span>
            <span className={`text-xs font-medium ${LEVEL[flashLevel].text}`}>
              {kb(health.free_flash)} free
            </span>
          </div>
          <Meter
            value={(health.total_flash ?? 0) - (health.free_flash ?? 0)}
            max={health.total_flash ?? 0}
            level={flashLevel}
          />
        </div>
      </div>

      {faults.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg border border-nova-red/30 bg-nova-red/5 p-2">
          {faults.map((fault) => (
            <li key={fault} className="text-xs text-nova-red">
              {fault}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
