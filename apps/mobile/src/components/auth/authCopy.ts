/** Generic sign-in failure, identical for missing accounts and wrong passwords. */
export const SIGNIN_GENERIC_ERROR =
  "We couldn't sign you in. Check your email and password and try again.";

/** Transport and service failures, independent of account existence. */
export const SIGNIN_CONNECTION_ERROR =
  "We couldn't connect. Check your connection and try again.";

/** Reset request outcome, identical whether or not the email exists. */
export const PASSWORD_RESET_SENT =
  "If an account uses this email, check your inbox for a recovery code.";

export const RECOVERY_INVALID_LINK = "This password-reset attempt is invalid or expired. Request a new one.";
export const RECOVERY_SUCCESS = "Your password is updated. You're signed in.";
export const RECOVERY_OTP_SUCCESS = "Your password is updated. You can now sign in with your new password.";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export type AuthGatewayMode = "email" | "signin" | "signup";
