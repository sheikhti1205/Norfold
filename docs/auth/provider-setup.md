# Email codes and password recovery: provider setup

The app uses six-digit email codes for signup confirmation and forgotten
passwords: the recovery email delivers a code, not a link. Email/password
sign-in and Google sign-in remain available, and the recovery-link callback is
retained only as a silent fallback for older emails. Source support does **not**
establish email/SMS delivery.

## Configure Supabase separately

Use the existing Norfold project and `https://findbackapp.social`. These steps are
a manual provider checklist, not an automatic configuration or deployment script.

1. In Authentication → Email provider, keep email/password enabled and enable
   **Confirm Email** for signup confirmation. Set **Email OTP length to 6** to
   match this UI. Review expiry and rate limits; do not disable throttling.
2. Set up custom SMTP using a sender the project controls. Verify sender ownership
   and SPF/DKIM (and DMARC as appropriate) with the email provider. Keep
   credentials only in the provider and Supabase dashboards, never in the app, the
   repository or a chat. The built-in SMTP service is testing-only and restricts
   delivery to authorized team addresses; it is not public-production delivery.
3. In Email Templates → **Confirm signup**, use the
   [signup sample](confirm-signup-otp.html). The visible code is `{{ .Token }}`.
4. In **Reset password**, paste
   [`supabase/email-templates/reset-password.html`](../../supabase/email-templates/reset-password.html).
   That file is the canonical reset template; `reset-password-otp.html` in this
   directory is only a pointer page kept for older links. The template contains
   `{{ .Token }}` and presents no reset link: the app asks for the six-digit code
   from that email and has no separate "open the link" step. Disable provider
   link tracking/rewriting where it would damage the auth URL.
5. Keep the Site URL at `https://findbackapp.social`. Check the redirect allowlist
   includes `https://findbackapp.social/recovery` and the existing Google callback
   `https://findbackapp.social/auth/callback`. Do not introduce a new domain or
   alter native compatibility identities as part of this setup.
6. Review delivery logs and provider errors without recording codes or credentials.

## Phone verification (Telegram)

Phone verification goes through the Norfold Telegram bot, not SMS. The reader
starts the link from the Verify screen or the profile editor and shares their own
contact inside Telegram; the server records the number only after that contact is
validated. There is no SMS provider to configure, and a typed number on the
device never verifies anything. Keep the bot token server-side in the Edge
Function secret, never in the client.

## Receipt checks after configuration and test consent

- A new approved test address receives a signup code and verifies successfully.
- An existing approved address receives a recovery code, verifies, sets a new
  password and signs in normally; the old password is rejected.
- Wrong, expired and reused codes are rejected. Repeated requests are throttled.
- Unknown addresses get the same recovery-request wording, with no account lookup.
- Recovering account B while account A is signed in never updates A's password
  or adopts B's OTP session into A's app session. OTP completion invites sign-in;
  it does not claim the recovered account is already signed in.
- Test the code path manually end to end: request a reset, receive the six-digit
  code, verify it in the app, set a new password and confirm the old password is
  rejected. Test the existing Google callback independently.
- If SMS is enabled, use only a specifically approved test number and confirm
  receipt and identity preservation.

Track source/tests, CI, hosted configuration, real delivery and native/device
acceptance separately. Synthetic tests do not prove hosted delivery. A timed-out
password request may have reached the server: try normal sign-in before assuming
the write was rolled back. Cancellation is not a server rollback guarantee.

## References

- [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Verify OTP](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Password reset request](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Phone authentication](https://supabase.com/docs/guides/auth/phone-login)
