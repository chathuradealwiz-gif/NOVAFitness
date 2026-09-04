"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Loading";
import { scanWifi, switchWifi, cancelWifiCommand } from "@/lib/actions/device-wifi";
import type { Device, DeviceWifiCommandView } from "@/types/database";

/**
 * Which network a terminal is on, what else it can see, and — for a super
 * admin — a way to move it.
 *
 * The honest thing about this panel is the waiting. The terminal has no inbound
 * route, so a request sits until its next sync collects it and the answer
 * arrives on the one after: up to two sync intervals, not two seconds. Every
 * state below says so in words rather than showing a spinner that implies a
 * live connection.
 */

function since(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

/** Four bars, filled by strength. Mirrors the terminal's own status bar. */
function Bars({ rssi }: { rssi: number | null }) {
  const level = rssi == null ? 0 : rssi < -85 ? 1 : rssi < -75 ? 2 : rssi < -65 ? 3 : 4;
  return (
    <span className="inline-flex items-end gap-0.5" title={rssi == null ? "" : `${rssi} dBm`}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{ height: `${3 + i * 2}px` }}
          className={`w-1 rounded-sm ${i <= level ? "bg-emerald-400" : "bg-white/15"}`}
        />
      ))}
    </span>
  );
}

export function DeviceWifiPanel({
  device,
  isSuperAdmin,
  command,
}: {
  device: Device;
  isSuperAdmin: boolean;
  command: DeviceWifiCommandView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const current = device.health?.ssid ?? null;
  const online = device.health?.wifi !== false;
  const networks = device.wifi_networks ?? [];
  const waiting = command?.status === "pending" || command?.status === "sent";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "That did not work.");
      else {
        setTarget(null);
        setPassword("");
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-nova-border bg-nova-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="nova-label">Wi-Fi</p>
          <p className="mt-0.5 flex items-center gap-2 text-sm">
            {online && current ? (
              <>
                <Bars rssi={device.health?.rssi ?? null} />
                <span className="truncate font-medium">{current}</span>
              </>
            ) : (
              <span className="text-nova-red">Not connected</span>
            )}
          </p>
        </div>
        {isSuperAdmin && (
          <button
            className="nova-btn-ghost shrink-0 text-xs"
            disabled={pending || waiting}
            onClick={() => run(() => scanWifi(device.id))}
          >
            {pending ? <Spinner size={14} /> : "Scan"}
          </button>
        )}
      </div>

      {/* A request in flight. The terminal collects it on its next sync, so
          this can legitimately sit here for a minute or two. */}
      {waiting && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
          <p>
            {command?.action === "scan" ? "Scan" : `Switch to ${command?.ssid}`} requested{" "}
            {since(command?.created_at ?? null)}.{" "}
            {command?.status === "sent"
              ? "The terminal has it and is working on it."
              : "Waiting for the terminal to collect it on its next sync."}
          </p>
          {isSuperAdmin && command?.status === "pending" && (
            <button
              className="mt-1 underline underline-offset-2"
              disabled={pending}
              onClick={() => run(() => cancelWifiCommand(command.id))}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* The outcome of the last one, kept until another replaces it: a switch
          that failed is the thing you came to this page to find out. */}
      {!waiting && command && command.result && (
        <p
          className={`mt-3 text-xs ${
            command.status === "done" ? "text-emerald-400" : "text-nova-red"
          }`}
        >
          {command.status === "done" ? "✓" : "✕"} {command.result} · {since(command.completed_at)}
        </p>
      )}

      {networks.length > 0 && (
        <div className="mt-3">
          <p className="nova-label">
            In range · scanned {since(device.wifi_networks_at)}
          </p>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
            {networks.map((net) => (
              <li key={net.ssid}>
                <button
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm ${
                    net.ssid === target ? "bg-white/10" : "hover:bg-white/5"
                  } ${isSuperAdmin ? "" : "cursor-default"}`}
                  disabled={!isSuperAdmin || waiting}
                  onClick={() => {
                    setTarget(net.ssid === target ? null : net.ssid);
                    setPassword("");
                    setError(null);
                  }}
                >
                  <span className="truncate">
                    {net.ssid}
                    {net.ssid === current && (
                      <span className="ml-2 text-xs text-emerald-400">connected</span>
                    )}
                  </span>
                  <Bars rssi={net.rssi} />
                </button>

                {/* The password form opens under the network it belongs to, so
                    there is never a doubt about which one is being changed. */}
                {isSuperAdmin && net.ssid === target && (
                  <form
                    className="mt-1 space-y-2 rounded-lg border border-nova-border bg-nova-card p-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => switchWifi(device.id, net.ssid, password));
                    }}
                  >
                    <input
                      className="nova-input w-full text-sm"
                      type="password"
                      autoComplete="off"
                      placeholder="Network password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <p className="text-xs text-nova-muted">
                      The terminal joins {net.ssid} and only keeps it if that works. If it fails it
                      returns to {current ?? "its saved network"} and reports why.
                    </p>
                    <button className="nova-btn-primary w-full justify-center text-sm" disabled={pending}>
                      {pending ? <Spinner size={14} /> : "Switch network"}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-nova-red">{error}</p>}

      {networks.length === 0 && !waiting && (
        <p className="mt-3 text-xs text-nova-muted">
          {isSuperAdmin
            ? "No scan yet. Scan lists the networks the terminal can see, so you can move it without standing at the door."
            : "Only a super admin can scan or change the network from here."}
        </p>
      )}
    </div>
  );
}
