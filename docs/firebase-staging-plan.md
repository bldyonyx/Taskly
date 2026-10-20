# Taskly Phase 4.5 — Firebase staging audit and plan

Audit date: 2026-10-20 (Europe/Zurich). Status: planning complete; **NO-GO for real staging writes today**. Everything below described as proposed is future work, not an implemented safeguard or authorization.

## Executive summary

Normal Taskly still uses local data, including when optionally authenticated. `CLOUD_SYNC_ENABLED` is the source constant `false`; normal startup does not construct a Firestore repository. The opt-in `cloud-test` development entry uses a separate named demo app, fixed loopback emulators, and a restrictive CSP. Neither a normal build nor a `cloud-test` build includes that isolated runtime.

The main accidental-production risks are concrete: `.firebaserc` defaults to `taskly-maya`, and this checkout's `.env.local` contains all four normal Auth settings and selects that production project. Ordinary development/build modes load those settings. This does not activate Firestore, but opening a normal development build can contact production Authentication. Merely adding `--mode staging` today would still run the normal entry and can inherit production Auth settings. Do not use that as a staging launch command.

Use a separate Firebase project, separate named app and origin/profile, explicit staging entry/build, independent configuration namespace, exact project allowlist, staging-only deployment identity, and deny-by-default write gate. First validate the remaining emulator UI and adversarial rules cases. Then seek distinct approvals for project configuration, staging rules deployment, and staging writes. Production synchronization requires its own future decision.

Only this document changes tracked project content. No Firebase project/account was created, no rules/Hosting deployed, no production data accessed, no credentials/environment settings changed, no user data migrated, and no commit/push performed. Local tests/builds generated only disposable ignored build artifacts.

## Evidence and inspected scope

Read the four requested guides: [foundation](firestore-foundation.md), [account integration](account-data-integration.md), [lifecycle safety](cloud-lifecycle-safety.md), [isolated testing](isolated-cloud-testing.md), plus Authentication and local repository/backup documentation. Inspected actual source/configuration:

- `index.html`, `src/main.js`, `vite.config.js`, `package.json`, `.gitignore`, `.env.example`; `.env.local` was checked read-only for field presence and production project selection without printing keys or other configuration values.
- `.firebaserc`, `firebase.json`, `firebase.isolated.json`, `.github/workflows/deploy.yml`, `firestore.rules`.
- `src/js/auth/{index,config,firebase,session}.js`, `src/js/firestore/{firebase,repository,schema}.js`.
- `src/js/data/{boundary,account,lifecycle,legacyFinishedDays}.js`, `src/isolated/{config,firebase,controller,main}.js`.
- Local storage/repository, Saved Lists and Finished Days persistence; relevant settings/modal/theme call sites.
- Existing test inventory, emulator suite guards, browser runner, and production artifact checker.

No applicable `AGENTS.md` was found in the workspace search or ancestor paths. Console state, production rules, billing plan, IAM, actual authorized domains and existing production data were deliberately not inspected. Prior documentation's claims about deployed rules are historical statements, not a verified live inventory.

## Current architecture and safety findings

| Area | Confirmed implementation | Risk and required response |
| --- | --- | --- |
| Normal startup | `main.js` imports the local repository and starts optional Auth. Boundary reports account-disabled and never constructs cloud data. | Local tasks are the same browser workspace while signed in; login is not a privacy lock. Preserve that behavior until an approved account UI is introduced. |
| Environment | Auth accepts any nonempty API key, auth domain, project ID and app ID via `VITE_FIREBASE_*`. | No project assertion; no cross-field consistency check. Staging must never reuse this reader/default app. Fail before SDK initialization on missing/mixed/production config. |
| Default app | Normal Auth uses `getApp()` when apps exist. | It does not verify that the existing default app matches supplied config; named-app-only situations can also throw. Staging must use an exact dedicated app name and validate its options. |
| CLI | `.firebaserc` default is production. `firebase.json` includes rules and Hosting `dist`. | An implicit or unscoped deploy could target production and multiple services. Future wrapper must require literal staging ID, scoped service, explicit config and staging-only IAM. |
| Hosting/CI | Current workflow builds `--mode github`, uploads `dist` and deploys GitHub Pages on main/manual runs. No Firebase deploy, env injection or test gate is configured. | Keep staging artifacts out of `dist`/Pages. A locally built normal artifact can embed production Auth config. Add isolation/build checks to CI before staging; choose a Node version supported by the locked Vite version (current workflow declares Node 20 without a minor version). |
| Emulator | `serve` + `cloud-test` only; define flag, loopback host/strict port 5174, alternate env prefix, HTML entry rewrite, loopback CSP. | Do not relax these guards to support staging. Missing emulators must remain a failure, never a production fallback. |
| Emulator Firebase | Named `taskly-isolated`, dummy key, fixed `demo-taskly-isolated`, Auth 9099, Firestore 8085, connections set before persistence/operations. | Good independent boundary; no normal Auth config consumption. CSP and browser request interception add defense in depth. |
| Build gate | All builds, including `--mode cloud-test`, use normal entry. Artifact checker scans JS/HTML/CSS for selected isolated markers. | Passing marker scans does not prove zero production Auth/Firestore traffic. Future checks must also inspect the dependency graph and actual network routing; expand for staging markers/config. |
| Dormant cloud factory | Accepts caller app, checks SDK UID vs controller, defers `getFirestore` until operation. | No project guard; if future code passed production app it could access production. Guard both factory creation and database resolution in staging. |

Vite loads generic `.env.local` for each mode; mode-specific files override matching keys but do not remove inherited ones. Shell variables have higher priority. A filename or mode name alone is no isolation boundary. [Vite env precedence](https://vite.dev/guide/env-and-mode).

### Data isolation, revisions and atomicity

- Repository paths are allowlisted and rooted at `users/{boundUid}`. No per-call UID override. Rules require `request.auth.uid == uid`, exact shapes, owner/schema values and appropriate immutable fields. Unknown nesting is denied. Guests and other UIDs cannot use the supported paths.
- Manifest `lifecycle/state` stores revision and ordered task IDs by parent. Aggregate operations read the entire indexed account transactionally, compare the expected revision inside the callback, verify indexed records/order/counts/references, and write changed documents plus revision together. Replacements, cascade cleanup and Finish Day are single transactions, not partial batches. Saved-list deletion clears dated references; Finish Day copies original states/IDs then clears active tasks/reference atomically.
- Client manifest validation counts `1 + sum(1 + number of tasks per parent)` and caps it at 350; preferences, imports and the user marker are outside that count. Manifest JSON string length is capped at 200,000, which is a client bound, not Firestore's byte-size limit. Repository caps unique old/new transaction paths at 400. These are Taskly limits, not guarantees of Firebase capacity.
- Isolated UI passes displayed revisions for task replacement/reorder, list operations, deletes and Finish Day. Some lower-level APIs still allow omission: targeted task calls, new snapshots, `setCurrentList`, `createFinishedDay`. Omitted revision defaults to the latest manifest at invocation. Do not expose these directly in a staging stale-view editor; inventory all reachable mutation call sites and require displayed tokens for aggregate UI intent.
- Preferences use independent server-confirmed document transactions. They do **not** advance the manifest or compare a displayed preference revision; concurrent theme changes can be last-writer-wins. Account data and theme are loaded in parallel, not as one atomic snapshot. Explicitly accept/test this policy or design a preference token; do not describe the manifest token as protecting theme edits.
- Repositories permanently invalidate on unresolved/pending Auth, logout, UID change or disposal. SDK identity is checked too. Controller generations clear tasks/lists/calendar/theme/modals/revision immediately and suppress late factories/results, including returning to the same UID. Already submitted requests may still commit under the original identity; logout cannot recall them. Verify the original account after uncertain acknowledgments.
- Server-only reads, memory-only Firestore cache and transactions avoid an application offline write queue. Preflight server read enforces the offline policy, but connectivity can fail afterward. Failure/timeout is not proof of noncommit. Reload and inspect stable IDs/revisions before manually retrying; never manufacture a new snapshot ID to replay uncertain Finish Day.
- UI retains confirmed state while saving, blocks duplicate actions, and reports success only after confirmation plus reload. Confirmed write followed by failed reload has a distinct message. No guest fallback, background cloud listener, automatic retry/import or guest cloud outbox exists.

### Rules are an isolation boundary, not a complete integrity proof

These are static findings from the actual rules, not newly executed attack tests:

1. Manifest update validates owner/base fields, nonnegative revision increment, map type and at most 349 parent entries. It does not validate every parent path, child ID array, duplicate membership, total indexed count or the client manifest length cap. An owner can change the manifest alone without writing the corresponding aggregates.
2. Task rules verify post-commit membership/order and parent existence. They do not prove that every manifest-listed document exists, that removed membership implies deletion, or that deleting a parent also deletes all children. A crafted same-owner write can leave orphaned/untracked data. Parent metadata can refer to a missing saved list; Finished Day counts can disagree with children; rules check date shape rather than real month lengths.
3. User-marker deletion is allowed to its owner and is not recursive. Preferences/imports remain independent of the manifest. Manifest deletion is denied, so whole-account deletion is intentionally unsupported.
4. `initializeEmptyAccount` lists visible top-level days/lists/archives and checks absent manifest. It cannot discover orphan subcollections under missing parents, and those lists are not part of the initialization transaction. It does not audit preferences/imports. A confirmed button is an assertion by the operator, not a proof of empty descendants or a defense against other writers during setup.
5. Rules use `get/getAfter/existsAfter`; emulator success on 25-task operations is not proof for every allowed 350/400-path case. Real service access-call/request/byte/index limits still apply. Add boundary and adversarial tests before staging writes. [Transaction rules limits](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firestore limits](https://firebase.google.com/docs/firestore/quotas).

These gaps do not grant cross-UID access. They limit claims of same-owner integrity and safety when adopting historical data or exposing an untrusted client. Before a bounded private staging pilot, execute/document adversarial results and explicitly approve the synthetic-data-only threat model, or harden the protocol in a separate reviewed phase. Public staging or production requires a deliberate integrity design decision; UI restrictions alone do not enforce backend integrity or tester admission.

Authorized domains and API keys do not restrict who may register an Email/Password account or call Firestore as their own UID. Current rules allow every authenticated UID its own namespace; there is no tester allowlist or App Check. A private URL alone is insufficient. Decide an enforceable tester-admission policy before live writes (for example, reviewed server-controlled membership in rules, with approved tester creation). Do not promise invitation-only staging with current rules. Any rules change requires a separate implementation review; none is made here.

## Proposed environment separation

| Mode | Entry/config | Services/data | Required behavior |
| --- | --- | --- | --- |
| Normal production / guest | Existing `src/main.js`; `production` or `github` | Local guest repository; optional existing production Auth | Zero Firestore reads/writes/listeners. Source cloud flag stays false. A strictly network-free guest build must omit all normal Auth config as a separately approved choice. |
| Local emulator | Existing `cloud-test` development mode | Fixed demo project and local Auth/Firestore | Keep all current guards/CSP. Synthetic identities/data in disposable profile; no configurable real project. |
| Staging | Proposed separate `src/staging/main.js` and named `taskly-staging` app; `staging` mode only | New exact project ID; `(default)` Firestore; synthetic tester accounts only | Explicit launch/build opt-in, visible STAGING/project banner, read-only until distinct write approval; no production app, imports or guest migration. |

Recommended candidate project ID: `taskly-maya-staging` (availability unverified); alternative `taskly-maya-stg-<unique-suffix>`. Human display name `Taskly STAGING — synthetic data only`. Never accept merely a `-staging` suffix or editable env value as proof of the right project: approve and pin one exact ID in reviewed configuration.

Proposed staging-only inputs, **not added in this phase**:

```text
TASKLY_STAGING_BUILD=1
TASKLY_STAGING_WRITES=0
TASKLY_STAGING_FIREBASE_API_KEY=<staging web app value>
TASKLY_STAGING_FIREBASE_AUTH_DOMAIN=<staging web app authDomain>
TASKLY_STAGING_FIREBASE_PROJECT_ID=<exact approved staging ID>
TASKLY_STAGING_FIREBASE_APP_ID=<staging web app appId>
```

Use a dedicated `config/staging/.env.staging.local` env directory and a staging-only prefix, with no fallback to normal `VITE_FIREBASE_*`. Validate raw inputs at build/server startup; inject only the reviewed staging config object and booleans. Never inject the whole process environment. Client configuration is publicly readable, including API key; no service-account/Admin credentials belong here. Database defaults to `(default)`; no storage/messaging/analytics settings are required by current Taskly code. [Web app setup](https://firebase.google.com/docs/web/setup).

Proposed scripts: `dev:staging` (fixed loopback port 5175), `build:staging` (output `dist-staging`), `preview:staging` (dedicated origin). `--mode staging` without `TASKLY_STAGING_BUILD=1` must fail. Never make ordinary `build`, `build --mode cloud-test`, `build --mode github` or an unknown mode select a cloud staging entry. Because a staging build is still a production-optimized Vite build, its guard must deliberately support the reviewed build path; copying the emulator's `DEV === true` requirement would prevent it from working.

Required pre-SDK and runtime assertions:

1. Exact mode + compile-time staging opt-in + approved hostname/origin; reject unknown modes, missing/partial settings and generic production config contamination.
2. Project ID equals the pinned approved ID and differs from `taskly-maya` and every `demo-*` ID. Auth domain/app ID match the approved web-app tuple. An API key's project association must be verified against the approved Console config; it cannot be inferred from the key string.
3. Named app's actual `app.options.projectId`, app ID and Auth/Firestore app references match before any operation. Never call `getApp()` to reuse a default app. Fail without initializing another backend on mismatch.
4. Both emulator connection overrides absent for staging; emulator mode remains hardwired. Validate service endpoint/project routing in network tests, not only an env string.
5. Cloud writes require build-time write approval gate plus reviewed UI/session controls; a server-side deny-write policy is needed when revoking access to already distributed clients. Build flags are operational safeguards, not security rules.
6. Rendered project ID, UID/test identity and aggregate revision are visible. Replace emulator-specific messages/initialization labels; preserve controller generations, confirmation and explicit reload policy.

Separate origin and disposable browser profile protect normal guest storage and persisted Auth. Preserve all seven guest key names: `taskly.tasks.v1`, `taskly.tasksByDate.v1`, `taskly.currentListByDate.v1`, `taskly.savedLists.v1`, `taskly.currentListId.v1`, `taskly.finishedDays.v1`, `taskly.theme.v1`. Do not clear them to switch environments. Browser Auth persistence is separate from those keys; normal Auth defaults to SDK browser persistence while the emulator explicitly selects local persistence. Choose/document staging persistence and test refresh/cross-tab behavior. [Auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).

### CLI and deployment safeguards

Propose `.firebaserc` aliases `staging: <approved-ID>`, `production: taskly-maya`, `emulator: demo-taskly-isolated`; remove the production `default` in a separately reviewed change. Do not rely on the active alias. A dedicated `firebase.staging.json` should initially contain **only** the rules mapping. Keep Hosting absent until separately approved.

Future wrapper must require the literal pinned staging ID, reject production/demo/unknown IDs, print account/project/config/service/artifact hash for review and require `--only firestore:rules`. Use a staging-only deploy identity with no production role. CI staging secrets/config and jobs must be scoped to an approval-protected staging environment, with no automatic deployment from the existing Pages workflow. Emulator commands keep explicit demo IDs. [CLI aliases and scoped deployment](https://firebase.google.com/docs/cli).

## Firebase prerequisites: future manual setup only

Firebase recommends a separate project per environment; a second web app in production shares its resources and is insufficient. [Environment guidance](https://firebase.google.com/docs/projects/dev-workflows/general-best-practices).

After approval checkpoint A only:

1. Owner creates the approved separate project, confirms ID/project number and IAM, and records the billing plan/account choice. Do not clone production Auth/users/data. Analytics, Functions, Storage, extensions and Identity Platform upgrades are unnecessary for the current code path.
2. Register a new Web app; record the four-value configuration from that same project. Review key restrictions for the selected APIs/origin and test that they do not break Auth. Do not change production key settings.
3. Enable Email/Password Authentication, review password policy and abuse/email limits. Keep anonymous/phone/federated providers disabled unless separately requested. Determine tester admission before opening signup. Use invented accounts without personal data; email reset tests must not send mail to unrelated people. [Password Auth setup](https://firebase.google.com/docs/auth/web/password-auth).
4. Review authorized domains: only the intended staging hostname and explicitly required local hostnames. Use hostname only, no scheme/path/port; verify actual local-origin flows. New projects after 2025-04-28 do not automatically authorize localhost. This setting supports relevant Auth flows/email actions; it is not a Firestore or signup allowlist. [Authorized-domain guidance](https://firebase.google.com/docs/auth/faq-and-troubleshooting).
5. Create a Firestore Standard/Native database named `(default)` because the current SDK factory uses that database. Choose and record location before creation (consider tester geography and later production latency needs). Start with production-mode deny-all rules, **not open test mode**; the console term “production mode” here refers to restrictive initial rules in the staging project. [Database setup](https://firebase.google.com/docs/firestore/quickstart).
6. No custom composite index is required for current direct-document/collection access. Reassess index cost and manifest map indexing before enlarging accounts; do not deploy speculative indexes. No Hosting is required for a local staging pilot: a dedicated local origin can use the remote staging backend. Two browsers/devices may require a separately approved HTTPS staging host.
7. Firebase Hosting, if chosen later, must use a separate staging site/project and `dist-staging`; capture exact host, CSP and deployment target first. Never publish staging to existing production Hosting/Pages or assume Hosting protects backend access.

After checkpoint B only, the intended scoped procedure is:

```powershell
# Future instructions only. Replace placeholder with the approved literal ID.
# First record project identity, saved current rules and candidate rules SHA-256.
firebase.cmd deploy --config firebase.staging.json --only firestore:rules --project APPROVED_STAGING_PROJECT_ID
```

The wrapper/config do not yet exist. Compile and test the exact candidate locally first; inspect the selected staging Console release after deployment and verify denial/owner cases there with approved synthetic accounts after write approval. Deploying owner-write rules already grants write capability to qualifying clients even if UI writes are disabled: checkpoint B must acknowledge that capability and the tester-admission policy. If that is not yet approved, retain deny-all rules or deploy a separately reviewed read-only candidate. Never run unscoped `firebase deploy`, `firebase init` over existing files, or deploy to `taskly-maya` for staging.

### Costs and quotas: verified platform facts versus pending decisions

Official pages checked on 2026-10-20; recheck before provisioning. No live project's plan, prices or usage were queried.

| Item | Verified public platform fact | Taskly decision / verification still needed |
| --- | --- | --- |
| Firestore free quota | One database/project gets 1 GiB storage, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, 10 GiB outbound/month. | A small bounded pilot can fit no-cost quota; do not guarantee it will. Monitor retries, initialization, reloads and test resets. |
| Billing | More quota requires billing; additional databases and TTL/PITR/backup/restore/clone features require billing. | Current client path needs none of those optional features. Approve Spark if available/sufficient; approve any Blaze linkage separately with a budget. |
| Usage amplification | Reads/writes/deletes, index-related usage, storage and transfer contribute to cost. | Each aggregate load/mutation reads the entire indexed account, plus preflight/manifest reads; confirmation reload and transaction retries add reads. Rules-dependent reads can also add cost. Measure a test-session usage delta before expanding testers. |
| Auth | Password Auth has signup/abuse limits; reset email limits currently 150/day Spark and 10,000/day Blaze. | Verify selected Auth product/plan, limits and controlled email delivery; Identity Platform changes pricing/quotas. Avoid phone/SMS. |
| Budgets | Alert-only budgets do not stop services; currently listed spend-cap services do not include Firestore. | Do not promise a Firestore spending cap. Assign an operator to monitor and stop tests/deny writes at agreed thresholds. |
| Hosting | Optional for this architecture. | Verify current static Hosting quotas/location transfer charges only if publishing is proposed. No Hosting cost estimate or deployment is approved here. |

Sources: [Firestore pricing](https://firebase.google.com/docs/firestore/pricing), [plan behavior](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Auth limits](https://firebase.google.com/docs/auth/limits), [billing controls](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills). Unit prices by chosen location/currency, project-creation quotas, organization/IAM restrictions, actual available plans and exact Hosting needs remain **requiring verification** at setup. Avoid a fixed monthly estimate before measuring workload.

Firestore also imposes document/request/time/index and rules evaluation limits independently of Taskly's counts. Current published examples include 1 MiB documents, 10 MiB requests and rules access limits of 10 per individual operation and 20 per transaction/batch; cached access calls can be excluded. Maximum document-count tests alone cannot certify these limits. [Service limits](https://firebase.google.com/docs/firestore/quotas), [atomic rules limits](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Remaining blockers and resolution order

| Limitation | Classification | Safe scope / resolution |
| --- | --- | --- |
| No staging entry/project assertions/deploy guard/admission decision | Blocking staging writes | Implement and review isolation first, then approve external setup. No env-only workaround. |
| Rules integrity gaps, large-operation compatibility, remaining failure/UI coverage | Blocking staging writes pending validation and explicit bounded-risk decision | Add adversarial/boundary emulator cases, record accepted same-owner limitations or design rule/protocol hardening. Do not claim UI limits enforce backend limits. |
| More than 350 indexed documents / manifest cap | Blocking production activation without an explicit bounded-product policy or scaling design; safe to defer in bounded staging | Reject atomically with understandable UI. Warn before capacity exhaustion. Use synthetic accounts strictly below cap; test 350 vs 351 and manifest-length limits. Do not truncate or split. |
| More than 400 unique old/new transaction paths | Safe to defer in bounded staging; production policy/scaling blocker | Union includes deleted old paths and newly created snapshot paths. Finish Day can cross 400 even if before/after each fit 350. Test exact 400/401 and byte/rules limits. Decrease pilot limits if needed; no partial batch fallback. |
| Existing cloud reconciliation | Blocking adoption of existing accounts; blocking production activation where historical data may exist | Fresh controlled staging accounts only. Separate trusted descendant inventory required for unknown/orphan data, manifest construction and recovery. Never infer absence from parent listings or auto-initialize an existing account. |
| Whole-account deletion | Safe to defer in closed synthetic staging with no delete-account UI; production lifecycle blocker pending an approved policy | Auth deletion/user-document deletion is not recursive Firestore cleanup. Design trusted complete descendant cleanup, failure recovery and retained-manifest policy separately. Pilot cleanup requires explicit approval too. |
| Ambiguous legacy Finished Day timestamps | Safe to defer while import is absent; blocks any legacy import/migration release | Keep guest data local. Use source-matched explicit original-date review; no timezone inference. Existing pure inspection/resolution helpers are not an import executor. |
| Cloud archive editing/replacement | Safe to defer with explicit read-only UI | Existing cloud archives/read-only selected dates must block editing, drag and active-copy overwrite there. Copying into an unfinished active date is a separate supported action. Implement archive edit only after a reviewed immutable-date/revision design. |
| Other disabled operations | Safe to defer with explicit UI restrictions | No guest migration, whole-account delete, untracked-data repair, background/offline sync or automatic merge/retry. Audit hidden menus/shortcuts; unsupported must not silently invoke guest mutations. |
| Theme concurrent writes | Safe to defer if last-writer-wins is explicitly accepted | Verify account/guest isolation and honest server confirmation; introduce preference revision only if product semantics require conflict detection. |

Resolution order: environment/deployment guards and tester admission; remaining emulator security/boundary/UI matrix and initialization protocol; approved private project/rules; read-only staging verification; approved bounded write pilot; failure/concurrency evidence and cost review; scalable lifecycle/reconciliation/deletion decisions; legacy import and archive editing only as separate scopes. Production is last and requires a new audit/approval.

## Staging validation checklist and evidence

All real staging actions below require their relevant approvals. Existing emulator runners must retain their demo-only guards and must **not** be retargeted to staging. Create a distinct future staging runner restricted to the pinned project, approved origin and explicit synthetic test UIDs; no blanket database clear/export or production token use.

| Check | Manual procedure / expected result | Automated extension and evidence |
| --- | --- | --- |
| Launch isolation | Deliberately supply missing/mixed/production settings, wrong mode, hostname and app; all fail before Firebase initialization. Normal entry stays local. | Config/build tests plus captured request routing; zero Firestore traffic in normal mode, zero non-loopback backend traffic in emulator, zero production-project requests in staging. Allow shared Google service domains only when their project routing is verified; domain allowlist alone is insufficient. |
| Account creation/login | With approved synthetic A/B, test invalid credentials, password policy, duplicate signup, logout, observer restoration and unavailable Auth. | Dedicated staging Auth smoke checks only after approval; record project and redacted UIDs, no tokens/passwords. Reset/email flow only to controlled test mailboxes. |
| Empty initialization | New audited account shows empty/uninitialized state; operator attests provenance; explicit initialization yields revision 0 once. Repeating rejects. | Emulator cases for existing parents/manifest, orphaned children and concurrent initialization writers; record limitations. No automatic setup on login. |
| Guest isolation | Seed synthetic guest sentinels for seven keys, snapshot raw values, log in/out, create account data, refresh. Guest tasks/theme restore exactly. | Compare all seven raw strings/nulls before/after account operations. No guest IDs/text in account writes; no account text in guest storage. |
| Two accounts | A writes A-only data, switches to B and back; repeat in another browser/profile. No A/B data/theme/revision leakage. | Emulator/rules suite plus staging UI traces and own-UID queries; cross-UID attempts denied. |
| Tasks | Create/edit/check/uncheck/delete, bulk clear, drag reorder first/middle/last; reload after each. Stable IDs and contiguous order match view. | Add bulk cases and exact snapshot comparisons; successful aggregate mutation advances revision once, failed action leaves server unchanged. |
| Calendar | Navigate empty/nonempty dates/month boundaries/leap dates; markers and selected tasks agree; navigation causes no data writes. | Timezone/DST/date fixtures, request trace and stable revision on navigation. |
| Saved Lists | Create/save/load, update existing, delete referenced list, copy to another unfinished day. Verify detached snapshots, timestamps and all reference cleanup. | UI editor/delete paths plus emulator atomic rollback/conflict cases; preserve list IDs, regenerate active-copy IDs intentionally. |
| Finish Day / Finished Days | Finish mixed completed tasks on selected date; active day clears and archive/counts/dateKey/IDs match. View, copy to unfinished date, delete archive. | Atomic server assertions, stale-token/denial failures with no partial clear; archive editing and active overwrite on archived dates visibly disabled. |
| Theme | Exercise all five themes, switch accounts and guest, reload. No account theme writes to guest keys. | Browser matrix and concurrent theme test documenting independent last-writer-wins; theme changes do not advance aggregate revision. |
| Refresh/session | Refresh while guest, authenticated, loading and after confirmed save; fresh factory/view resolves from correct account. Test restricted browser persistence. | Controller tests plus staging browser refresh, cross-tab signout traces; no flash of previous account content. |
| Two devices | Independent sessions for same synthetic UID; A commits, B remains stale until explicit reload then matches. | Record both displayed revisions/snapshots. No claim of live synchronization: current UI has no background listeners. |
| Conflict | Both edit same revision (also unrelated dates); first commit succeeds, stale second is blocked without retry. Reload then deliberately reapply. | Independent SDK clients plus UI; log revision before/after and distinguish genuine permission denial from proven competing revision. |
| Offline/recovery | Disconnect before save, during transaction and after commit/before reload. Reconnect and explicitly reload. | Browser offline plus injected timing failures. No optimistic Saved, queued replay or duplicate IDs; uncertain outcome reconciled by server IDs/revision. |
| Permission denied | Approved test identity/rules fixture denies an otherwise valid write; retained confirmed view, failure state and no guest fallback. | Emulator automated denial/rollback; controlled staging case without temporarily weakening rules. Collect error code and unchanged server snapshot. |
| Pending switch | Delay factory/read/write, logout/switch A→B→A; stale results/dialog callbacks/drag cannot publish or submit new old-context writes. | Controller timing tests and focused UI scenario; already-submitted commit may finish only in original UID, then must be checked there. |
| Revision consistency | Rendered token corresponds to returned aggregate view; no latest-token fetch to force stale intent. | Compare manifest, UI and transaction result across create/reorder/list/delete/Finish Day. Preference exception documented. |
| Rules denials | Unauthenticated and B cannot read/list/write A; reject owner forgery, extra fields, unknown nesting, immutable-field changes, reset/deletion of manifest and missing lifecycle advance. | Existing emulator suite plus new adversarial membership/orphan/count/reference cases. Record expected accepted gaps separately, never count them as rejections. Staging smoke uses normal rules-bound SDK, not Admin bypass. |
| Bounds | Exercise exact count/size limits including Finish Day old/new union; valid near-limit operations work, excess fails atomically. | Emulator 350/351, 400/401, long UTF-8 IDs/text/manifest and rules-call budgets; repeat representative allowed cases on staging. Record service-specific failures and lower pilot cap if necessary. |
| Restrictions | Attempt disabled archive edit, import/reconciliation and whole-account deletion from every reachable control/shortcut. | Browser assertions: no network mutation/local fallback. No unsupported control claims success. |
| Production isolation | Start each supported build in disposable profile with network recording; validate backend project IDs/Auth config. | Dependency-graph/artifact assertions plus actual request interception. Never log into or probe production to prove isolation; block unexpected routing before transmission. |

Required release evidence bundle: source revision plus dirty-state/diff hash, rules SHA-256 and deployed staging release, exact project/app/database/origin, approved gate records, tool versions, test commands/results, dated manual checklist with screenshots, redacted request log proving routing, pre/post server snapshots and seven-key equality, concurrent revision traces, zero unexpected runtime errors, documented accepted limitations, and measured staging usage/cost thresholds. Do not collect passwords, refresh/ID tokens or personal task contents. Store test evidence outside tracked app files. Any failure blocks signoff until explained and retested.

### Checks actually executed in this audit

| Command | Result |
| --- | --- |
| `npm.cmd test` | 68 passed, 0 failed, 0 skipped. Mock/pure/unit tests; no live Firebase calls. |
| `npm.cmd run build -- --outDir .firebase/phase45-normal-build` | Passed. |
| `npm.cmd run build -- --mode cloud-test --outDir .firebase/phase45-cloud-test-build` | Passed; normal entry retained. |
| `node scripts/check-isolated-build.mjs .firebase/phase45-normal-build` | 4/4 text artifacts passed. |
| `node scripts/check-isolated-build.mjs .firebase/phase45-cloud-test-build` | 4/4 text artifacts passed. |

Both builds retain the existing >500 kB chunk warning. Builds were not opened in a browser; embedding normal Auth config did not execute Auth. No dependency install, live CLI command, browser test, emulator start or remote write was performed. The 15 emulator tests / 20 browser workflows reported in Phase 4.4 are **historical 2026-10-17 evidence**, not rerun results here. Remaining new security/UI cases above are proposed coverage, not established passes. Final `git diff --check` and status inspection verify only this planning document is added to tracked scope.

## Small implementation phases and approval checkpoints

No implementation is authorized by this plan. Each future local code step needs the user to start that implementation phase; external gates below remain separate even after that authorization.

| Step / goal | Likely files | Required checks | Principal risk | Rollback / approval |
| --- | --- | --- | --- | --- |
| 1. Local environment guards, no remote config | New staging config/assertion module and tests, `vite.config.js`, scripts/build checker, `package.json`, `.env.example`, docs | Wrong/mixed config rejected pre-SDK; normal/github/cloud-test builds exclude staging; emulator behavior unchanged | Inherited env/default app or entry leaks | Remove/revert reviewed local change; no data affected. Local implementation authorization only. **Exact next step.** |
| 2. Close test gaps and decide bounded security scope | Existing controller/account/emulator/browser tests; lifecycle/schema/rules only if separately approved design requires hardening | Full emulator suites, adversarial and near-limit matrix, all reachable revision call sites | Rules allow malformed same-owner state; false completeness claim | Revert candidate before deployment; preserve diagnostics. No live writes. Explicit approval for accepted integrity/admission policy. |
| 3. Provision/configure private staging, retain deny-all | External Console; later `.firebaserc`, dedicated staging config records/env file | Owner verifies project ID, Web tuple, IAM, Auth policy/domains, plan/region; no production reads | Wrong project or unexpected billing/signup exposure | Leave backend deny-all and disable staging access; deleting project/resources is a separate explicit action. **Checkpoint A: explicit approval before creation/configuration, Auth accounts or billing linkage.** |
| 4. Prepare and deploy reviewed staging rules | Proposed `firebase.staging.json`, deployment wrapper, `.firebaserc`, docs; exact reviewed rules artifact | Local compilation/emulator pass, hashes, literal project and staging-only identity, inspect release | Rules deployment grants client permissions regardless of UI flag | Restore saved restrictive staging rules with same scoped project command; never production. **Checkpoint B: explicit approval for exact project/rules/hash/capability.** |
| 5. Staging read-only runtime and optional host | New `src/staging/{main,firebase}.js`, shared controller/UI extraction if justified, staging CSS/scripts | Wrong endpoint denied before requests, Auth switching, server reads and no initialization/mutations | Emulator messages/guards copied incorrectly; normal UI accidentally gains cloud path | Disable staging entry/stop local server or withdraw separate host; existing production build remains. Read/Auth access must be included in A; **separate explicit approval before any Hosting deployment**. |
| 6. Enable bounded staging writes | Reviewed staging gate, UI restrictions, test-only initialization controls, dedicated staging runner | Full checklist, server confirmation/rollback/conflict/session/offline, privacy and request routing | Data corruption, unbounded signup/cost, uncertain commit replay | Stop write clients; deploy approved restrictive staging rules; reconcile confirmed server state. **Checkpoint C: explicit approval for synthetic UIDs, operation/size scope, admission and cost policy before initialization or any writes.** |
| 7. Collect pilot evidence / decide go-no-go | Evidence reports and this guide; no implicit feature expansion | All matrix cases, second reviewer, usage review and known-gap acceptance | Treating emulator/pilot success as production readiness | Keep staging isolated/read-only, preserve synthetic evidence; cleanup requires separate approval. Pilot signoff only. |
| 8. Production readiness proposal | Future deployment/IAM/data inventory and scaling/reconciliation/deletion designs; runtime changes only in approved scope | Fresh audit, production data procedure separately approved, release/rollback rehearsal | Production access/migration or activation without consent | Default production local behavior and existing rules remain until approved. **Checkpoint D: explicit separate approval before considering any production sync rollout, rules change or data operation.** |

## Rollback, recovery and go/no-go criteria

For isolation/config failures: refuse initialization and stop the staging server/build distribution. Never fall back to the production app or to guest data inside an authenticated account context. Restore the previous staging artifact/config only after its identity is checked. Reverting a bundle does not revoke already distributed clients; operational shutdown must include approved restrictive staging rules and, if necessary, tester/session access controls.

For uncertain writes: freeze further edits, reload authoritative manifest/IDs under the original synthetic account, distinguish committed from rejected changes, and preserve evidence. Reconnect does not trigger replay. A session switch suppresses UI results but is not a transaction rollback.

For corruption/orphans: stop initialization and mutations; do not rebuild the manifest from incomplete parent listings. Escalate to a separately approved trusted staging-only descendant audit/reconciliation procedure. No existing whole-account cleanup or repair executor can be assumed. Never delete an Auth account or user marker expecting recursive deletion. Preserve synthetic data until cleanup approval; do not use production data as a recovery source. Save prior staging rules and restore that exact release/text via scoped staging deployment when needed. Deny-all stops ordinary clients but does not stop Admin/IAM bypass, hence staging-only IAM matters.

**GO for local guard implementation:** this document reviewed and implementation requested; no live project needed.

**GO for staging setup:** checkpoint A, exact project/region/plan/IAM/domain/admission decisions recorded; initial deny-all; no production credentials or data used.

**GO for bounded staging writes:** checkpoints B/C, exact runtime/project guards and network/build evidence, emulator/security/limit/UI matrix passes, fresh account provenance, accepted same-owner integrity limits or reviewed hardening, explicit supported operations/caps, operator and rollback rules ready, and synthetic-only test scope.

**GO for successful staging signoff:** every mandatory checklist result and evidence artifact reviewed, independent sessions agree after explicit refresh, no cross-UID/guest leakage or production request, no partial failed lifecycle write, no false Saved or reconnect replay, expected size rejection is safe, and cost/abuse thresholds are acceptable. Disabled operations are verified as disabled, not counted as implemented.

**NO-GO:** any production routing, wrong/mixed config, unapproved billing/deployment/write, open database rules, unsupported adoption/import, unexplained integrity/rules failures, stale-context publication, missing revision protection for aggregate UI intent, or incomplete test evidence. Today real staging writes remain NO-GO because the staging runtime/guards/admission and new validation matrix are not implemented.

**Production synchronization remains disabled.** Staging signoff does not authorize production access, rules deployment, synchronization or migration. A separate production proposal must resolve/explicitly approve the bounded-account policy, historical-data reconciliation, deletion/recovery policy and supported feature scope before checkpoint D.
