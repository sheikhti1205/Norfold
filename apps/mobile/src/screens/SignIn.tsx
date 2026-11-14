import { AuthGateway } from "./AuthGateway";
import { useLocation } from "react-router";
import { readRememberedAccounts } from "../services/rememberedAccounts";

/**
 * Compat entry: `/signin` maps to the auth gateway in sign-in mode.
 * Renderable standalone; the lead integrator may rewire this route to
 * `<AuthGateway initialMode="signin" />` directly.
 */
export function SignIn({ email }: { email?: string }) {
  const location = useLocation();
  const state = location.state as { rememberedAccountId?: unknown; switchNeedsSignIn?: unknown } | null;
  const id = state?.rememberedAccountId;
  const remembered = typeof id === "string" ? readRememberedAccounts().find(account => account.id === id) : undefined;
  return <>{state?.switchNeedsSignIn === true && <p role="alert">Please sign in again to switch accounts.</p>}
    <AuthGateway initialMode="signin" initialEmail={email ?? remembered?.loginEmail ?? ""} /></>;
}
