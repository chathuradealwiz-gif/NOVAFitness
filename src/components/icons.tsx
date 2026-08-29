/**
 * Icon set.
 *
 * One consistent family: 24×24 grid, stroke-based, `currentColor`, rounded caps.
 * Inline SVG rather than an icon package — it keeps the bundle flat, inherits the
 * active/muted colour from the parent, and needs no network request.
 */

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function Svg({
  size = 20,
  className = "",
  strokeWidth = 1.75,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ navigation */

export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </Svg>
);

export const IconMembers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6" />
    <path d="M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </Svg>
);

export const IconAttendance = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M8.5 15.5l2.5 2.5 4.5-4.5" />
  </Svg>
);

export const IconPayments = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="13" rx="3" />
    <path d="M2.5 10.5h19" />
    <path d="M6.5 15h3" />
  </Svg>
);

export const IconFinance = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <rect x="4.5" y="12" width="4" height="7" rx="1.2" />
    <rect x="10" y="8" width="4" height="11" rx="1.2" />
    <rect x="15.5" y="4" width="4" height="15" rx="1.2" />
  </Svg>
);

export const IconWorkout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 9.5v5M5.5 7v10M18.5 7v10M21.5 9.5v5" />
    <path d="M5.5 12h13" />
  </Svg>
);

export const IconMeal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3v7a2.5 2.5 0 0 0 5 0V3" />
    <path d="M7.5 12.5V21" />
    <path d="M17.5 3c2 1.8 2 6.2 0 8v10" />
  </Svg>
);

export const IconBroadcast = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5h3l8-5v15l-8-5H4a1.5 1.5 0 0 1-1.5-1.5v-2A1.5 1.5 0 0 1 4 9.5Z" />
    <path d="M18.5 8.5c1.8 2 1.8 5 0 7" />
    <path d="M7.5 14.5v4a2 2 0 0 0 4 0v-1.5" />
  </Svg>
);

export const IconDevice = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="3" />
    <path d="M9 6.5h6" />
    <circle cx="12" cy="14" r="3" />
  </Svg>
);

export const IconAdmins = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5 20 6v6c0 4.5-3.2 8.2-8 9.5-4.8-1.3-8-5-8-9.5V6l8-3.5Z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Svg>
);

export const IconAudit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5h14v17H5z" />
    <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7 17 17M7 7 5.3 5.3" />
  </Svg>
);

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 10.5 12 3l8.5 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.5 20v-6h5v6" />
  </Svg>
);

export const IconProfile = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20.5a8 8 0 0 1 16 0" />
  </Svg>
);

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

/* ---------------------------------------------------------------------- actions */

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconFingerprint = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12a7 7 0 0 1 14 0v3" />
    <path d="M8.5 12a3.5 3.5 0 0 1 7 0v5" />
    <path d="M12 12v8" />
    <path d="M5 16v2" />
  </Svg>
);

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.4 2.4 0 0 0-3.4-3.4L4.5 16.7V20Z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </Svg>
);

export const IconStatus = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5l3 2" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v11" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4.5 19.5h15" />
  </Svg>
);

export const IconPrint = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 9V3.5h10V9" />
    <rect x="3.5" y="9" width="17" height="7.5" rx="2" />
    <path d="M7 14.5h10v6H7z" />
  </Svg>
);

export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
);

export const IconLogout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4.5H6.5v15H14" />
    <path d="M17.5 12H10" />
    <path d="M15 9l3 3-3 3" />
  </Svg>
);

export const IconWhatsApp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 20.5 5 16.6A8.2 8.2 0 1 1 8 19.4l-4.5 1.1Z" />
    <path d="M9 9.2c.3 2.3 2.4 4.4 4.7 4.8l1-1.4 1.8.8v1.6c-2.9.6-6.9-3-7.5-6.2h1.6l.8 1.8L9 9.2Z" />
  </Svg>
);

/** Quick-pay: a banknote with a lightning bolt, distinct from IconPayments. */
export const IconPay = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="3" />
    <path d="M13 9l-2.5 3.5h3L11 16" />
    <path d="M5.5 9v6" />
    <path d="M18.5 9v6" />
  </Svg>
);
