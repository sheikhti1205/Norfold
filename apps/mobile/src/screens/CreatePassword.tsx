import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth";
import { Button } from "../components/Button";
import { TextField } from "../components/Fields";

export function CreatePassword() {
  const { saveRequiredPassword, confirmRequiredPassword, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef(false);
  const inFlight = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!saved.current && password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!saved.current && password !== confirm) { setError("The passwords don't match."); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!saved.current) {
        await saveRequiredPassword(password);
        saved.current = true;
      }
      if (!await confirmRequiredPassword()) {
        setError("Your password was saved but we could not confirm it. Try again.");
      }
    } catch (err) {
      setError(saved.current ? "Your password was saved but we could not confirm it. Try again." : err instanceof Error ? err.message : "Could not save your password. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
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
      <p className="text-sm text-on-surface-variant">Add a password so you have another way to sign in.</p>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {error && <p role="alert" className="rounded-m3-sm border border-error px-3 py-2 text-sm text-error">{error}</p>}
        <TextField label="New password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" disabled={busy || saved.current} hint="At least 8 characters" required />
        <TextField label="Confirm new password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" disabled={busy || saved.current} required />
        <Button type="submit" loading={busy}>{saved.current ? "Try again" : "Save password"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void signOut()}>Sign out</Button>
      </form>
    </main>
  );
}
