"use client";

/**
 * Fingerprint capture animation shown beside the enrolment percentage.
 *
 * Two things are happening at once:
 *  - the ridges fill red from the bottom up in step with `percent`, so the
 *    progress bar has a visual twin staff can read across the room;
 *  - a pulsing target sits over the core of the print — the spot the member
 *    has to press — because the usual failure is a fingertip placed too high.
 */

const RIDGES = [
  // Outer to inner. Open arcs, drawn on a 64×80 grid centred on (32, 40).
  "M4 44a28 34 0 0 1 56 0v14",
  "M10 44a22 27 0 0 1 44 0v20",
  "M16 44a16 20 0 0 1 32 0v22",
  "M22 45a10 13 0 0 1 20 0v18",
  "M28 45a4 6 0 0 1 8 0v12",
];

export function FingerprintScan({
  percent,
  active = true,
  size = 84,
}: {
  percent: number;
  active?: boolean;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  // The print occupies y 10→80 in user units; fill rises from the bottom.
  const fillTop = 80 - (clamped / 100) * 70;

  return (
    <svg
      viewBox="0 0 64 80"
      width={size}
      height={(size / 64) * 80}
      fill="none"
      role="img"
      aria-label={`Fingerprint capture ${clamped}% complete`}
      className="shrink-0"
    >
      <defs>
        <clipPath id="fp-fill">
          <rect x="0" y={fillTop} width="64" height={80 - fillTop} />
        </clipPath>
        <linearGradient id="fp-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#C1102A" />
          <stop offset="100%" stopColor="#FF1E3C" />
        </linearGradient>
      </defs>

      {/* Unscanned ridges */}
      <g
        stroke="#3A3A47"
        strokeWidth="2.4"
        strokeLinecap="round"
        style={{ transition: "opacity 0.4s" }}
      >
        {RIDGES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Scanned portion, revealed as the capture progresses */}
      <g clipPath="url(#fp-fill)" stroke="url(#fp-grad)" strokeWidth="2.4" strokeLinecap="round">
        {RIDGES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Press-here target over the core of the print */}
      <g>
        <circle
          cx="32"
          cy="44"
          r="11"
          stroke="#FF1E3C"
          strokeWidth="1.2"
          strokeDasharray="4 4"
          opacity="0.55"
          className={active ? "animate-fp-target" : undefined}
          style={{ transformOrigin: "32px 44px" }}
        />
        <circle cx="32" cy="44" r="2" fill="#FF1E3C" opacity="0.9" />
      </g>

      {/* Sweeping scan line while the device is reading */}
      {active && (
        <g className="animate-fp-scan" style={{ transformOrigin: "center" }}>
          <rect x="2" y="43" width="60" height="1.4" fill="#FF1E3C" opacity="0.75" rx="0.7" />
          <rect x="2" y="40" width="60" height="7" fill="#FF1E3C" opacity="0.14" />
        </g>
      )}
    </svg>
  );
}
