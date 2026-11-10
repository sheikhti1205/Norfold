# Public landing review

Research brief, 11 November 2026. This is a recommendation, not an implementation.

## 1. Verdict

**Change the public explanation, not the entry architecture.**
The current screen is largely sound: it is honest about beta and safety, and it
does not fabricate a feed. Two things deserve focused improvement:

1. The four-scene introduction and six chapters repeat the same journey.
2. “Get started” hides the immediate account choice before reporting or search.

Bring practical safety advice closer to the first decision without promising who
will see a report. Keep returning-user and pending-link routing exactly as it works.
This is an information and copy refinement, not a visual-system replacement.

## 2. What the current screen actually does

**Observed in source:**

- `apps/mobile/src/App.tsx:87-92`: booting or a boot error without a user shows
  `Splash`; a user reaches `Shell`; an incomplete profile goes to
  `/complete-profile`.
- `App.tsx:93-99`: normally a pending protected destination routes a signed-out
  visitor to `/auth`. Explicit `showPublic` is an exception: it allows the public
  page first without consuming that destination. Preserve both behaviors.
- `apps/mobile/src/screens/RememberedAccounts.tsx:9-14,19-34`: after guard
  resolution, remembered accounts normally show the account chooser; explicit
  `showPublic`, or no opened chooser, shows `PublicWelcome`.
- `RememberedAccounts.tsx:34-55`: the chooser offers a remembered sign-in,
  removal, and another account. It is not an advertisement interstitial.
- `App.tsx:169-172,216-225`: shared reports and legal documents have separate
  public routes; `/search` and `/report` are inside `RequireAuth`.
- `apps/mobile/src/screens/PublicWelcome.tsx:10-17,54-82`: the page has
  public navigation, sign-in, a four-scene hero and six explanatory chapters.
- `PublicWelcome.tsx:41-46,74-76`: the main action completes onboarding and
  navigates to `/auth`; the label does not say that.
- `PublicWelcome.tsx:83-104`: safety, beta limitations, final action, legal
  links and a conditional sticky action follow. The sticky action depends on
  hero and final-section intersection (`PublicWelcome.tsx:25-39`).
- No public feed is rendered by this component. Do not replace that honesty
  with empty placeholders masquerading as activity or invented listings.
- `apps/mobile/src/screens/Onboarding.tsx:17-37`: the scenes cover lost,
  found, searching and control. `Onboarding.tsx:112-157` supplies paging,
  progress, keyboard handling and completion, including another “Get started”.
- `docs/DESIGN_SYSTEM.md:8-19,23-29` calls for compact chrome, large-text
  reflow and shared appearance tokens. Its onboarding description at lines
  81-87 predates the public-page implementation: use current source for routing.

## 3. Gap analysis

**Asserted: these are interpretation and design judgments, not measured user
failures.** No user study or rendered test was conducted for this brief.

### The single job arrives in pieces

The opening “Lost something?” is useful, but the found, search and control
scenes must be paged through, and all are explained again below. A visitor
should understand in one glance that this is for reporting a lost or found item
and looking for a possible match. Do not turn the top of `/` into a campaign.

### An account is a surprise

“Get started” leads to `/auth`, not directly to a report or search. A stranger
cannot infer whether an account is needed before clicking. Name the actual
next step and state that sign-in or account creation comes before those tasks.
Do not label a button “Report an item” if it actually opens the auth gateway
without making that intervening step clear.

### Trust needs specific, bounded answers

Current safety copy gives useful advice about public meetings, money, passwords
and identifying details. It does not explain precisely who can see each report
or how visibility varies. The brief does not establish that policy either.
Until verified against the actual publication and sharing rules, do not assert
“only nearby users,” “private report,” or “everyone can see your report.”
Link the existing privacy policy and community guidelines; make practical advice
easy to find before a visitor is asked to create an account.

### Distinguish a defect from a design concern

The ambiguous CTA and duplicated explanation are real content/UX deficiencies
visible in source, not evidence of a broken route. No runtime failure or security
defect has been established by this review.

## 4. Patterns to adapt

The following are **observed** from fetched public page content, not verified
claims about those companies' actual outcomes. Fetches are text/markup views:
exact screen placement, responsive behavior and interactions were not visually
verified. Fit and cautions are **asserted** recommendations.

| Pattern | Product observed + what they do | Why it fits lost-and-found | What NOT to copy |
| --- | --- | --- | --- |
| State both sides of the job | [LostaFound](https://www.lostafound.com/) says visitors can browse or report something lost or found; “Report an item” links to registration. | One short sentence covers both audiences and gives the next step context. | Its public listings, filters, map, counts or implied public browsing: Norfold search is protected. |
| Name the task before the account | [PawBoost](https://www.pawboost.com/) opens with lost/found pet reporting and a form that includes an email and password. | It makes both the user's intention and an account field visible in the same introduction. | Inline registration form, pet-specific claims, social reach, guarantees or promotional numbers. |
| Give an actionable safety rule | [Lost Items Community](https://lostitemscommunity.com/) explains checking an identifying detail and meeting in a public place. | The concern is specific to returning an item, not a generic “safe platform” badge. | Its simulated phone/feed/chat, exact map pin, moderation promises or long feature brochure. |
| Put account access in plain sight | [FoundHub](https://www.foundhub.co/) exposes “Log in” and “Sign up” alongside a lost/found headline. | Visitors can see the account path before choosing it. | Generic “Get Started”, security claims, testimonials or an extended founder-and-values page. |
| Explain the object of exchange | [Olio](https://olioapp.com/en/) names free food and other things neighbours give away, then offers “Get the app”. | Concrete objects clarify the service faster than a vague community slogan. | Download funnel, stock-style photography, modal, user counts or unrelated sharing claims. |

Research limitations: [FixMyStreet](https://www.fixmystreet.com/) returned HTTP
429; LostMyDoggie and Petco Love Lost returned HTTP 403. LostAndFound.com returned
only a loading shell. They are not used as observed product patterns here.
Freecycle and Life360 also returned text but are not needed for the five patterns.
Search snippets were discovery aids, not substitutes for a successful fetch.

## 5. Proposed structure

**Asserted proposal:** one concise public explanation; keep the existing
session-first root and all separate entry routes. No new asset is required.
Use current Material 3 roles and approved brand mark, not a new visual language.

### 1. Compact navigation

Purpose: offer a clear return path and access to safety and legal information.

- Brand: `Norfold`
- Navigation: `How it works` · `Safety` · `Sign in`
- Sign-in goes to the existing auth flow; do not insert an extra screen.

### 2. One direct introduction

Purpose: explain the job and the next step without paging through a story.

> **Lost or found something?**
>
> Make a report and look for possible matches.
>
> Create an account or sign in to report an item or search reports.

Primary action: **Create account or sign in**.
It should open the existing `/auth` gateway, not claim to create an account itself.
Keep an obvious separate **Sign in** link for people who already have an account.
If the existing gateway labels differ, verify its actual choices before shipping.

### 3. One short explanation

Purpose: explain what happens after the account step once, without guarantees.

> **Start with what you know**
>
> Add a photo and the details you remember, including an approximate area.
> Search reports and check any possible match carefully.

### 4. Practical safety and limitations

Purpose: give useful, grounded guidance and a path to the full rules.

> **Take care when returning an item**
>
> Keep identifying details private so the owner can describe them.
> Meet in a public place. Never share passwords or verification codes.
>
> Norfold is in beta. A match, response or return is not guaranteed.

Links: **Community guidelines** and **Privacy**. Add a specific visibility
sentence only after the real visibility rules are verified and reviewed.

### 5. Closing action and footer

Purpose: allow a visitor who read the guidance to continue without scrolling up.

> **Ready to begin?**
>
> Create an account or sign in to continue.

Action: **Create account or sign in**. Keep Privacy, Terms and Community
Guidelines links, plus the existing website transition note where applicable.

### Cut or consolidate

- Cut the public hero's four-scene pager and its duplicate completion control;
  do not remove the standalone onboarding route or alter its completion contract.
- Replace the six chapters with the short explanation and safety section above.
- Remove repeated calls to action that add no navigation value; assess the
  current sticky CTA at 320 dp before deciding whether it is needed at all.
- Retain safety, beta limitations, legal links and the no-fabricated-feed rule.
- Keep focus targets and a meaningful skip link if section navigation remains.

### Design boundaries

- Existing Material 3 tokens only: `bg-surface`, `text-on-surface-variant`,
  `rounded-m3-*` and `--fb-*` roles as applicable. Retain the current font stack.
- Preserve 320 dp, light/dark/AMOLED, 125% text and reduced motion.
- No new framework, dependency, domain, paid service, analytics vendor or
  A/B infrastructure. No overlay, pop-up, sheet or modal as a layout solution.
- This brief proposes text and hierarchy, not new visibility or product behavior.

## 6. What NOT to do

- Do not delay authenticated users or remembered-account users with a brochure.
- Do not consume or discard a pending protected destination; preserve the explicit
  `showPublic` exception and the eventual successful-sign-in return.
- Do not show fake screenshots, seeded reports, invented social proof or counts.
- Do not add stock photography, decorative pseudo-product UI or false activity.
- Do not promise who sees a report, automatic discovery, guaranteed matches,
  responses, moderation or recovery without verified product behavior.
- Do not introduce a pop-up, sheet or modal to resolve layout or conversion.
- Do not expose schema terms, model names or implementation details to visitors.
- Do not copy a reference site's full visual identity, marketing funnel or claims.

## 7. Verification plan

This is a future acceptance plan, not a claim that any check has already passed.

### Routing and copy

- Test authenticated root, boot/loading and error, incomplete profile, new guest,
  remembered-account chooser and explicit `showPublic` independently.
- Test a pending protected destination with and without `showPublic`; after
  successful sign-in, confirm the original destination is retained and consumed
  by the existing flow. Test public shared-report and legal links separately.
- Confirm each visible CTA reaches its stated existing destination, and that
  account creation and sign-in choices are accurately named at the gateway.
- Confirm `/search` and `/report` remain protected, with no fabricated feed.
- Check keyboard order, visible focus, skip/section links, screen-reader names,
  and that no removed chapter link targets a missing heading.

### Rendered review

- `apps/mobile/src/fixture/README.md:18-41` lists 320 dp, 125% text, dark and
  AMOLED variants, but **has no landing-page fixture frame**. Add a deterministic
  frame in a separately authorized implementation or review the actual guest
  route in an isolated synthetic browser context; do not claim fixture coverage now.
- At 320 dp measure viewport and document width for horizontal overflow; check
  heading wrapping, readable body text, unclipped controls and minimum 44 dp
  touch targets. Check content is not hidden behind any sticky action.
- Capture the introduction, safety section, footer and any sticky-action state
  in light, dark and AMOLED, plus 125% text and reduced motion. Include a 320 dp
  125% capture, short viewport and a representative wider screen.
- Compare screenshots with the current approved brand and token system; inspect
  contrast and reflow, focus states and actual navigation, not just snapshots.
- Verify reduced motion stops nonessential travel while retaining usable controls.
- Use synthetic data only. Physical devices and personal sessions require separate
  explicit consent; absent that, report native acceptance as unverified.
