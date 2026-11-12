# Settings surface: design note

Status: design agreed in direction, not implemented. Prototype only. No wiring,
no persistence, no role lookup, no backup, no push, no email.

Owner references, 2026-11-12:

- Image 3, the long settings index. This is the structure the Settings surface
  follows.
- Image 4, the account menu. This is the structure the popover follows. It
  corrects the current popover, which is a plain list of text rows.

Read with `SPEC.md` (surface contract) and `OWNER-DECISIONS.md` (owner rulings).

## 1. Why the current shape is wrong

Today the gear opens `#settingsPopover`, a 300px card of seven text rows, and
each row opens `#settingsChild`, a second floating card on top of it. There is
no index, no grouping, no search, no page of its own, and the child covers the
rail. Every destination that is not Settings, Appearance or Activity
preferences has nowhere to go.

Two different objects are also being conflated: an account menu and a settings
index. They get separated below.

## 2. Decision log

| ID | Decision |
| --- | --- |
| D-S1 | Settings becomes a first-class surface with its own index, not a popover with a child card. |
| D-S2 | The Settings index follows image 3: profile header, search field, grouped rows with icon, title, current value, chevron. |
| D-S3 | The account popover follows image 4: identity header row, hairline dividers, icon and label rows, chevrons only where the row opens another level. |
| D-S4 | The gear opens the Settings surface. The account row and the appbar avatar open the popover. The popover has its own Settings row. |
| D-S5 | Every row in image 3 that the popover does not already cover becomes a secondary page in the Settings surface. |
| D-S6 | Secondary pages replace the index inside the same surface. They are not floating cards and are not nested modals. |
| D-S7 | The palette stays frozen. No token values change. |

## 3. Account popover, corrected to image 4

Presentation:

- Anchored to the account row on desktop, to the appbar avatar on phone.
- 300 to 320px wide, radius 18, one hairline divider between groups, 8px
  padding around the rows.
- Row: 24px stroke icon, 15px label, 56px minimum height, 44px target.
- Chevron only on the identity header, Help and Log out.

Order:

1. Identity header: 40px avatar, `Riley Ellis`, subtitle `@riley`, chevron.
   Opens the profile surface.
2. Divider.
3. `Appearance`, `Saved`, `Report a problem`. No chevrons. Direct destinations.
4. Divider.
5. `Settings`. No chevron. Opens the Settings surface at the index.
6. Divider.
7. `Help` with chevron. Opens Help and about inside Settings.
8. `Log out` with chevron. Opens the existing confirmation, then the
   signed-out surface.

Removed from the popover: `Activity preferences` (Notifications now lives in
Settings), and the bare `Switch account` text row. See discussion item 3 for
where the account switch goes.

## 4. Settings surface: index

Layout, top to bottom:

1. Header: back arrow, title `Settings`, search icon.
2. Profile card: avatar, display name, handle, `View profile` action.
3. Search field: `Search settings`, live filter, clear action, no-match state.
4. Grouped rows. Group headings are sentence case with no uppercase tracking.
5. Inline toggle block: `Keep this account on this device`.
6. `Sign out` action row, destructive colour, no chevron.

Desktop: fills the content area beside the persistent sidebar, centred column
capped near 720px. Phone: full screen, pill navigation hidden, back arrow
returns to the previous surface. No floating layers.

Search behaviour: filters rows by title and subtitle, keeps the group heading of
any matching row, and shows `No settings match that search.` with a clear
action. It searches the index, not the inside of pages.

## 5. Row inventory

"In popup" marks rows the current popover already covers. Everything else is a
new secondary page required by D-S5.

| Group | Row | Subtitle rule | In popup |
| --- | --- | --- | --- |
| none | Updates and version history | explanation | no |
| Account | Recovered items | explanation | no |
| Account | Account and verification | state | no |
| Account | Devices | explanation | no |
| Account | Chat backup | explanation | no |
| Account | Chat preferences | explanation | no |
| Preferences | Appearance | state | yes, theme only |
| Preferences | Notification preferences | state | yes, as Activity preferences |
| Preferences | Accessibility | state | no |
| Preferences | Feed layout | state | no |
| Intelligence | Local intelligence | explanation | no |
| Privacy | Privacy and safety | explanation | no |
| Moderation | Moderation and roles | explanation | no |
| Reviews | Report queue | explanation | no |
| Reviews | Staff reviews | explanation | no |
| Reviews | Review appeals | explanation | no |
| Reviews | Review feedback | explanation | no |
| More | Send feedback | explanation | no |
| More | Advanced | explanation | no |
| More | Legal | explanation | no |
| More | Help and about | state, version | no |
| inline | Keep this account on this device | explanation | no |
| action | Sign out | none | yes |

Also in the popover and not in the index: `Saved`, `Report a problem`. They stay
as popover shortcuts and do not get Settings pages.

Subtitle rule, P3 below: a row whose setting has a current value shows that
value (`Light`, `7 days`, `Auto masonry`). A row without a single value shows
one short sentence ending in a full stop. Never both in one row.

## 6. Secondary page content

| Page | Content | Data status |
| --- | --- | --- |
| Updates and version history | current version, build, dated list of changes | version read from `package.json` (0.16.0-beta.1), not hardcoded |
| Recovered items | returned count, rating, standing, link to the Recovered surface | product data missing |
| Account and verification | email, phone, password, Google sign-in state | synthetic only |
| Devices | this device, other sessions, sign out other sessions | needs session data |
| Chat backup | last backup, export, restore | blocked by the gates in `CHAT-MEDIA.md` |
| Chat preferences | who can message you, message requests | design only |
| Appearance | theme: light, dark, AMOLED | prototype state exists |
| Notification preferences | activity types, mark read on open, retention, weekly digest, push | prototype state exists from the Activity pass |
| Accessibility | text size, reduced motion, larger targets | prototype studio controls exist |
| Feed layout | masonry auto, 2, 3, 4 at the 1660 canvas, media behaviour | `MASONRY-STUDY.md` approved |
| Local intelligence | Smart Search status, model presence, download and remove, storage, residency | no product wiring |
| Privacy and safety | profile visibility, searchable, show reports, blocked accounts, who can message | prototype state exists |
| Moderation and roles | staff-only role list and what each may do | no role lookup |
| Report queue | reports waiting for a decision, link to the staff console | staff-only |
| Staff reviews | decisions already made | staff-only |
| Review appeals | appeals waiting for a second look | staff-only |
| Review feedback | notes left on reviews | staff-only |
| Send feedback | subject, details, Send | delivery not wired |
| Advanced | diagnostics, logs, environment, experimental flags | diagnostics are not consumer-facing by default |
| Legal | terms, privacy, licences | needs real text |
| Help and about | guides, support, version | design only |

Staff group and pages appear only for a staff account. The prototype gets a
studio `Staff view` control so both states can be judged. A normal account never
sees a dead moderation row.

## 7. Detail page contract

- The index is replaced by the page, not covered.
- Header: back arrow, page title, optional primary action such as Save.
- Back returns to the index at the same scroll position and search query.
- Escape order: page, then index, then the previous surface.
- Focus moves to the page title on entry and returns to the row on exit.
- Deep link from Activity: Notification preferences opens with `Back to
  Activity` and `All settings` links, so the user is not trapped.
- Confirmation dialogs, such as Sign out, are the only nested layer and reuse
  the existing dialog pattern.

## 8. Visual system

- Row: 20px icon in a 36px tonal square, 15px semibold title, 13px muted
  subtitle, 16px chevron, separators inset past the icon column.
- Profile card: 64px avatar, 17px name, 13px handle, accent `View profile`.
- Page: 20px title, 13px description, labelled sections, 44px controls, primary
  Save at the section end.
- Search: 44px field, leading icon, clear button, result count or no-match copy.
- 320px and 200% text: titles wrap to two lines, subtitles wrap, no horizontal
  overflow, no clipped targets, no collision with the header.
- Light, dark, AMOLED. Normal text 4.5:1, large text 3:1.
- Motion: short index to page transition, suppressed under reduced motion.

## 9. Proposals against the reference

P1. Do not carry `Plus`, `Upgrade plan`, `Find workspaces` or `Personalization`
verbatim. Norfold shows no plan tiers, no workspace concept and no separate
personalisation model in the repository. Leave those slots empty until a
decision exists rather than inventing a product surface.

P2. Rename the `Reports to review` group to `Reviews` and reduce it to three
rows: `Report queue`, `Appeals`, `Review feedback`. `Staff reviews` beside
`Review reports` describes the same thing twice.

P3. Enforce one subtitle rule. The reference mixes live state (`On`,
`System - Blue`) with explanation (`Keep your conversations with you.`), which
makes the list read unevenly.

P4. Keep the chevron on every settings row, because every row is a page. Do not
carry that into the popover, where image 4 shows chevrons only on rows that open
another level.

P5. Gate `Chat backup` and `Recovered items`. Both imply capability that is
blocked or absent. Mark them design-only and keep them out of a release until
the backing work exists.

P6. Read the version from `package.json` and show the same string the release
check uses. Do not type a version into the page.

P7. Add `All settings` on any page opened by a deep link, so the Settings index
stays one action away.

## 10. Discussion list

Ranked by how much they change the build. Each has my recommendation.

1. **Where does the account switch live?** The reference has no equivalent. My
   recommendation: put `Switch account` as the last row of the first group in
   the popover, directly under the identity header, since it is an account
   action rather than a setting. Alternative: keep it out of the popover and put
   it inside Account and verification.
2. **Is there a commercial row?** Image 4 leads with `Upgrade plan`. Norfold has
   no plan model that I can find. Do we want `Support Norfold` there, or nothing?
   Recommendation: nothing until a product decision exists.
3. **Does a workspace or group concept exist?** `Find workspaces` has no
   counterpart. Recommendation: omit. If connections are meant to be grouped
   later, that is a product question, not a settings row.
4. **What separates Appearance from Accessibility?** Recommendation: Appearance
   is theme only, Accessibility holds text size, motion and target size. That
   matches image 3 and keeps `Feed layout` independent.
5. **How much of Account and verification is real?** The account is Google-only
   and no phone number exists. Recommendation: show email and sign-in method as
   real values when wired, and show phone only if a phone is actually attached.
   Never render an empty fake field.
6. **Devices scope.** Recommendation: this device plus other active sessions,
   with sign out others. Needs real session data before it ships.
7. **Chat backup scope.** Recommendation: keep the page out of the build until
   the `CHAT-MEDIA.md` gates clear. Do not show a backup button that cannot run.
8. **Staff rows and role gating.** How is staff decided: a role claim on the
   profile, or a build flag? Recommendation: role claim, with the prototype
   studio toggle simulating it. Both states must be reviewed.
9. **Does `Keep this account on this device` describe our auth?** Recommendation:
   only keep it if the session really persists across restarts. Otherwise drop
   the row instead of describing behaviour we do not have.
10. **Sign out scope.** Recommendation: sign out everywhere by default, with
    `Sign out this device` offered on the Devices page.
11. **Should the sidebar gain a Settings row?** Recommendation: no. The gear and
    the popover are enough, and a rail row would give Settings the same weight as
    Feed.
12. **Search depth.** Recommendation: index rows only. Searching inside pages
    needs anchors and a result preview to be honest.
13. **Recovered items and rating.** Is a rating part of the product, or is that
    reference-specific? Recommendation: show only counts and standing we can
    actually compute.
14. **Legal text ownership.** Terms, privacy and licences need real documents.
    Who writes them?
15. **Notification permission state.** Push is not wired. Recommendation: show
    the email digest and in-app activity now, and keep a `Push` row out until a
    real permission flow exists.

## 11. Build order

1. Surface shell: header, profile card, search, group headings, row component,
   index to page navigation, triggers, removal of `#settingsPopover` and
   `#settingsChild` as the settings host.
2. Account popover rebuilt to image 4, anchored to the account row and the
   appbar avatar.
3. Primary pages: Account and verification, Appearance, Accessibility,
   Notification preferences, Feed layout, Privacy and safety.
4. Secondary pages: Updates and version history, Recovered items, Devices, Chat
   backup, Chat preferences, Local intelligence, Send feedback, Advanced, Legal,
   Help and about.
5. Staff group: Moderation and roles, Report queue, Appeals, Review feedback,
   plus the studio `Staff view` control.
6. Verification pass.

## 12. Verification plan

- Index and every page rendered at 320, 411, 768 and 1280, in light, dark and
  AMOLED, at 100% and 200% text, with reduced motion.
- No horizontal overflow in the app or on any page. No clipped title.
- Every row opens its own page with the correct title and content.
- Back restores the index scroll position and search query. Escape follows the
  documented order.
- Tab order, visible focus, `aria-expanded` on the real trigger, labels on every
  field, accessible names on icon-only controls.
- Contrast measured for every text state, not sampled. Normal 4.5:1, large 3:1.
- Dead-control sweep: any control whose only effect is its own appearance fails.
- No em dashes, no generic CTAs, no invented numbers, no invented personal data.
  Synthetic values stay labelled as synthetic.
- The anti-slop gate runs before implementation and again after, with a PASS,
  FAIL or UNVERIFIED line per check.

## 13. Files

| File | Role |
| --- | --- |
| `docs/design/nav/prototype.html` | the judged prototype |
| `docs/design/nav/SPEC.md` | surface and component contract |
| `docs/design/OWNER-DECISIONS.md` | owner rulings |
| `docs/design/nav/SETTINGS-SURFACE.md` | this note |

Icons already available: `settings`, `palette`, `shield`, `device`, `mail`,
`lock`, `download`, `help`, `info`, `clipboard`, `clock`, `filter`, `send`,
`trash`, `alert`, `archive`, `refresh`, `check-check`, `map-pin`.
Still needed: accessibility, layout or grid, intelligence, team, request or
appeal, legal document, backup, and a plain list icon for queues.
