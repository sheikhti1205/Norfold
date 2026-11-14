import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PublicUser } from "@norfold/shared";
import {
  BootTimeoutError,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  restoreSession,
  sendPendingEmailCode,
  verifyPendingEmailCode,
  readHasAccountPassword,
  sendAccountPasswordCode,
  saveAccountPasswordWithCode,
} from "./services/auth";
import {
  beginAccountSwitch,
  clearAllAuth,
  getPendingEmail,
  onSignedOut,
  setPendingEmail as persistPendingEmail,
  setToken,
} from "./services/session";
import { detachSupabaseAccount, getSupabase } from "./services/supabaseClient";
import { readAccountSession, removeAccountSession, saveAccountSession } from "./services/accountSessions";
import { readAuthSessionId } from "./services/authSessionIdentity";
import { clearMessagingRuntime, ensureMessagingDevice } from "./services/messaging/runtime";
import { AuthAccountChangedError } from "./services/accountScopedAuthStorage";
import { storage } from "./services/storage";
import { clearSessionExpired, markSessionExpired, sessionExpiryCandidate } from "./services/sessionExpiry";
import { ApiError } from "./services/session";
import {
  connectRealtime,
  disconnectRealtime,
  joinInboxRoom,
  leaveInboxRoom,
} from "./services/realtime";
import {
  GoogleAuthError,
  startGoogleSignIn as startNativeGoogleSignIn,
} from "./native/googleAuth";
import { recordOperation } from "./services/monitoring/operations";
import { startPushNotifications, stopPushNotifications } from "./services/pushRuntime";
import { clearUserScopedLocalState } from "./services/userScopedState";
import { aiCredentials } from "./services/aiCredentials";
import { purgeMessagingAccount } from "./services/messaging/runtime";
import { readRememberedAccounts, rememberAccount, refreshRememberedAccount, removeRememberedAccount, type RememberedAccount } from "./services/rememberedAccounts";
import { addAccountIntentAccount, clearAddAccountIntent } from "./utils/addAccountIntent";
import {
  beginConfirmedAccountDeletion, finishAccountAuthCleanup, inspectPendingAccountDeletions,
  type PendingAccountDeletion,
} from "./services/messaging/scopedMediaBytes";
// W0-B (S2, additive): Google ID-token seam + missing-profile seed. auth.ts,
// session.ts, and userScopedState.ts remain the owners of their behavior.
import {
  getNeedsProfileSeed,
  signInWithGoogleIdToken,
  type GoogleProfileSeed,
  type GoogleSignInOutcome,
} from "./services/auth/googleSignIn";

export type RegisterOutcome =
  | { status: "authenticated"; user: PublicUser }
  | { status: "pending"; email: string };

export type SwitchAccountResult = { status: "switched" } | { status: "needs-sign-in" };

interface AuthContextValue {
  user: PublicUser | null;
  /** Authoritative password presence; null while unknown or unverifiable. */
  hasPassword: boolean | null;
  needsPasswordSetup: boolean;
  passwordSetupSettled: boolean;
  /** Send the code that must precede a password save (prompt flow only). */
  requestRequiredPasswordCode: () => Promise<void>;
  /** Verify the emailed code, set the password, then reread the authority. */
  saveRequiredPassword: (password: string, code: string) => Promise<{ confirmed: boolean }>;
  /** Re-read the authority only; never writes the password again. */
  confirmRequiredPassword: () => Promise<boolean>;
  /** Session-scoped "Not now"; the prompt does not nag again this session. */
  dismissPasswordSetup: () => void;
  /** Re-read the authority after a password write from another screen. */
  refreshPasswordPresence: () => Promise<boolean>;
  /** SDK session routing identity only; never a token or authority certificate. */
  authSessionId: string | null;
  /** True while we try to hydrate a stored session on boot. */
  booting: boolean;
  /** Non-null when boot could not reach the backend (session kept, Retry offered). */
  bootError: string | null;
  /** Re-run the boot restore after a boot error. */
  retryBoot: () => void;
  /** Email awaiting pending-signup verification (Supabase Confirm-email ON). */
  pendingEmail: string | null;
  pendingEmailDeadline: number;
  login: (email: string, password: string) => Promise<PublicUser>;
  register: (input: {
    username: string;
    email: string;
    phone: string;
    password: string;
  }) => Promise<RegisterOutcome>;
  /** Verify a pending-signup email OTP; establishes the first session. */
  verifyPendingEmail: (code: string) => Promise<PublicUser>;
  /** Resend the pending-signup confirmation code. */
  resendPendingEmail: () => Promise<void>;
  logout: (options?: { keepAccount?: boolean }) => Promise<void>;
  switchAccount: (account: RememberedAccount) => Promise<SwitchAccountResult>;
  setAccountKept: (id: string, keep: boolean) => Promise<void>;
  deletionCompletion: { accountId: string; state: "cleaning" | "complete" | "cleanup-failed" } | null;
  /** Inventory failure is not evidence that an account was deleted. */
  deletionRecoveryError: boolean;
  finishAccountDeletion: (accountId: string) => Promise<void>;
  retryDeletionCleanup: () => Promise<void>;
  dismissDeletionCompletion: () => void;
  refreshUser: () => Promise<void>;
  setUser: (user: PublicUser) => void;
  /** W0-B (S2, additive): bridge token → Supabase session. Returns the user
   *  when authenticated, or null when routed to completion (see needsProfile). */
  signInWithGoogle: (mode: "signin" | "signup") => Promise<PublicUser | null>;
  /** W0-B (S2, additive): set when a valid session has no Norfold profile
   *  (new Google account or interrupted completion). The session is KEPT —
   *  this state never signs the user out. */
  needsProfile: GoogleProfileSeed | null;
  /** W0-B (S2, additive): dismiss the completion state (after completeSocialProfile). */
  clearNeedsProfile: () => void;
  /** X1 (web OAuth): adopt the outcome resolved by the external callback bridge. */
  adoptExternalAuthOutcome: (outcome: GoogleSignInOutcome) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const DELETION_CLEANUP_KEY = "findback.auth.deletedAccountCleanup";
const PENDING_DEADLINE_KEY = "findback.auth.pendingEmailDeadline";
const PASSWORD_DISMISS_KEY = "findback.auth.passwordPromptDismissed";

function passwordDismissKey(accountId: string): string {
  return `${PASSWORD_DISMISS_KEY}:${accountId}`;
}

/** Session-scoped: one tab's "Not now" survives reloads until it is closed. */
function readPasswordPromptDismissed(accountId: string): boolean {
  try { return sessionStorage.getItem(passwordDismissKey(accountId)) === "1"; } catch { return false; }
}

function rememberPasswordPromptDismissed(accountId: string): void {
  try { sessionStorage.setItem(passwordDismissKey(accountId), "1"); } catch { /* keep it in memory */ }
}

type PasswordPresence = "unknown" | "has" | "missing";

function readPendingDeadline(email: string | null): number {
  try {
    const value = JSON.parse(storage.getItem(PENDING_DEADLINE_KEY) ?? "null") as { email?: unknown; deadline?: unknown } | null;
    return email && value?.email === email && typeof value.deadline === "number" && Number.isFinite(value.deadline) ? value.deadline : 0;
  } catch { return 0; }
}

export function AuthProvider({ children, boot = true }: { children: ReactNode; boot?: boolean }) {
  const [passwordPresence, setPasswordPresence] = useState<PasswordPresence>("unknown");
  const passwordPresenceRef = useRef<PasswordPresence>("unknown");
  const [passwordPromptDismissed, setPasswordPromptDismissed] = useState(false);
  // `boot={false}` is the static visual-fixture mount: it renders real
  // components with no session, no SDK and no network, so the state is settled
  // from the first paint instead of waiting on a restore that will never run.
  const [passwordSetupSettled, setPasswordSetupSettled] = useState(!boot);
  const passwordGate = useRef<{ account: string | null; required: boolean }>({ account: null, required: false });
  const passwordPresenceRead = useRef(0);
  // Derived, never a second source of truth: the prompt exists only while the
  // server says there is no password AND this session has not dismissed it.
  const needsPasswordSetup = passwordPresence === "missing" && !passwordPromptDismissed;
  const hasPassword = passwordPresence === "unknown" ? null : passwordPresence === "has";
  const [authSessionId,setAuthSessionId]=useState<string|null>(null);
  const sdkSessionId=useRef<string|null>(null);
  const [user, publishUser] = useState<PublicUser | null>(null);
  const currentUser = useRef<PublicUser | null>(null);
  const sdkAccount = useRef<string | null>(null);
  // Historical slot only: null after B signs out must not make delayed A work
  // look like A still owns global state. This never authenticates/adopts anyone.
  const lastAccount = useRef<string | null>(null);
  const sdkObserved = useRef(false);
  const profileAdoptionBlocked = useRef(false);
  const authEpoch = useRef(0);
  const hadStoredSession = useRef(sessionExpiryCandidate());
  const intentionalSignOut = useRef(new Map<string | null, number>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unadmittedDeletions = useRef(new Set<string>());
  const deletionWork = useRef<Promise<unknown>>(Promise.resolve());
  const deletionPresentation = useRef(0);
  const [deletionRecoveryError, setDeletionRecoveryError] = useState(false);
  const serializeDeletion = useCallback((work: () => Promise<void>) => {
    const next = deletionWork.current.catch(() => undefined).then(work);
    deletionWork.current = next;
    return next;
  }, []);
  const assertAccount = useCallback((accountId: string) => {
    if (profileAdoptionBlocked.current || (sdkObserved.current && sdkAccount.current !== accountId)) throw new AuthAccountChangedError();
  }, []);
  const setUserState = useCallback((next: PublicUser | null) => {
    // A different account finishing sign-in ends an "add another account"
    // attempt. Same-account refreshes and boot restores leave it untouched, so
    // a provider round trip keeps its intent until the second account lands.
    const addAccountOrigin = addAccountIntentAccount();
    if (next !== null && addAccountOrigin !== null && addAccountOrigin !== next.id) clearAddAccountIntent();
    if (next !== null) assertAccount(next.id);
    if (next !== null) clearSessionExpired();
    if (next !== null) lastAccount.current = next.id;
    if (next !== null) refreshRememberedAccount(next);
    currentUser.current = next;
    publishUser(next);
  }, [assertAccount]);
  const applyPasswordPresence = useCallback((accountId: string, presence: PasswordPresence) => {
    if (sdkAccount.current !== accountId) return;
    passwordPresenceRef.current = presence;
    passwordGate.current = { account: accountId, required: presence === "missing" };
    setPasswordPresence(presence);
    setPasswordPromptDismissed(presence === "missing" && readPasswordPromptDismissed(accountId));
    setPasswordSetupSettled(true);
  }, []);
  const resetPasswordPresence = useCallback(() => {
    ++passwordPresenceRead.current;
    passwordPresenceRef.current = "unknown";
    passwordGate.current = { account: null, required: false };
    setPasswordPresence("unknown");
    setPasswordPromptDismissed(false);
    setPasswordSetupSettled(true);
  }, []);
  const readPasswordPresence = useCallback((accountId: string, block: boolean) => {
    const read = ++passwordPresenceRead.current;
    if (block) setPasswordSetupSettled(false);
    // Deferred: awaiting Supabase inside onAuthStateChange can deadlock.
    setTimeout(() => {
      void readHasAccountPassword()
        .then((present) => {
          if (read !== passwordPresenceRead.current || sdkAccount.current !== accountId) return;
          applyPasswordPresence(accountId, present ? "has" : "missing");
        })
        .catch(() => {
          if (read !== passwordPresenceRead.current || sdkAccount.current !== accountId) return;
          // A failed read is never proof that a password is missing. Keep a
          // known answer; an unknown answer must not manufacture a prompt.
          if (passwordPresenceRef.current === "unknown") applyPasswordPresence(accountId, "unknown");
          else setPasswordSetupSettled(true);
        });
    }, 0);
  }, [applyPasswordPresence]);
  const [deletionCompletion, setDeletionCompletion] = useState<AuthContextValue["deletionCompletion"]>(null);
  const [pendingEmail, setPendingEmailState] = useState<string | null>(() => getPendingEmail());
  const [pendingEmailDeadline, setPendingEmailDeadline] = useState(() => readPendingDeadline(getPendingEmail()));
  const savePendingDeadline = useCallback((email: string, deadline: number) => {
    const next = Math.max(readPendingDeadline(email), deadline);
    try { storage.setItem(PENDING_DEADLINE_KEY, JSON.stringify({ email, deadline: next })); } catch { /* Keep the deadline in memory. */ }
    setPendingEmailDeadline(next);
  }, []);
  useEffect(() => {
    if (!pendingEmail) {
      try { storage.removeItem(PENDING_DEADLINE_KEY); } catch { /* Storage may be unavailable. */ }
    }
  }, [pendingEmail]);
  const [booting, setBooting] = useState(boot);
  const [bootError, setBootError] = useState<string | null>(null);
  // W0-B (S2, additive): social profile-completion state. Independent of user;
  // a valid session with no profile row sets this WITHOUT signing out.
  const [needsProfile, setNeedsProfileState] = useState<GoogleProfileSeed | null>(null);

  const runBoot = useCallback(() => {
    const epoch = authEpoch.current;
    let cancelled = false;
    setBooting(true);
    setBootError(null);
    void (async () => {
      try {
        const restored = await restoreSession();
        if (!cancelled && epoch === authEpoch.current) {
          // W0-B (S2, additive): a loaded profile is complete by definition.
          setUserState(restored);
          setNeedsProfileState(null);
        }
      } catch (err) {
        if (cancelled || epoch !== authEpoch.current || err instanceof AuthAccountChangedError) return;
        // The initial snapshot's deferred profile load may have succeeded
        // while this overlapping boot request was still pending.
        if (sdkObserved.current && sdkAccount.current !== null && currentUser.current?.id === sdkAccount.current) return;
        if (err instanceof BootTimeoutError) {
          // Backend unreachable: keep the stored session and user data, offer
          // Retry. Never assume signed-out and never destroy the session here.
          setBootError("unreachable");
        } else {
          if (err instanceof ApiError && err.status === 401 && hadStoredSession.current && !intentionalSignOut.current.has(currentUser.current?.id ?? sdkAccount.current)) markSessionExpired();
          // W0-B (S2, additive): a valid session without a Norfold profile
          // (new Google account or interrupted completion) routes to
          // completion — the session is KEPT, clearAllAuth is NOT called.
          const seed = await getNeedsProfileSeed().catch(() => null);
          if (cancelled || epoch !== authEpoch.current) return;
          if (seed) {
            if (!sdkObserved.current || seed.accountId === sdkAccount.current) setNeedsProfileState(seed);
          } else if (!sdkObserved.current || sdkAccount.current === null) {
            // An empty startup session is normal while confirming a signup.
            // Keep its durable email; real sign-out/account replacement owns
            // invalidation below, not a failed session restore.
            if (hadStoredSession.current) {
              clearAllAuth();
              setPendingEmailState(null);
            } else {
              setToken(null);
            }
          } else {
            setBootError("unreachable");
          }
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Boot: restore a stored Supabase session.
  useEffect(() => { if (boot) runBoot(); }, [boot, runBoot]);

  // Keep the token cache and user state in sync with Supabase Auth.
  useEffect(() => {
    if (!boot) return;
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
        if (session && readRememberedAccounts().some(account => account.id === session.user.id)) {
          try {
            saveAccountSession({ accountId: session.user.id, access_token: session.access_token,
              refresh_token: session.refresh_token, expires_at: session.expires_at });
          } catch { /* A storage failure must not break SDK auth event delivery. */ }
        }
        const previousAccount = sdkAccount.current ?? currentUser.current?.id ?? null;
        if (event === "SIGNED_OUT" && (previousAccount !== null || hadStoredSession.current) && !intentionalSignOut.current.has(previousAccount)) markSessionExpired();
        if (session) clearSessionExpired();
        if (event === "SIGNED_OUT") hadStoredSession.current = false;
        const nextAccount = session?.user.id ?? null;
        const samePasswordAccount = nextAccount !== null && passwordGate.current.account === nextAccount;
        const knownPasswordPresence = samePasswordAccount && passwordPresenceRef.current !== "unknown";
        const nextSessionId=readAuthSessionId(session);
        // A same-account SIGNED_IN may replace the SDK session without SIGNED_OUT.
        // Fence old messaging/media/RTC work synchronously, before React effects
        // or deferred profile adoption. Ordinary token refresh keeps its ID.
        if (previousAccount===nextAccount && sdkSessionId.current!==null && sdkSessionId.current!==nextSessionId) {
          clearMessagingRuntime();
          void stopPushNotifications();
        }
        sdkSessionId.current=nextSessionId;
        const accountChanged = previousAccount !== null && previousAccount !== nextAccount;
        // The SDK's startup snapshot is part of the boot restore, not a new
        // auth attempt. Do not invalidate that restore for the same slot.
        const epoch = event === "INITIAL_SESSION" && !accountChanged
          ? authEpoch.current : ++authEpoch.current;
        sdkAccount.current = nextAccount;
        // The authoritative read runs outside this callback. A known answer
        // stays usable while it refreshes; a new/unknown account waits for it.
        if (nextAccount === null) resetPasswordPresence();
        else readPasswordPresence(nextAccount, !knownPasswordPresence);
        if (nextAccount !== null) lastAccount.current = nextAccount;
        sdkObserved.current = true;
        if (event === "SIGNED_OUT" || (accountChanged && nextAccount === null)) profileAdoptionBlocked.current = true;
        // SIGNED_IN can reconfirm the same session on tab refocus. Only a
        // changed SDK slot may reopen adoption after local sign-out.
        else if (previousAccount !== nextAccount) profileAdoptionBlocked.current = false;
        setToken(profileAdoptionBlocked.current ? null : session?.access_token ?? null);
        setAuthSessionId(profileAdoptionBlocked.current ? null : nextSessionId);
        if (event === "SIGNED_OUT" || accountChanged) {
          // SDK replacement need not emit SIGNED_OUT. Invalidate A's private
          // slices synchronously, before scheduling B's profile fetch. The
          // shared AI reset aborts A's flight but retains verified downloads.
          // Do not clearAllAuth here: the SDK slot/token already belongs to B.
          aiCredentials.clearSession();
          disconnectRealtime();
          clearUserScopedLocalState();
          setUserState(null);
          persistPendingEmail(null);
          setPendingEmailState(null);
          setNeedsProfileState(null);
          if (event === "SIGNED_OUT") return;
        }
        if (!profileAdoptionBlocked.current && nextAccount !== null && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED" || event === "INITIAL_SESSION")) {
          // Defer network work: awaiting Supabase inside this callback can deadlock.
          setTimeout(() => {
            void fetchMe(session?.user.id)
              .then((next) => {
                if (epoch === authEpoch.current) {
                  setUserState(next);
                  ++authEpoch.current; // This owned result supersedes overlapping boot work.
                  setNeedsProfileState(null);
                  setBootError(null);
                  setBooting(false);
                }
              })
              .catch(async () => {
                if (epoch !== authEpoch.current) return;
                const seed = await getNeedsProfileSeed(nextAccount).catch(() => null);
                if (seed && !profileAdoptionBlocked.current && epoch === authEpoch.current && seed.accountId === sdkAccount.current) {
                  ++authEpoch.current;
                  setNeedsProfileState(seed);
                  setBootError(null);
                  setBooting(false);
                }
              });
          }, 0);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      /* Supabase not configured; boot handling already cleared state */
    }
    return () => unsubscribe?.();
  }, [boot, resetPasswordPresence, readPasswordPresence]);

  // A failed mid-session refresh signs the user out in place.
  useEffect(
    () =>
      onSignedOut(() => {
        if (currentUser.current && !intentionalSignOut.current.has(currentUser.current.id)) markSessionExpired();
        ++authEpoch.current;
        profileAdoptionBlocked.current = true;
        aiCredentials.clearSession();
        disconnectRealtime();
        clearUserScopedLocalState();
        setUserState(null);
        setPendingEmailState(null);
        setNeedsProfileState(null); // W0-B (S2, additive): see SIGNED_OUT above.
        resetPasswordPresence();
      }),
    [resetPasswordPresence],
  );

  useEffect(() => {
    if (user) {
      connectRealtime();
      joinInboxRoom(user.id);
      void startPushNotifications({
        accountId: user.id,
        sessionId: authSessionId,
        prepare: async () => {
          if (!authSessionId) throw new Error("Session unavailable");
          await ensureMessagingDevice(user.id, authSessionId);
        },
        isCurrent: () => currentUser.current?.id === user.id &&
          (!sdkObserved.current || (sdkAccount.current === user.id && sdkSessionId.current === authSessionId)) && !profileAdoptionBlocked.current,
      });
    } else {
      leaveInboxRoom();
      disconnectRealtime();
      // Rehydration is not logout. Clearing cached native admission here would
      // discard a legitimate cold notification tap before its session loads.
      if (!booting) void stopPushNotifications();
    }
  }, [user, booting, authSessionId]);

  const setUser = useCallback((next: PublicUser) => setUserState(next), []);

  const refreshUser = useCallback(async () => {
    const epoch = authEpoch.current;
    const next = await fetchMe();
    if (epoch === authEpoch.current) setUserState(next);
  }, []);

  const currentAccountEmail = useCallback(async (accountId: string) => {
    const { data: { session } } = await getSupabase().auth.getSession();
    const email = session?.user.email?.trim().toLowerCase();
    if (!session || session.user.id !== accountId || !email) throw new AuthAccountChangedError();
    return email;
  }, []);

  const requestRequiredPasswordCode = useCallback(async () => {
    const account = passwordGate.current.account;
    if (!account || !passwordGate.current.required) throw new AuthAccountChangedError();
    const email = await currentAccountEmail(account);
    await sendAccountPasswordCode(account, email);
    if (passwordGate.current.account !== account) throw new AuthAccountChangedError();
  }, [currentAccountEmail]);

  const saveRequiredPassword = useCallback(async (password: string, code: string) => {
    const account = passwordGate.current.account;
    if (!account || !passwordGate.current.required) throw new AuthAccountChangedError();
    const email = await currentAccountEmail(account);
    await saveAccountPasswordWithCode({ accountId: account, email, password, code });
    if (passwordGate.current.account !== account || sdkAccount.current !== account) throw new AuthAccountChangedError();
    // The write succeeded; only the server's own record may declare success.
    let confirmed = false;
    try { confirmed = await readHasAccountPassword(); } catch { confirmed = false; }
    if (passwordGate.current.account !== account || sdkAccount.current !== account) throw new AuthAccountChangedError();
    if (confirmed) {
      passwordPresenceRef.current = "has";
      passwordGate.current = { account, required: false };
      setPasswordPresence("has");
      setPasswordPromptDismissed(false);
      setPasswordSetupSettled(true);
    }
    return { confirmed };
  }, [currentAccountEmail]);

  const confirmRequiredPassword = useCallback(async () => {
    const account = passwordGate.current.account ?? sdkAccount.current;
    if (!account) throw new AuthAccountChangedError();
    const confirmed = await readHasAccountPassword();
    if (passwordGate.current.account !== account || sdkAccount.current !== account) throw new AuthAccountChangedError();
    passwordPresenceRef.current = confirmed ? "has" : "missing";
    passwordGate.current = { account, required: !confirmed };
    setPasswordPresence(confirmed ? "has" : "missing");
    if (confirmed) setPasswordPromptDismissed(false);
    else setPasswordPromptDismissed(readPasswordPromptDismissed(account));
    setPasswordSetupSettled(true);
    return confirmed;
  }, []);

  const dismissPasswordSetup = useCallback(() => {
    const account = passwordGate.current.account ?? sdkAccount.current;
    if (!account) return;
    rememberPasswordPromptDismissed(account);
    setPasswordPromptDismissed(true);
  }, []);

  const refreshPasswordPresence = useCallback(async () => {
    const account = sdkAccount.current;
    if (!account) return false;
    const present = await readHasAccountPassword();
    if (sdkAccount.current !== account) return false;
    applyPasswordPresence(account, present ? "has" : "missing");
    return present;
  }, [applyPasswordPresence]);

  const login = useCallback(async (email: string, password: string) => {
    const epoch = authEpoch.current;
    let next: PublicUser;
    try {
      next = await apiLogin({ email, password });
    } catch (error) {
      // This code is returned only after password verification by Auth. Never
      // probe an address or send another email just to infer membership.
      if (error instanceof ApiError && error.code === "email_not_confirmed") {
        if (epoch !== authEpoch.current || sdkAccount.current !== null || currentUser.current !== null) throw new AuthAccountChangedError();
        persistPendingEmail(email.trim());
        setPendingEmailDeadline(readPendingDeadline(email.trim()));
        setPendingEmailState(email.trim());
      }
      throw error;
    }
    assertAccount(next.id);
    persistPendingEmail(null);
    setPendingEmailState(null);
    setNeedsProfileState(null); // W0-B (S2, additive): password login is a complete profile.
    setUserState(next);
    return next;
  }, []);

  const register = useCallback(
    async (input: { username: string; email: string; phone: string; password: string }) => {
      const epoch = authEpoch.current;
      const result = await apiRegister(input);
      if (result.emailVerificationRequired) {
        // A previous sign-out blocks profile adoption, not a new pending
        // signup. The epoch and current SDK slot still reject late A -> B work.
        if (epoch !== authEpoch.current || sdkAccount.current !== null || currentUser.current !== null) throw new AuthAccountChangedError();
        const email = result.email ?? input.email;
        persistPendingEmail(email);
        savePendingDeadline(email, Date.now() + 30_000);
        setPendingEmailState(email);
        return { status: "pending", email } as const;
      }
      assertAccount(result.user.id);
      setNeedsProfileState(null); // W0-B (S2, additive): registered profile is complete.
      setUserState(result.user);
      return { status: "authenticated", user: result.user } as const;
    },
    [savePendingDeadline],
  );

  const verifyPendingEmail = useCallback(
    async (code: string) => {
      if (!pendingEmail) throw new Error("No pending email verification");
      const next = await verifyPendingEmailCode(pendingEmail, code);
      assertAccount(next.id);
      persistPendingEmail(null);
      setPendingEmailState(null);
      setNeedsProfileState(null); // W0-B (S2, additive): verified profile is complete.
      setUserState(next);
      return next;
    },
    [pendingEmail],
  );

  const resendPendingEmail = useCallback(async () => {
    if (!pendingEmail) throw new Error("No pending email verification");
    try {
      await sendPendingEmailCode(pendingEmail);
      if (getPendingEmail() === pendingEmail) savePendingDeadline(pendingEmail, Date.now() + 30_000);
    } catch (error) {
      if (getPendingEmail() === pendingEmail && error instanceof ApiError && error.code === "EMAIL_SEND_LIMITED") {
        const retry = "retryAfterSeconds" in error && typeof error.retryAfterSeconds === "number" && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0 ? error.retryAfterSeconds : 60;
        savePendingDeadline(pendingEmail, Date.now() + retry * 1000);
      }
      throw error;
    }
  }, [pendingEmail, savePendingDeadline]);

  const deviceSignedOut = useCallback(() => currentUser.current === null && sdkAccount.current === null, []);

  const cleanAccountOnDevice = useCallback(async (accountId: string | null, localOnly = false) => {
    intentionalSignOut.current.set(accountId, (intentionalSignOut.current.get(accountId) ?? 0) + 1);
    try {
    // Account A -> B switch starts here: drop this session's token cache and
    // pending email and notify signed-out handlers BEFORE the sign-out call,
    // so no A-owned slice can leak into the next account's calls.
    const switched = () => (sdkAccount.current !== null && sdkAccount.current !== accountId)
      || (currentUser.current !== null && currentUser.current.id !== accountId)
      || (lastAccount.current !== null && lastAccount.current !== accountId);
    if (mounted.current && !switched()) {
      hadStoredSession.current = false;
      clearSessionExpired();
      beginAccountSwitch();
    }
    // Capture the account before clearing state: signing out wipes that
    // account's AI provider credentials (session + persisted/remembered keys)
    // from this device by default. This runs BEFORE any switch check, so a
    // switch cannot abandon A's keys — and a purge failure is never swallowed.
    let keysFailed = false;
    let sessionFailed = false;
    if (accountId) {
      try {
        await aiCredentials.removeAccountCredentials(accountId);
      } catch {
        keysFailed = true;
      }
    }
    if (mounted.current && !switched()) {
      try { await stopPushNotifications(); } catch { /* Push teardown cannot block auth cleanup. */ }
    }
    // A switch must never clear or sign out the account that replaced A, but a
    // real cleanup failure for A still has to surface so it can be retried.
    if (!mounted.current) throw new Error("Stored sign-in cleanup was interrupted. Retry cleanup on this device.");
    if (switched()) {
      if (keysFailed) throw new Error("Stored AI keys could not be removed. Retry cleanup on this device.");
      return;
    }
    try {
      if (localOnly && accountId) await detachSupabaseAccount(accountId);
      else await apiLogout(accountId ?? undefined);
    }
    catch (error) {
      // The persistence boundary refused because A's slot now holds B: A's
      // session is already gone, so nothing to clean, but keys still surface.
      if (error instanceof AuthAccountChangedError) {
        if (keysFailed) throw new Error("Stored AI keys could not be removed. Retry cleanup on this device.");
        return;
      }
      sessionFailed = true;
    }
    if (!mounted.current) throw new Error("Stored sign-in cleanup was interrupted. Retry cleanup on this device.");
    if (switched()) {
      if (keysFailed || sessionFailed) throw new Error("Stored sign-in or AI keys could not be removed. Retry cleanup on this device.");
      return;
    }
    clearAllAuth();
    if (localOnly) {
      sdkAccount.current = null;
      sdkSessionId.current = null;
    }
    aiCredentials.clearSession();
    setPendingEmailState(null);
    setNeedsProfileState(null); // W0-B (S2, additive): completion cannot outlive the session.
    disconnectRealtime();
    clearUserScopedLocalState();
    setUserState(null);
    if (keysFailed || sessionFailed) throw new Error("Stored sign-in or AI keys could not be removed. Retry cleanup on this device.");
    } finally {
      const remaining = (intentionalSignOut.current.get(accountId) ?? 1) - 1;
      if (remaining > 0) intentionalSignOut.current.set(accountId, remaining);
      else intentionalSignOut.current.delete(accountId);
    }
  }, [setUserState]);

  const logout = useCallback(async (options?: { keepAccount?: boolean }) => {
    const account = currentUser.current;
    const accountId = account?.id ?? sdkAccount.current;
    if (accountId) {
      if (options?.keepAccount) {
        const { data, error } = await getSupabase().auth.getSession();
        if (error || data.session?.user.id !== accountId) throw new Error("Could not save this sign-in.");
        saveAccountSession({ accountId, access_token: data.session.access_token,
          refresh_token: data.session.refresh_token, expires_at: data.session.expires_at });
      } else {
        removeAccountSession(accountId);
      }
      const updated = options?.keepAccount && account && !unadmittedDeletions.current.has(accountId)
        ? rememberAccount(account) : removeRememberedAccount(accountId);
      if (!updated) throw new Error("Couldn't update saved accounts on this device. Try again.");
    }
    await cleanAccountOnDevice(accountId, !!options?.keepAccount);
  }, [cleanAccountOnDevice]);

  const setAccountKept = useCallback(async (id: string, keep: boolean) => {
    if (!keep) {
      removeAccountSession(id);
      if (!removeRememberedAccount(id)) throw new Error("Couldn't update saved accounts on this device.");
      return;
    }
    const account = currentUser.current;
    if (!account || account.id !== id) throw new Error("Only the current account can be saved.");
    const { data, error } = await getSupabase().auth.getSession();
    if (error || data.session?.user.id !== id) throw new Error("Could not save this sign-in.");
    saveAccountSession({ accountId: id, access_token: data.session.access_token,
      refresh_token: data.session.refresh_token, expires_at: data.session.expires_at });
    if (!rememberAccount(account)) {
      removeAccountSession(id);
      throw new Error("Couldn't update saved accounts on this device.");
    }
  }, []);

  const switchAccount = useCallback(async (target: RememberedAccount): Promise<SwitchAccountResult> => {
    const current = currentUser.current;
    if (!current) throw new Error("Current account is unavailable.");
    const sdk = getSupabase();
    const { data, error } = await sdk.auth.getSession();
    if (error || data.session?.user.id !== current.id) throw new Error("Could not save this sign-in.");
    saveAccountSession({ accountId: current.id, access_token: data.session.access_token,
      refresh_token: data.session.refresh_token, expires_at: data.session.expires_at });
    if (!rememberAccount(current)) throw new Error("Couldn't update saved accounts on this device.");
    const saved = readAccountSession(target.id);
    if (!saved) {
      await cleanAccountOnDevice(current.id, true);
      return { status: "needs-sign-in" };
    }
    await aiCredentials.removeAccountCredentials(current.id);
    await stopPushNotifications();
    const detachFailedSwitch = async () => {
      const active = await sdk.auth.getSession();
      const owner = active.data.session?.user.id;
      if (owner && owner !== current.id && owner !== target.id) throw new AuthAccountChangedError();
      if (owner) await detachSupabaseAccount(owner);
      sdkAccount.current = null;
      beginAccountSwitch();
    };
    intentionalSignOut.current.set(current.id, (intentionalSignOut.current.get(current.id) ?? 0) + 1);
    try {
      beginAccountSwitch();
      aiCredentials.clearSession();
      disconnectRealtime();
      clearUserScopedLocalState();
      setUserState(null);
      setNeedsProfileState(null);
      const result = await sdk.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token });
      if (result.error || result.data.session?.user.id !== target.id) {
        removeAccountSession(target.id);
        await detachFailedSwitch();
        return { status: "needs-sign-in" };
      }
      const next = await fetchMe(target.id);
      if (next.id !== target.id || sdkAccount.current !== target.id) throw new Error("Account changed during sign-in.");
      const latest = await sdk.auth.getSession();
      if (latest.error || latest.data.session?.user.id !== target.id) throw new Error("Account changed during sign-in.");
      saveAccountSession({ accountId: target.id, access_token: latest.data.session.access_token,
        refresh_token: latest.data.session.refresh_token, expires_at: latest.data.session.expires_at });
      setUserState(next);
      return { status: "switched" };
    } catch {
      removeAccountSession(target.id);
      await detachFailedSwitch();
      return { status: "needs-sign-in" };
    } finally {
      const count = (intentionalSignOut.current.get(current.id) ?? 1) - 1;
      if (count) intentionalSignOut.current.set(current.id, count);
      else intentionalSignOut.current.delete(current.id);
    }
  }, [cleanAccountOnDevice]);

  const publishDeletion = useCallback((ticket: number, accountId: string, state: "cleaning" | "complete" | "cleanup-failed") => {
    if (!mounted.current || ticket !== deletionPresentation.current) return;
    // Never display A's deletion outcome over B, including while B's profile
    // is still loading. Cleanup authority is independent of this presentation.
    const foreign = (currentUser.current !== null && currentUser.current.id !== accountId)
      || (sdkAccount.current !== null && sdkAccount.current !== accountId);
    setDeletionCompletion(foreign || (state === "complete" && !deviceSignedOut()) ? null : { accountId, state });
  }, [deviceSignedOut]);

  const performDeletionCleanup = useCallback(async (entry: PendingAccountDeletion) => {
    const failures: unknown[] = [];
    const identityRemoved = removeRememberedAccount(entry.accountId);
    let authPending = entry.authPending, authRevision = entry.authRevision;
    if (!identityRemoved) {
      failures.push(new Error("Saved account could not be removed."));
      // Recovery of an older media-only entry must also retain durable auth
      // authority before its last independent media acknowledgment is allowed.
      if (!authPending) { authRevision = await beginConfirmedAccountDeletion(entry.accountId); authPending = true; }
    }
    // Start captured-account media cleanup even if key/session work fails. Its
    // rejection is handled immediately, not left unhandled during a slow vault.
    const messaging = entry.messagingPending
      ? purgeMessagingAccount(entry.accountId).catch((error: unknown) => { failures.push(error); })
      : Promise.resolve();
    if (authPending) {
      try {
        await cleanAccountOnDevice(entry.accountId);
        // Metadata is part of account cleanup. Never lose its restart/retry
        // discovery merely because SDK/key/media cleanup already succeeded.
        if (identityRemoved) await finishAccountAuthCleanup(entry.accountId, authRevision);
      } catch (error) { failures.push(error); }
    }
    await messaging;
    if (failures.length) throw new AggregateError(failures, "Stored sign-in, AI keys or chat history could not be cleared. Retry cleanup on this device.");
  }, [cleanAccountOnDevice]);

  const admitDeletion = useCallback(async (accountId: string) => {
    const revision = await beginConfirmedAccountDeletion(accountId);
    unadmittedDeletions.current.delete(accountId);
    // The old scalar is only a migration/recovery hint, never our durability
    // proof. Remove it only AFTER strict admission, and never remove B's hint.
    try { if (storage.getItem(DELETION_CLEANUP_KEY) === accountId) storage.removeItem(DELETION_CLEANUP_KEY); }
    catch { /* A retained legacy hint may cause an idempotent retry, not data loss. */ }
    return revision;
  }, []);

  const finishAccountDeletion = useCallback(async (accountId: string) => {
    // Trusted confirmed-A seam. The screen calls this only after the server
    // verifies A's deletion; being signed in as B cannot abandon captured A.
    const ticket = ++deletionPresentation.current;
    removeRememberedAccount(accountId);
    unadmittedDeletions.current.add(accountId);
    publishDeletion(ticket, accountId, "cleaning");
    try {
      const authRevision = await admitDeletion(accountId);
      await serializeDeletion(() => performDeletionCleanup({ accountId, authRevision, authPending: true, messagingPending: true }));
      publishDeletion(ticket, accountId, "complete");
    } catch (error) {
      // Best-effort hint if durable admission itself failed. A successful
      // localStorage/memory write is NOT certified crash-durable admission.
      if (unadmittedDeletions.current.has(accountId)) {
        try { if (storage.getItem(DELETION_CLEANUP_KEY) === null) storage.setItem(DELETION_CLEANUP_KEY, accountId); } catch { /* volatile retry remains */ }
      }
      publishDeletion(ticket, accountId, "cleanup-failed");
      throw error;
    }
  }, [admitDeletion, serializeDeletion, performDeletionCleanup, publishDeletion]);

  const retryDeletionCleanup = useCallback(async () => {
    const ticket = ++deletionPresentation.current;
    await serializeDeletion(async () => {
      let inventoryFailed = false;
      let failedAccount: string | undefined;
      let completedAccount: string | undefined;
      try {
        const legacy = storage.getItem(DELETION_CLEANUP_KEY);
        if (legacy) unadmittedDeletions.current.add(legacy);
      } catch { inventoryFailed = true; }
      for (const accountId of [...unadmittedDeletions.current]) {
        try { await admitDeletion(accountId); }
        catch { failedAccount ??= accountId; }
      }
      try {
        const inventory = await inspectPendingAccountDeletions();
        inventoryFailed ||= inventory.failures.length > 0;
        for (const entry of inventory.pending) {
          publishDeletion(ticket, entry.accountId, "cleaning");
          try { await performDeletionCleanup(entry); completedAccount = entry.accountId; }
          catch { failedAccount ??= entry.accountId; }
        }
      } catch { inventoryFailed = true; }
      if (mounted.current && ticket === deletionPresentation.current) setDeletionRecoveryError(inventoryFailed);
      if (failedAccount) publishDeletion(ticket, failedAccount, "cleanup-failed");
      else if (completedAccount && !inventoryFailed) publishDeletion(ticket, completedAccount, "complete");
    });
  }, [admitDeletion, serializeDeletion, performDeletionCleanup, publishDeletion]);

  // Boot discovery/retry is not dependent on a scalar marker or visible UI.
  // Wait for canonical auth restore so foreign-session guards have its result.
  useEffect(() => {
    if (!booting && !bootError) void retryDeletionCleanup();
  }, [booting, bootError, retryDeletionCleanup]);

  const dismissDeletionCompletion = useCallback(() => {
    ++deletionPresentation.current;
    setDeletionCompletion(null);
  }, []);

  // Coordinator integration (S1 landed): full Google flow — S1 bridge token
  // → S2 seam → auth state. Static S1 import with the typed kind taxonomy;
  // cancel is detected via `kind`, never message matching.
  const clearNeedsProfile = useCallback(() => setNeedsProfileState(null), []);

  /**
   * X1: adopt an outcome already resolved by the external callback bridge (web
   * Google OAuth). Mirrors the native path: authenticated → user; needsProfile
   * → keep the session and surface the completion seed.
   */
  const adoptExternalAuthOutcome = useCallback((outcome: GoogleSignInOutcome) => {
    if (outcome.status === "authenticated") {
      assertAccount(outcome.user.id);
      setNeedsProfileState(null);
      setUserState(outcome.user);
      return;
    }
    assertAccount(outcome.seed.accountId);
    setNeedsProfileState(outcome.seed);
  }, []);

  const signInWithGoogle = useCallback(async (mode: "signin" | "signup") => {
    let idToken = "";
    let nonce = "";
    try {
      const result = await startNativeGoogleSignIn({ mode });
      idToken = typeof result?.idToken === "string" ? result.idToken : "";
      nonce = typeof result?.nonce === "string" ? result.nonce : "";
    } catch (err) {
      // S1 GoogleAuthError messages are already human (contract) — rethrow
      // verbatim so the taxonomy survives to the UI.
      if (err instanceof GoogleAuthError && err.kind === "cancelled") {
        // Seam: result code only (mode), never tokens/profiles.
        recordOperation({ name: "auth.google.cancelled", fields: { mode } });
        throw new Error("Google sign-in was cancelled.");
      }
      // Seam: stable kind token only.
      recordOperation({
        name: "auth.google.error",
        fields: {
          mode,
          code: err instanceof GoogleAuthError ? err.kind : "unknown",
        },
      });
      if (err instanceof Error) throw err;
      throw new Error("Google sign-in failed. Please try again.");
    }
    if (!idToken) {
      // Seam: result code only.
      recordOperation({ name: "auth.google.error", fields: { mode, code: "no_token" } });
      throw new Error("Google sign-in did not return a token. Please try again.");
    }
    // W0-D: forward the S1 raw nonce for the Supabase server-side nonce
    // check (skip-nonce-check stays OFF). Missing nonce fails closed in S2.
    let outcome: Awaited<ReturnType<typeof signInWithGoogleIdToken>>;
    try {
      outcome = await signInWithGoogleIdToken(idToken, nonce);
    } catch (err) {
      // Seam: result code only.
      recordOperation({ name: "auth.google.error", fields: { mode, code: "exchange_failed" } });
      throw err;
    }
    // Seam: result code only (mode), never tokens/profiles.
    recordOperation({ name: "auth.google.success", fields: { mode } });
    if (outcome.status === "authenticated") {
      assertAccount(outcome.user.id);
      setNeedsProfileState(null);
      setUserState(outcome.user);
      return outcome.user;
    }
    assertAccount(outcome.seed.accountId);
    setNeedsProfileState(outcome.seed);
    return null;
  }, []);

  const value = useMemo(
    () => ({
      user,
      hasPassword,
      needsPasswordSetup,
      passwordSetupSettled,
      requestRequiredPasswordCode,
      saveRequiredPassword,
      confirmRequiredPassword,
      dismissPasswordSetup,
      refreshPasswordPresence,
      authSessionId,
      booting,
      bootError,
      retryBoot: runBoot,
      pendingEmail,
      pendingEmailDeadline,
      login,
      register,
      verifyPendingEmail,
      resendPendingEmail,
      logout,
      switchAccount,
      setAccountKept,
      deletionCompletion,
      deletionRecoveryError,
      finishAccountDeletion,
      retryDeletionCleanup,
      dismissDeletionCompletion,
      refreshUser,
      setUser,
      signInWithGoogle,
      needsProfile,
      clearNeedsProfile,
      adoptExternalAuthOutcome,
    }),
    [
      user,
      hasPassword,
      needsPasswordSetup,
      passwordSetupSettled,
      requestRequiredPasswordCode,
      saveRequiredPassword,
      confirmRequiredPassword,
      dismissPasswordSetup,
      refreshPasswordPresence,
      authSessionId,
      booting,
      bootError,
      runBoot,
      pendingEmail,
      pendingEmailDeadline,
      login,
      register,
      verifyPendingEmail,
      resendPendingEmail,
      logout,
      switchAccount,
      setAccountKept,
      deletionCompletion,
      deletionRecoveryError,
      finishAccountDeletion,
      retryDeletionCleanup,
      dismissDeletionCompletion,
      refreshUser,
      setUser,
      signInWithGoogle,
      needsProfile,
      clearNeedsProfile,
      adoptExternalAuthOutcome,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
