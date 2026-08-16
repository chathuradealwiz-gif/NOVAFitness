import Image from "next/image";

/**
 * Brand mark. Falls back to a wordmark so the app is never broken before the gym
 * uploads its logo; `logoPath` comes from gym_settings so the asset can be
 * replaced without a code change (spec §36).
 */
const DEFAULT_LOGO = "/logo.jpg";

export function Logo({
  logoPath,
  size = 40,
  showName = true,
}: {
  logoPath?: string | null;
  size?: number;
  showName?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-3">
      <Image
        src={logoPath || DEFAULT_LOGO}
        alt="NOVA FITNESS"
        width={size}
        height={size}
        className="rounded-lg object-contain"
        priority
      />
      {showName && (
        <span className="font-display text-base font-black uppercase tracking-[0.14em] leading-none">
          NOVA{" "}
          <span className="text-nova-red [text-shadow:0_0_18px_rgba(255,30,60,0.55)]">
            FITNESS
          </span>
        </span>
      )}
    </span>
  );
}
