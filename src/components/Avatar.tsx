/**
 * Member avatar.
 *
 * Shows the uploaded photo when there is one. Otherwise it renders a deterministic
 * monogram — the same person always gets the same gradient, so members stay
 * visually recognisable in a list even before anyone uploads a picture. That beats
 * a row of identical grey circles, and costs no network request.
 */

// On-brand gradient pairs: reds and warm darks, no stray blues.
const GRADIENTS = [
  ["#FF1E3C", "#7A0A1B"],
  ["#FF4D2E", "#8C1F0B"],
  ["#E11D48", "#4C0519"],
  ["#FF2D55", "#6B0F2A"],
  ["#C1102A", "#3B0710"],
  ["#FF6B35", "#7C2D12"],
];

/** Stable hash so a given member always lands on the same gradient. */
function pick(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length] as [string, string];
}

/** Up to two initials: "Pasan Chamudtha" -> "PC". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 48,
  rounded = "rounded-2xl",
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  rounded?: string;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`${rounded} border border-nova-border object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const [from, to] = pick(name);
  const id = `av-${Math.abs(
    [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0),
  )}`;

  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden ${rounded} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 100 100" width={size} height={size} role="presentation">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${id})`} />
        {/* Soft diagonal sheen so the tile reads as a surface, not a flat block. */}
        <path d="M0 0 L100 0 L0 100 Z" fill="rgba(255,255,255,0.10)" />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          fill="rgba(255,255,255,0.95)"
          fontSize="38"
          fontWeight="800"
          fontFamily="var(--font-display), system-ui, sans-serif"
          letterSpacing="1"
        >
          {initials(name)}
        </text>
      </svg>
    </span>
  );
}
