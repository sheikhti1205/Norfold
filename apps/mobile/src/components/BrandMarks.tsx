import { useId, type ReactNode } from "react";

/**
 * Brand marks for the connected-account rows (owner request 2026-11-17).
 *
 * These are the providers' own shapes, not recoloured Lucide substitutes: the
 * four-colour Google G, the Gmail envelope for Gmail addresses, and Telegram's
 * blue disc with the paper plane. Each mark is decorative here — the row title
 * already names the provider, so the SVG is aria-hidden and never announced
 * twice.
 */

interface MarkProps {
  size?: number;
  className?: string;
}

function frame(size: number, className: string, children: ReactNode) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
    >
      {children}
    </svg>
  );
}

export function GoogleMark({ size = 18, className = "" }: MarkProps) {
  return frame(size, className, <>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.83z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </>);
}

/** The Gmail M. Transparent gaps read correctly on both light and dark rows. */
export function GmailMark({ size = 18, className = "" }: MarkProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="52 42 88 66"
      className={className}
    >
      <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
    </svg>
  );
}

/** A solid envelope for every address that is not Gmail. */
export function MailMark({ size = 18, className = "" }: MarkProps) {
  return frame(size, className, <>
    <rect x="2" y="4" width="20" height="16" rx="3" fill="#5F6368" />
    <path d="M3.6 6.4 12 12.7l8.4-6.3" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </>);
}

/**
 * The address picks its own mark: Gmail accounts get Gmail, everything else a
 * neutral envelope. An absent address still renders (loading and error rows).
 */
export function EmailMark({ address, size = 18, className = "" }: MarkProps & { address?: string | null }) {
  const domain = (address ?? "").split("@")[1]?.toLowerCase() ?? "";
  return domain === "gmail.com" || domain === "googlemail.com"
    ? <GmailMark size={size} className={className} />
    : <MailMark size={size} className={className} />;
}

/** Telegram's own disc and plane, with a per-instance gradient id. */
export function TelegramMark({ size = 18, className = "" }: MarkProps) {
  const gradient = `fb-telegram-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 240 240"
      className={className}
    >
      <defs>
        <linearGradient id={gradient} x1="120" y1="240" x2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1d93d2" />
          <stop offset="1" stopColor="#38b0e3" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="120" r="120" fill={`url(#${gradient})`} />
      <path fill="#c8daea" d="M81.23 128.77l14.24 39.41s1.78 3.69 3.69 3.69 30.25-29.49 30.25-29.49l31.53-60.89-79.71 46.28z" />
      <path fill="#a9c6d8" d="M100.11 138.88l-2.73 29.05s-1.15 8.9 7.75 0 17.42-15.76 17.42-15.76" />
      <path fill="#fff" d="M81.49 130.18 52.2 120.64s-3.5-1.42-2.37-4.64c.23-.66.7-1.23 2.1-2.2 6.49-4.52 120.11-45.36 120.11-45.36s3.21-1.08 5.1-.36a2.77 2.77 0 0 1 1.88 2.06 9.36 9.36 0 0 1 .25 2.58c-.01.75-.1 1.45-.17 2.54-.69 11.17-21.4 94.5-21.4 94.5s-1.24 4.88-5.68 5.04a8.13 8.13 0 0 1-6.04-2.15c-8.71-7.49-38.82-27.73-45.47-32.18a1.27 1.27 0 0 1-.55-.9c-.09-.47.42-1.05.42-1.05s52.43-46.6 53.82-51.49c.11-.38-.3-.57-.85-.4-3.48 1.28-63.84 39.4-70.5 43.61a3.21 3.21 0 0 1-2.28.18z" />
    </svg>
  );
}
