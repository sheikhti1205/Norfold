import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { SearchedProfile } from "@norfold/shared";
import { UsersRound } from "lucide-react";
import { useAuth } from "../auth";
import { fetchAccountIdentities } from "../services/accountLabels";
import { useMessaging } from "../services/messaging/useMessaging";
import type { ConversationProjection } from "../services/messaging/conversationIndex";
import { normalizePeopleQuery, searchPeople, type PeopleSearchCursor, type PeopleSearchPage } from "../services/people";
import { fetchFeed } from "../services/posts";
import { EmptyState } from "./PostCard";
import { UserAvatar } from "./UserAvatar";
import { ProfilePreview } from "./ProfilePreview";

/** Enough to prove the place is populated without becoming a directory dump. */
const SUGGESTION_LIMIT = 12;

/**
 * One short-lived query per account, with no cross-account result cache.
 *
 * An empty query is not "no results": it is the People page's default state.
 * The reader is shown people the app can already see — chat peers and report
 * authors — because public profile enumeration is deliberately not available
 * to an empty search.
 */
export function PeopleSearch({ query }: { query: string }) {
  const { user } = useAuth();
  const normalized = normalizePeopleQuery(query);
  if (!user) return null;
  return normalized
    ? <PeopleQuery key={JSON.stringify([user.id, normalized])} accountId={user.id} query={normalized} />
    : <SuggestedPeople key={`suggested-${user.id}`} accountId={user.id} />;
}

function normalizePerson(person: {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl: string | null;
}): SearchedProfile {
  return {
    id: person.id,
    username: person.username,
    displayName: person.displayName?.trim() || null,
    avatarUrl: person.avatarUrl,
  };
}

/** Viewer-authorized relationship state; never the counterpart's decisions. */
function relationshipFor(view: ConversationProjection | undefined): string | null {
  if (!view) return null;
  if (view.ownBlocked) return "Blocked by you";
  if (view.mode === "CONNECTED") return "Friends";
  if (view.request === "INCOMING") return "Message request";
  if (view.request === "OUTGOING") return "Request sent";
  return null;
}

function PersonRow({ person, relationship }: { person: SearchedProfile; relationship: string | null }) {
  const name = person.displayName?.trim() || person.username;
  return (
    <li>
      {/* The row stays the destination under the pointer; on a phone the same
          tap opens the one person card, whose explicit action reaches the
          profile. */}
      <ProfilePreview person={person} className="w-full" openOnFocus={false}>
        <Link
          to={`/u/${encodeURIComponent(person.username)}`}
          className="flex min-h-[56px] w-full min-w-0 flex-1 items-center gap-3 rounded-m3-sm px-1 py-3 hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <UserAvatar username={name} avatarUrl={person.avatarUrl} size={36} />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="block font-semibold">{name}</span>{" "}
            <span className="block text-sm text-on-surface-variant">@{person.username}</span>
            {relationship && <span className="block text-xs text-on-surface-variant">{relationship}</span>}
          </span>
        </Link>
      </ProfilePreview>
    </li>
  );
}

function PeopleQuery({ query, accountId }: { query: string; accountId: string }) {
  const chat = useMessaging();
  const projections = chat.accountId === accountId ? Object.values(chat.currentProjections ?? {}) : [];
  const [page, setPage] = useState<PeopleSearchPage>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const load = useCallback(async (cursor: PeopleSearchCursor | null) => {
    const owner = controller.current;
    if (!owner || owner.signal.aborted || pending.current) return;
    pending.current = true; setBusy(true); setFailed(false);
    try {
      const next = await searchPeople(query, { cursor, signal: owner.signal });
      if (owner.signal.aborted || controller.current !== owner) return;
      setPage(previous => ({ items: [...new Map((cursor ? [...previous.items, ...next.items] : next.items).map(person => [person.id, person])).values()], nextCursor: next.nextCursor }));
      setLoaded(true);
    } catch {
      if (!owner.signal.aborted && controller.current === owner) setFailed(true);
    } finally {
      if (!owner.signal.aborted && controller.current === owner) { pending.current = false; setBusy(false); }
    }
  }, [query]);
  useEffect(() => {
    const owner = new AbortController(); controller.current = owner; pending.current = false;
    const timer = query && query.length <= 80 ? setTimeout(() => { void load(null); }, 250) : null;
    return () => { if (timer !== null) clearTimeout(timer); owner.abort(); };
  }, [query, load]);

  if (query.length > 80) return <p role="status" className="px-4 py-6 text-sm text-on-surface-variant">Try a shorter name or username.</p>;
  return <section aria-label="People results" className="min-w-0 px-3 pb-4">
    <p role="status" className="py-3 text-sm text-on-surface-variant">
      {busy || (!loaded && !failed) ? "Searching people…" : loaded && !page.items.length ? "No people found." : `${page.items.length} ${page.items.length === 1 ? "person" : "people"} shown`}
    </p>
    <ul className="divide-y divide-outline-variant">
      {page.items.map(person => {
        const view = projections.find(projection => projection.peerId === person.id);
        return <PersonRow key={person.id} person={person} relationship={relationshipFor(view)} />;
      })}
    </ul>
    {failed && <div className="py-3"><p role="alert" className="mb-2 text-sm text-error">Couldn't search people. Check your connection and try again.</p>
      <button type="button" className="fb-surface-button" onClick={() => { void load(page.nextCursor); }}>Try again</button></div>}
    {!failed && page.nextCursor && <button type="button" className="fb-surface-button mt-3" disabled={busy} onClick={() => { void load(page.nextCursor); }}>Load more people</button>}
  </section>;
}

/**
 * Default People state: people the viewer can already see.
 *
 * Two honest sources, because no public profile listing exists:
 *   * chat peers — the viewer already sees these identities in Chats;
 *   * authors of the loaded report feed — public authors of visible reports.
 * Both are deduplicated, the viewer is never suggested to themselves, and a
 * blocked author is not resurfaced. When both are empty, the state says so
 * instead of pretending the place is empty.
 */
function SuggestedPeople({ accountId }: { accountId: string }) {
  const chat = useMessaging();
  // Two chat sources, because a cold People page must not claim the place is
  // empty while the messaging runtime is still opening:
  //   * local conversation summaries (already on this device) name the peers;
  //   * the live projection set wins once it arrives and carries the current
  //     relationship state.
  // A viewer-blocked peer is removed by the live projection, never added back.
  const peers = useMemo(() => {
    const map = new Map<string, ConversationProjection | null>();
    if (chat.accountId === accountId) {
      for (const summary of chat.conversations) {
        if (!summary.peerId || summary.peerId === accountId) continue;
        if (summary.cachedProjection?.ownBlocked) continue;
        map.set(summary.peerId, summary.cachedProjection ?? null);
      }
      for (const view of Object.values(chat.currentProjections ?? {})) {
        if (view.peerId === accountId) continue;
        if (view.ownBlocked) { map.delete(view.peerId); continue; }
        map.set(view.peerId, view);
      }
    }
    return map;
  }, [chat.accountId, chat.conversations, chat.currentProjections, accountId]);
  const projectionById = useMemo(
    () => new Map([...peers].flatMap(([id, view]) => view ? [[id, view] as const] : [])),
    [peers],
  );
  const peerKey = useMemo(() => [...peers.keys()].sort().join(","), [peers]);

  const [peerPeople, setPeerPeople] = useState<SearchedProfile[]>([]);
  const [reportPeople, setReportPeople] = useState<SearchedProfile[]>([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [reportsFailed, setReportsFailed] = useState(false);
  const [peerLoaded, setPeerLoaded] = useState(peerKey === "");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReportsLoaded(false);
    setReportsFailed(false);
    void fetchFeed({}).then(page => {
      if (cancelled) return;
      const seen = new Set<string>();
      const people: SearchedProfile[] = [];
      for (const item of page.items) {
        const author = item.author;
        if (item.blockedAuthor || !author || author.id === accountId || !author.username || seen.has(author.id)) continue;
        seen.add(author.id);
        people.push(normalizePerson(author));
      }
      setReportPeople(people);
    }).catch(() => {
      if (!cancelled) setReportsFailed(true);
    }).finally(() => {
      if (!cancelled) setReportsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [accountId, attempt]);

  useEffect(() => {
    const ids = peerKey ? peerKey.split(",") : [];
    if (ids.length === 0) {
      setPeerPeople([]);
      setPeerLoaded(true);
      return;
    }
    let cancelled = false;
    setPeerLoaded(false);
    void fetchAccountIdentities(accountId, ids).then(identities => {
      if (cancelled) return;
      setPeerPeople(ids.flatMap(id => {
        const person = identities.get(id);
        return person && person.username ? [normalizePerson(person)] : [];
      }));
    }).catch(() => {
      // A chat identity miss must not hide the report authors that did load.
    }).finally(() => {
      if (!cancelled) setPeerLoaded(true);
    });
    return () => { cancelled = true; };
  }, [accountId, peerKey, attempt]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const next: Array<{ person: SearchedProfile; relationship: string | null }> = [];
    for (const person of peerPeople) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      next.push({ person, relationship: relationshipFor(projectionById.get(person.id)) });
    }
    for (const person of reportPeople) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      next.push({ person, relationship: relationshipFor(projectionById.get(person.id)) });
    }
    return next.slice(0, SUGGESTION_LIMIT);
  }, [peerPeople, reportPeople, projectionById]);

  // A cold People page opens before the chat runtime has read its local
  // index. Until it does, "no one to suggest" is a claim about an empty list
  // the page has not actually read — so the honest state is still loading.
  const chatPending = chat.accountId === accountId && chat.status === "opening";
  const loading = !reportsLoaded || !peerLoaded || chatPending;
  return <section aria-label="Suggested people" className="min-w-0 pb-6">
    <div className="flex items-baseline justify-between gap-3 px-1 pt-4">
      <h2 className="text-base font-semibold text-on-surface">Suggested people</h2>
      {loading && rows.length === 0 && <span role="status" className="text-xs text-on-surface-variant">Finding people…</span>}
    </div>
    <p className="px-1 pt-0.5 pb-1 text-sm text-on-surface-variant">People from your chats and recent reports.</p>
    {rows.length > 0 ? (
      <ul className="divide-y divide-outline-variant">
        {rows.map(row => <PersonRow key={row.person.id} person={row.person} relationship={row.relationship} />)}
      </ul>
    ) : loading ? null : reportsFailed ? (
      <div className="flex flex-col items-start gap-2 px-1 py-4">
        <p role="alert" className="text-sm text-error">Couldn't load suggestions.</p>
        <button type="button" className="fb-surface-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
      </div>
    ) : (
      <EmptyState
        icon={<UsersRound size={20} aria-hidden />}
        title="No one to suggest yet"
        subtitle="People appear here when they share reports or message you. You can still search by name or @username."
      />
    )}
  </section>;
}
