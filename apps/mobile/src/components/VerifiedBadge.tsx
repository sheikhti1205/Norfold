import { useInfoLabel } from "./HoverLabel";
import "./VerifiedBadge.css";

export function verifiedTier(emailVerified?: boolean, phoneVerified?: boolean, telegramPhoneVerified?: boolean) {
  const email = emailVerified === true;
  const phone = phoneVerified === true || telegramPhoneVerified === true;
  return email && phone ? "both" : email ? "email" : phone ? "phone" : "none";
}

/** What the badge means, in the product's own verification terms. */
export function verifiedExplanation(tier: "both" | "email" | "phone") {
  if (tier === "email") return "Accounts with a verified badge have confirmed their email address.";
  if (tier === "phone") return "Accounts with a verified badge have confirmed their phone number.";
  return "Accounts with a verified badge have confirmed their email address and phone number.";
}

export function VerifiedBadge({ emailVerified, phoneVerified, telegramPhoneVerified }: {
  emailVerified?: boolean; phoneVerified?: boolean; telegramPhoneVerified?: boolean;
}) {
  const tier = verifiedTier(emailVerified, phoneVerified, telegramPhoneVerified);
  const { infoLabel } = useInfoLabel();
  if (tier === "none") return null;
  const label = tier === "both" ? "Email and phone verified" : tier === "email" ? "Email verified" : "Phone verified";
  return <span className={`fb-verified-badge fb-verified-badge--${tier}`} role="img" aria-label={label}
    {...infoLabel(verifiedExplanation(tier))}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {tier === "both" && <circle className="fb-verified-ring" cx="12" cy="12" r="11" />}
      <path className="fb-verified-seal" d="M12 2.8 14.2 4l2.5-.1 1.2 2.2 2.2 1.2-.1 2.5 1.2 2.2-1.2 2.2.1 2.5-2.2 1.2-1.2 2.2-2.5-.1-2.2 1.2-2.2-1.2-2.5.1-1.2-2.2-2.2-1.2.1-2.5L2.8 12 4 9.8l-.1-2.5 2.2-1.2 1.2-2.2 2.5.1z" />
      <path className="fb-verified-check" d="m8 12 2.5 2.5L16 9" />
    </svg>
  </span>;
}
