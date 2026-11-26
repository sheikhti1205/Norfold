import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "../auth";
import { Button } from "../components/Button";
import { motionDurations, motionEasings } from "../components/uiMotion";
import { motion } from "framer-motion";
import { sendPendingEmailCode, verifyPendingEmailCode } from "../services/auth";
import { getPendingReportRoute } from "../utils/pendingReportLink";
import { AuthShell } from "../components/auth/AuthShell";
import { OtpField } from "../components/auth/OtpField";
import { useOtpCountdown } from "../components/auth/useOtpCountdown";
import { TelegramPhoneVerification } from "../components/TelegramPhoneVerification";

function useResendCountdown(initial = 0, deadline?: number) {
  const { seconds, setSeconds } = useOtpCountdown(initial, deadline);
  return { resendIn: seconds, setResendIn: setSeconds } as const;
}

/** Email is the only code-based channel. Phone ownership is proven in Telegram. */
function EmailVerifyRow() {
  const { user, refreshUser } = useAuth();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const { resendIn, setResendIn } = useResendCountdown();
  const { resendIn: verifyIn, setResendIn: setVerifyIn } = useResendCountdown();

  if (!user) return null;

  if (user.emailVerified) {
    return (
      <div className="flex items-start gap-3 rounded-m3-md bg-surface-container-low p-4">
        <CheckCircle2 className="mt-0.5 shrink-0 text-on-surface" size={20} aria-hidden />
        <div>
          <p className="font-medium">Email verified</p>
          <p className="text-sm text-on-surface-variant">{user.email}</p>
        </div>
      </div>
    );
  }

  async function onSend() {
    if (busy.current || resendIn > 0) return;
    busy.current = true;
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      await sendPendingEmailCode(user!.email);
      if (!alive.current) return;
      setSent(true);
      setCode("");
      setResendIn(30);
      setMessage(`Code requested for ${user!.email}. Check your email.`);
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : "Could not send code");
      if (err instanceof Error && "code" in err && err.code === "EMAIL_SEND_LIMITED") {
        const retry = "retryAfterSeconds" in err && typeof err.retryAfterSeconds === "number" && Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds > 0 ? err.retryAfterSeconds : 60;
        setResendIn(retry);
      } else if (err instanceof Error && /too many attempts/i.test(err.message)) setResendIn(60);
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  }

  async function onVerify() {
    if (busy.current || verifyIn > 0) return;
    busy.current = true;
    setVerifying(true);
    setError(null);
    try {
      await verifyPendingEmailCode(user!.email, code.trim());
      if (!alive.current) return;
      await refreshUser();
      if (!alive.current) return;
      setCode("");
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : "Verification failed");
      if (err instanceof Error && /too many attempts/i.test(err.message)) {
        setVerifyIn(60);
        setResendIn(60);
      }
    } finally {
      busy.current = false;
      if (alive.current) setVerifying(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: motionDurations.standard, ease: motionEasings.out }}
      className="flex flex-col gap-3 rounded-m3-md bg-surface-container-low p-4"
    >
      <p className="text-sm text-on-surface-variant">
        {sent ? "Enter the code sent to " : "Send an email code to "}<span className="font-medium text-on-surface">{user.email}</span>.
      </p>

      {message && (
        <p className="text-sm text-on-surface-variant" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}

      <OtpField label="Verification code" value={code} onChange={setCode} maxLength={10} disabled={sending || verifying} />

      <div className="flex flex-col gap-2">
        <Button onClick={onVerify} loading={verifying} disabled={sending || verifyIn > 0} size="lg">
          {verifyIn > 0 ? `Verify again in ${verifyIn}s` : "Verify email"}
        </Button>
        <Button variant="outline" size="lg" onClick={onSend} loading={sending} disabled={resendIn > 0 || verifying}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : sent ? "Resend email code" : "Send email code"}
        </Button>
      </div>
    </motion.div>
  );
}

/**
 * Pending-signup mode: the user has no session yet, so this uses the public
 * `/auth/email-verification/*` endpoints. On success the first Supabase session
 * is stored and the pending destination (usually the shared report) is entered.
 */
function PendingEmailVerify({ email }: { email: string }) {
  const { verifyPendingEmail, resendPendingEmail, pendingEmailDeadline } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(
    "If your signup is awaiting verification, check your email for a code.",
  );
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const { resendIn, setResendIn } = useResendCountdown(0, pendingEmailDeadline ?? 0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function onResend() {
    if (inFlight.current || resendIn > 0) return;
    inFlight.current = true;
    setResending(true);
    setError(null);
    setMessage(null);
    try {
      await resendPendingEmail();
      if (!alive.current) return;
      setMessage("If your signup is awaiting verification, check your email for a fresh code.");
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : "Could not resend code");
        if (err instanceof Error && /too many attempts/i.test(err.message)) setResendIn(60);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setResending(false);
    }
  }

  async function onVerify() {
    if (inFlight.current) return;
    if (!/^\d{6,10}$/.test(code)) { setError("Enter the verification code from your email."); return; }
    inFlight.current = true;
    setVerifying(true);
    setError(null);
    try {
      await verifyPendingEmail(code.trim());
      if (!alive.current) return;
      navigate(getPendingReportRoute() ?? "/", { replace: true });
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : "Verification failed");
        if (err instanceof Error && /too many attempts/i.test(err.message)) setResendIn(60);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setVerifying(false);
    }
  }

  return (
    <AuthShell
      title="Check your email"
      supporting="Enter your email code to finish creating your account."
    >
      <p className="rounded-m3-md bg-surface-container-low px-4 py-3 text-sm">
        <span className="break-all font-medium text-on-surface">{email}</span>
      </p>

      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void onVerify(); }}>
        {message && (
          <p className="text-sm text-on-surface-variant" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        )}

        <OtpField value={code} onChange={setCode} maxLength={10} disabled={verifying || resending} />

        <Button type="submit" loading={verifying} disabled={resending} size="lg">
          Verify and continue
        </Button>

        <Button type="button" variant="outline" size="lg" onClick={onResend} loading={resending} disabled={resendIn > 0 || verifying}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex min-h-12 min-w-12 shrink-0 items-center px-2 text-sm font-medium text-on-surface underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Back
          </button>
          <Link
            to="/auth"
            className="flex min-h-12 max-w-full shrink-0 items-center px-2 text-sm font-medium text-on-surface underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Use a different email
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function Verify() {
  const { user, pendingEmail, booting } = useAuth();
  const navigate = useNavigate();

  if (booting) return null;
  if (!user && !pendingEmail) return <Navigate to="/signin" replace />;
  if (!user && pendingEmail) return <PendingEmailVerify key={pendingEmail} email={pendingEmail} />;

  return (
    <AuthShell
      title="Verify your contact details"
      supporting="Confirm your email with a code, and your mobile number through Telegram."
    >
      <div className="flex flex-col gap-3">
        <EmailVerifyRow key={`${user!.id}:email:${user!.email}`} />
        <div className="rounded-m3-md bg-surface-container-low p-4">
          <TelegramPhoneVerification key={`${user!.id}:telegram`} />
        </div>
      </div>
      <Button size="lg" onClick={() => navigate(getPendingReportRoute() ?? "/", { replace: true })}>
        Continue to app
      </Button>
    </AuthShell>
  );
}
