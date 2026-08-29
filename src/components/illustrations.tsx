/**
 * Original line-art illustrations, drawn as inline SVG.
 *
 * Inline rather than image files so they inherit the theme colour, stay sharp at
 * any size, add zero network requests, and carry no third-party licensing.
 * All of them use `currentColor` plus the brand red for the accent.
 */

type Props = { size?: number; className?: string };

const stroke = {
  fill: "none",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Dumbbell — members, workouts, generic gym empty states. */
export function DumbbellArt({ size = 96, className = "" }: Props) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <circle cx="60" cy="60" r="46" fill="rgba(255,30,60,0.07)" />
      <g stroke="currentColor" strokeWidth="3.5" {...stroke} opacity="0.55">
        <rect x="16" y="47" width="12" height="26" rx="4" />
        <rect x="92" y="47" width="12" height="26" rx="4" />
        <rect x="30" y="40" width="14" height="40" rx="5" />
        <rect x="76" y="40" width="14" height="40" rx="5" />
      </g>
      <line
        x1="44"
        y1="60"
        x2="76"
        y2="60"
        stroke="#FF1E3C"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Fingerprint — enrollment and device states. */
export function FingerprintArt({ size = 96, className = "" }: Props) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <circle cx="60" cy="60" r="46" fill="rgba(255,30,60,0.07)" />
      <g stroke="currentColor" strokeWidth="3" {...stroke} opacity="0.5">
        <path d="M32 62a28 28 0 0 1 56 0v10" />
        <path d="M42 62a18 18 0 0 1 36 0v14" />
        <path d="M42 84v-4" />
        <path d="M68 62v22" />
      </g>
      <path
        d="M52 62a8 8 0 0 1 16 0v20"
        stroke="#FF1E3C"
        strokeWidth="3.5"
        {...stroke}
      />
    </svg>
  );
}

/** Receipt — payments and finance empty states. */
export function ReceiptArt({ size = 96, className = "" }: Props) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <circle cx="60" cy="60" r="46" fill="rgba(255,30,60,0.07)" />
      <path
        d="M40 30h40v58l-8-6-8 6-8-6-8 6-8-6V30Z"
        stroke="currentColor"
        strokeWidth="3.5"
        opacity="0.55"
        {...stroke}
      />
      <g stroke="#FF1E3C" strokeWidth="3.5" {...stroke}>
        <line x1="50" y1="46" x2="70" y2="46" />
        <line x1="50" y1="58" x2="64" y2="58" />
      </g>
    </svg>
  );
}

/** Calendar tick — attendance empty states. */
export function AttendanceArt({ size = 96, className = "" }: Props) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <circle cx="60" cy="60" r="46" fill="rgba(255,30,60,0.07)" />
      <g stroke="currentColor" strokeWidth="3.5" {...stroke} opacity="0.55">
        <rect x="32" y="36" width="56" height="50" rx="7" />
        <line x1="32" y1="50" x2="88" y2="50" />
        <line x1="45" y1="28" x2="45" y2="40" />
        <line x1="75" y1="28" x2="75" y2="40" />
      </g>
      <path d="M48 66l8 8 16-16" stroke="#FF1E3C" strokeWidth="4.5" {...stroke} />
    </svg>
  );
}

/** Plate/cutlery — meal plan empty states. */
export function MealArt({ size = 96, className = "" }: Props) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <circle cx="60" cy="60" r="46" fill="rgba(255,30,60,0.07)" />
      <g stroke="currentColor" strokeWidth="3.5" {...stroke} opacity="0.55">
        <circle cx="60" cy="60" r="22" />
        <path d="M34 34v18a6 6 0 0 0 12 0V34" />
        <line x1="40" y1="52" x2="40" y2="86" />
      </g>
      <path d="M80 34c6 4 6 14 0 18v34" stroke="#FF1E3C" strokeWidth="3.5" {...stroke} />
    </svg>
  );
}

/** Megaphone — broadcast empty states. */
export function BroadcastArt({ size = 96, className = "" }: Props) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden>
      <circle cx="60" cy="60" r="46" fill="rgba(255,30,60,0.07)" />
      <path
        d="M38 52h12l26-16v48L50 68H38a6 6 0 0 1-6-6v-4a6 6 0 0 1 6-6Z"
        stroke="currentColor"
        strokeWidth="3.5"
        opacity="0.55"
        {...stroke}
      />
      <g stroke="#FF1E3C" strokeWidth="3.5" {...stroke}>
        <path d="M86 48c4 4 4 20 0 24" />
      </g>
      <path d="M48 68v14a6 6 0 0 0 12 0v-8" stroke="currentColor" strokeWidth="3.5" opacity="0.55" {...stroke} />
    </svg>
  );
}
