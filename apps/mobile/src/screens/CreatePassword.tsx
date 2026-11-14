import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth";
import { Button } from "../components/Button";
import { TextField } from "../components/Fields";
import { OtpField } from "../components/auth/OtpField";
import { useOtpCountdown } from "../components/auth/useOtpCountdown";

type Step = "password" | "code";

export function CreatePassword() {
  const {
    user,
    requestRequiredPasswordCode,
    saveRequiredPassword,
    confirmRequiredPassword,
    dismissPasswordSetup,
    logout,
  } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const { seconds: resendIn, setSeconds: setResendIn } = useOtpCountdown();
  const inFlight = useRef(false);

  function validatePassword(): boolean {
    if (password.length < 8) { setError("Password must be at least 8 characters."); return false; }
    if (password !== confirm) { setError("The passwords don't match."); return false; }
    return true;
  }

  function rateLimitWait(err: unknown): number {
    if (err instanceof Error && "retryAfterSeconds" in err && typeof err.retryAfterSeconds === "number" && Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds > 0) {
      return err.retryAfterSeconds;
    }
    return 60;
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current) return;
    setError(null);
    setMessage(null);
    if (!validatePassword()) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await requestRequiredPasswordCode();
      setSaved(false);
      setStep("code");
      setCode("");
      setResendIn(30);
      setMessage(`We sent a code to ${user?.email ?? "your email"}. Enter it to save your password.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code. Try again.");
      if (err instanceof Error && /too many|several codes/i.test(err.message)) setResendIn(rateLimitWait(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(null);
    if (!saved && !/^\d{6,10}$/.test(code.trim())) {
      setError("Enter the code from your email.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      if (saved) {
        if (await confirmRequiredPassword()) {
          navigate("/", { replace: true });
          return;
        }
        setError("Your password was saved, but we still couldn't verify it. Check your connection and try again.");
        return;
      }
      const { confirmed } = await saveRequiredPassword(password, code.trim());
      if (confirmed) {
        navigate("/", { replace: true });
        return;
      }
      setSaved(true);
      setMessage("Your password was saved. We couldn't verify it yet.");
      setError("Try again to finish; your password does not need to be saved twice.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your password. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function resendCode() {
    if (inFlight.current || resendIn > 0) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await requestRequiredPasswordCode();
      setResendIn(30);
      setCode("");
      setMessage("A new code was sent. The most recent code is the one that works.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code. Try again.");
      if (err instanceof Error && /too many|several codes/i.test(err.message)) setResendIn(rateLimitWait(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function editPassword() {
    if (inFlight.current) return;
    setStep("password");
    setSaved(false);
    setCode("");
    setError(null);
    setMessage(null);
  }

  function notNow() {
    if (inFlight.current) return;
    dismissPasswordSetup();
    navigate("/", { replace: true });
  }

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await logout();
      navigate("/", { replace: true, state: { showPublic: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 bg-surface px-4 py-8 text-on-surface" style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      <h1 className="text-xl font-semibold">Create a password</h1>
      <p className="break-words text-sm text-on-surface-variant">
        {step === "password"
          ? "Add a password so you have another way to sign in. We'll email you a code to confirm it's you."
          : saved
            ? "Your password is saved. We're checking the server's record before letting you continue."
            : `Enter the code sent to ${user?.email ?? "your email"} to save your password.`}
      </p>

      {message && <p role="status" className="break-words rounded-m3-sm border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant">{message}</p>}
      {error && <p role="alert" className="break-words rounded-m3-sm border border-error px-3 py-2 text-sm text-error">{error}</p>}

      {step === "password" ? (
        <form className="flex flex-col gap-4" onSubmit={sendCode} noValidate>
          <TextField label="New password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" disabled={busy} hint="At least 8 characters" required />
          <TextField label="Confirm new password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" disabled={busy} required />
          <Button type="submit" loading={busy} size="lg">Send code</Button>
          <Button type="button" variant="outline" disabled={busy} size="lg" onClick={notNow}>Not now</Button>
          <Button type="button" variant="text" disabled={busy} onClick={() => void signOut()}>Sign out</Button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submitCode} noValidate>
          {!saved && <OtpField label="Email code" value={code} onChange={setCode} maxLength={10} disabled={busy} />}
          <Button type="submit" loading={busy} size="lg" disabled={!saved && !/^\d{6,10}$/.test(code.trim())}>
            {saved ? "Try again" : "Verify and save"}
          </Button>
          {!saved && (
            <Button type="button" variant="outline" disabled={busy || resendIn > 0} size="lg" onClick={() => void resendCode()}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </Button>
          )}
          {!saved && <Button type="button" variant="text" disabled={busy} onClick={editPassword}>Back</Button>}
          <Button type="button" variant="outline" disabled={busy} size="lg" onClick={notNow}>Not now</Button>
          <Button type="button" variant="text" disabled={busy} onClick={() => void signOut()}>Sign out</Button>
        </form>
      )}
    </main>
  );
}
