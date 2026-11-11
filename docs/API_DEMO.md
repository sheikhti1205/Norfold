# API demonstration — REST, GraphQL, reporting

Norfold's runtime API is the hosted Supabase project. PostgREST serves the REST
(Data API) endpoints and `pg_graphql` serves GraphQL, resolving requests as the
JWT role so database grants and Row Level Security (RLS) apply. The legacy
Express and GraphQL-Yoga server has been removed from the repository.

Base URL: `https://<project-ref>.supabase.co` (set `SUPABASE_URL` for these
examples). Client examples use a publishable key and, where needed, a user
access token. Never put a secret/service key in a client. The reporting example
requires a secret key and must only be run in a trusted environment.

The examples illustrate request and response shapes; their current hosted
behavior has not been verified for this revision. Results depend on deployed
migrations, grants, policies and data.

## REST (PostgREST / Data API)

### 1. Username availability — anonymous boolean RPC

The registration check calls `is_username_available` before authentication. It
normalizes the username and receives a boolean rather than a user row.

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/is_username_available" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_username":"example_user"}'
# Response shape: true or false
```

`apps/mobile/src/services/auth.ts` contains a username-only table lookup fallback
for a backend where that RPC is missing. The privacy convergence migration intends
anonymous callers to use the RPC instead of reading `users` directly.

### 2. Feed — authenticated, client-safe RPC

The app's post service reads the feed using `findback_query_posts_client`.

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/findback_query_posts_client" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"p_limit":10,"p_q":"calculator"}'
```

The RPC returns post data and public author information. Its response is distinct
from direct table access, whose permitted columns and rows depend on grants and
RLS.

### 3. Post table — authenticated read

```bash
curl "$SUPABASE_URL/rest/v1/item_posts?select=id,title,status&limit=10" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer <access_token>"
```

The result is subject to the caller's table privileges and RLS policies.

## GraphQL (`/graphql/v1`, pg_graphql)

`supabase/migrations/20260914230000_enable_pg_graphql.sql` creates the
`pg_graphql` extension. GraphQL exposes a query-oriented alternative to REST:
types and fields depend on the request role's grants, and rows on RLS. The
migration records the intended configuration, not proof of the current hosted
extension or schema state.

```bash
curl -X POST "$SUPABASE_URL/graphql/v1" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ item_postsCollection(first: 1) { edges { node { id title status } } } }"}'
```

```graphql
# Example public-profile field selection
{
  usersCollection(first: 1) {
    edges { node { username } }
  }
}
```

The available fields and any errors depend on the deployed schema and the
caller's privileges; they have not been checked live for this revision.

## Reporting (request #20)

The activity bundle is a JSONB RPC, `public.findback_report(p_days,
p_top_limit)`, returning summary, byDay, byType, byStatus, byCategory and
topContributors data. Its migration grants execution only to `service_role`,
not `anon` or `authenticated`. The RPC can be called through PostgREST from a
trusted administrative environment as shown below; no current application
consumer was found in the repository. The licensed Crystal `.rpt` design file
remains `DEFERRED_EXTERNAL_TOOL`.

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/findback_report" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" -d '{"p_days":7,"p_top_limit":5}'
```

## AI Help

`askAiHelp` is unused legacy code with no production caller. The live Chat
screen, `apps/mobile/src/screens/Help.tsx`, uses `ChatController` instead.

`askAiHelp` in `apps/mobile/src/services/auth.ts` builds a prompt using the
app-controlled policy and knowledge in `apps/mobile/src/services/ai/appKnowledge.ts`
and calls the OpenRouter client with the connected key. It screens the returned
answer and returns `source: "llm"` when accepted. On a provider error it uses a
built-in answer; an unsafe answer is replaced with a fallback response. These
return `source: "fallback"`. Empty questions and questions over 500 characters
are rejected, and cancellation is propagated. There is no `ai-help` Edge
Function in the repository.

## RLS behaviour summary

The migration-defined intent below is not a live deployment audit. Actual
access depends on deployed grants, policies and any privileged function used.

| Caller | Feed | `users` | `findback_report` |
| --- | --- | --- | --- |
| `anon` | Client feed RPC not granted | Availability boolean RPC | Execution not granted |
| `authenticated` | Client feed RPC granted; RLS applies | Granted public-profile columns | Execution not granted |
| `service_role` | Privileged access | Privileged access | Execution granted |

Authenticated access to social data must not be described as aggregate-only:
`supabase/migrations/20261015174749_client_read_grants_invoker_paths.sql` grants
`SELECT` on `reactions.user_id` to `authenticated`.

Verified against this revision: `8cf29fe9a7e2a2b926ebfffcdd65a1db36613a5d` (2026-11-11); repository inspection only, not a live API run.
