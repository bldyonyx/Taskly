# Phase 4.7.3: trusted UI integration (2026-10-21)

**NO-GO for remote staging and production synchronization.** The isolated UI now
uses the trusted demo project and deny-client-write candidate. This section
supersedes launch instructions and current-status claims in historical sections.
No remote Firebase access, project creation, deployment, migration, credential
change, commit or push is part of this phase.

The browser reads through a UID-bound repository whose transport rejects every
nonempty write plan. Mutations use a same-origin Vite development proxy at
`/__trusted/mutate` to numeric loopback `127.0.0.1:8787`. The separate Node
service checks Host, optional exact Origin `http://127.0.0.1:5174`, method,
JSON type, 256 KiB body, token, exact command grammar and transaction bounds.
No CORS or cookie authentication is provided. Vite exposes this proxy only in
cloud-test serve mode. Normal, cloud-test production and Pages builds exclude it.

Auth/Firestore are fixed to `demo-taskly-trusted`, ports 9100/8087. The UID
comes exclusively from emulator Auth verification with revocation and user
existence/enabled checks. The transaction checks time-limited tester admission
even on receipt replay. Admin bypasses rules; service validation is mandatory.
Unsigned emulator tokens cannot prove cryptographic identity against local
attackers. Remote use requires signed token verification, HTTPS/ingress policy,
restricted signup, scoped IAM, quotas/rate limits, receipt retention, observability,
clock policy and an inventory/adoption design. These remain blockers.

Supported workflows: dated task create/edit/complete/delete/uncheck/clear/reorder;
Saved List create, replace, load/append and delete; Finish Day, archive viewing,
archive copy into an unfinished day and archive deletion; calendar navigation.
Task IDs, completion flags, order, date keys and list references are retained.
Server snapshots derive timestamps/counts and copy source tasks transactionally.
Saved List replacement preserves its creation timestamp/order and rewrites
membership/children atomically, without changing unrelated days or lists.

Blocked: browser initialization/adoption, account theme writes, Finished Day
editing/replacement, arbitrary archive creation, whole-account deletion, imports,
migration and reconciliation. Account theme buttons are disabled; the service
has no preference command. Existing guest behavior and all seven keys are intact.

There are no Firestore listeners in this UI. Reads use a coherent manifest
transaction; new writes capture the displayed revision. Stale revisions become a
visible conflict requiring explicit reload, never a forced write with fresh tokens.
An uncertain HTTP outcome blocks new edits and account reload; **Retry identical
command** resends the same request ID/content/revision. Receipts prevent duplicate
effects after lost acknowledgments. Browser page reload intentionally abandons
in-memory intent and reads server state; inspect it before issuing new work.
No durable/offline replay queue exists. Session epochs, UID-bound repository
invalidation and AbortController suppress old-account results after logout or
rapid switching. Cancellation cannot recall a command already accepted by the
service; it may commit to the original UID and is never applied to the new UI.
Success appears only after service commit confirmation and authoritative reload.

The trusted candidate already denies **all** browser writes: manifest forgery,
parent deletes, hidden children, fabricated counts, dangling references,
preferences, imports, receipts and operator controls. Reads require owner plus
active admission; roster/private controls/receipts cannot be read by clients.
Canonical and legacy admission rules remain unchanged and are tested separately;
their documented integrity gaps remain historical and are not used by this UI.

## Local startup

Use fresh disposable browser data and synthetic `@example.test` identities.
Terminal A: `npm.cmd run emulators:trusted` (also `emulators:cloud-test`).
Terminal B, from the project root:

```powershell
$env:GCLOUD_PROJECT = 'demo-taskly-trusted'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8087'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9100'
npm.cmd run dev:trusted
```

Terminal C: `npm.cmd run dev:cloud-test`; open `http://127.0.0.1:5174`.
Sign up with a synthetic account; it initially has no admission or trusted state.
In a fourth terminal with the same three environment variables, run:

```powershell
npm.cmd run fixture:trusted -- alice@example.test
```

This explicit operator tool accepts only a newly created demo identity under five
minutes old and refuses existing account families/markers/roster. It creates an
empty revision-zero manifest, trusted marker and one-hour admission. It is solely
a fresh test fixture, not an adoption/inventory tool; it cannot prove absence of
operator-inserted orphans under missing parents. Never use it on existing data.
Then click **Reload account data**. No browser command grants admission.
`npm.cmd run test:cloud-ui` starts the dedicated emulators and runs the service,
operator fixture and disposable browser automatically. `npm.cmd run test:trusted`
runs Auth, rules, transport and transactional adversarial tests.

Rollback: stop the dev server, service and emulators, then use normal
`npm.cmd run dev`. Do not reopen direct aggregate writes on trusted-managed
accounts. No deployed state or existing user data needs reversal.

---

# Phase 4.7.3: local trusted mutation service and isolated UI

Decision, 2026-10-21: **NO-GO for remote staging or production synchronization.**
The isolated emulator UI uses this exclusive writer boundary on fresh synthetic
accounts. It does not adopt existing accounts or activate remote synchronization.
Canonical `firestore.rules`, both previous emulator configurations, guest storage,
backups, recovery and `.env.local` are unchanged.

## Audit of existing writes

Audit sources: `src/js/data/account.js`, `data/lifecycle.js`,
`firestore/{repository,firebase,schema}.js`, `src/isolated/{firebase,controller,main}.js`,
`firestore.rules`, `scripts/staging-admission.mjs`, and
`tests/emulator/firestore.rules.mjs`. The import mapper in `schema.js` only plans
documents; it does not upload them. No other application Firestore writer was
found by searching write/transaction SDK calls and their wrappers.

Paths in this document are relative to `users/{verifiedUid}`. Let N be all indexed
documents including the manifest (at most 350), E declared extra paths, and U the
distinct old/new union (legacy maximum 400). Legacy lifecycle operations first
read the manifest outside the transaction, perform a connectivity read, then
transactionally read U documents. They write only changed documents, plus the
revision. Child order and membership can cause many siblings to change.
Every legacy writer needs an active, captured UID session; rules additionally
require that owner, or admitted owner in the generated admission candidate.

| Operation / entry points | Reads / writes and transaction size | Current revision contract / integrity exposure | Future access |
| --- | --- | --- | --- |
| Task create/edit/complete/delete (`changeTask`) | N + declared day/task extras; day, affected task/siblings, manifest | Optional caller revision defaults to freshly read revision. Client can forge membership, order or omit physical documents using raw SDK. | Trusted command only; mandatory displayed revision |
| Reorder (`reorderTasks`) | N; day tasks and manifest | Required revision and exact membership checked by client; forged manifest bypass remains. | Trusted only |
| UI task bulk edit or template/archive loading (`replaceDatedTasks`) | U=N+new day/task paths; replace snapshot and delete removed children | Required revision, reference existence; client planner cannot establish inventory completeness. Copy is an active-day write, not a read-only list load. | Trusted only; prototype `replaceDay` accepts content and derives order |
| Saved List creation (`saveList`, `saveListForDate`) | U=N+list/task/day extras; list snapshot, optional dated reference, manifest | Simple save revision optional, save-for-date required. Client supplies metadata/snapshot and can forge index. | Trusted only; prototype `saveList` copies a server-read day |
| Saved List replacement (`replaceSavedList`) | U=N+new list task paths; metadata, new/changed tasks, removed tasks, manifest | Required revision; immutable creation timestamp checked in client/rules; hidden children and inconsistent manifest remain possible. | Trusted only; explicit saveList replacement variant in Phase 4.7.3 |
| Saved List deletion (`deleteSavedList`) | N; parent, indexed descendants, all referencing indexed days, manifest | Required revision; malicious direct parent delete can omit children and reverse-reference rewrites. | Trusted only; prototype `deleteParent` |
| Finished snapshot creation (`createFinishedDay`) | U=N+archive/task paths | Optional revision; supplied counts checked by client, not fully provable by legacy rules. Allows arbitrary snapshots, not Finish Day provenance. | Trusted only; arbitrary archive creation remains unsupported |
| Finish Day (`finishDay`) | Additional coherent view, then U=N+archive/task paths; archive copied from source, source children removed and reference cleared | Required revision; client atomic planner safe for indexed state; raw writes can bypass provenance/counts. | Trusted only; prototype `finishDay` |
| Finished Day/day deletion (`deleteFinishedDay`, `deleteDay`) | N; indexed descendants, parent and manifest | Required revision; same orphan gap as list deletion. | Trusted only; prototype `deleteParent` |
| Calendar/current list (`setCurrentList`) | N+day extra; day and manifest | No displayed revision argument; resolves fresh revision. Legacy rules only validate affected days, so an unwritten reverse reference can dangle. | Trusted only; prototype reference included in `replaceDay` |
| Theme (`saveTheme`) | One preference document read/write transaction | Outside lifecycle revision. Owner/theme schema validation. Independent preference has no aggregate effect. | Could stay client-accessible under strict preference rules; candidate conservatively denies pending a separate decision |
| Empty initialization (`initializeEmptyAccount`) | Three parent collection lists outside transaction; one manifest transaction | Client confirmation, absent manifest; cannot discover descendants under missing parents. | Operator-only audited fresh initialization; no public initialize command |
| Generic repository `write`, `remove`, `atomic` | One or up to 400 supplied valid paths | `write` allows manifest, nested tasks, imports, preferences and root metadata subject to schema/rules; `remove` rejects parents but allows leaves/import/preferences; `atomic(...,{cascade:true})` is public and planner-driven. | All direct writes denied by candidate; these are bypass paths if legacy permissions survive |
| Raw Firebase SDK / emulator helpers | Arbitrary writes independent of repository/session checks | Canonical manifest exact +1 and affected-document rules do not prove complete semantics. Admission generator only changes the owner gate. | Candidate denies every client write, even a nominal server/custom claim |

Account reads, `loadSavedLists`, `loadFinishedDays`, calendar reads and explicit
listeners do not write. The normal production entry cannot create a Firestore
repository; `CLOUD_SYNC_ENABLED=false`, `STAGING_WRITES_ENABLED=false`, and
`APPROVED_STAGING_PROJECT=null` remain unchanged. Seven-key guest mutations are
local repository writes and are outside this service. Imports, migration, account
deletion and archive editors remain unsupported.

## Boundary and execution environment

Use a small command service with server-side transactions and exclusive write
IAM. A future HTTPS callable Cloud Function is suitable: managed execution,
verified Firebase Auth context, bounded input and a scoped service identity.
An authenticated Cloud Run HTTP handler is another option but requires equivalent
token verification, request limits and ingress policy. Neither is provisioned.
The current Node HTTP adapter is tooling only, not deployable function code.

`tools/trusted/service.mjs` verifies an emulator ID token with revocation checks,
checks the user still exists and is enabled, and derives UID solely from that
verified context. The command never accepts UID, owner, full document path,
manifest, revision output, timestamp, order or counts. The roster is read inside
every transaction attempt, including receipt replay: `enabled === true` and a
Firestore timestamp expiry strictly later than service time. Roster changes
participate in transaction conflict detection. Expiry or Auth disabling after
authorization cannot recall a request already accepted; remote design must
explicitly specify that in-flight boundary and clock policy.

**Admin/server SDK writes bypass Firestore rules.** A custom token claim cannot
turn an ordinary client SDK into Admin. Candidate rules deny *all* client writes
and allow only owner/admitted reads of explicit public account families. Roster,
control markers and receipts are private. Service authentication, authorization,
validation and IAM must therefore stand independently of rules. Test operator
fixtures use Admin privileges solely in the guarded demo project.

The exact environment is `GCLOUD_PROJECT=demo-taskly-trusted`, Firestore
`127.0.0.1:8087`, Auth `127.0.0.1:9100`; mixed projects, remote hosts and real
credential paths fail before SDK construction and routing is rechecked per call.
The CLI's optional `FIREBASE_CONFIG` must contain only the matching demo tuple;
it is validated but never used to initialize an SDK or other Firebase product.
Auth has an inert emulator credential; Firestore uses the server constructor
exported by Admin with explicit insecure loopback transport. No ADC discovery,
certificate, service-account key or production Firebase web configuration is used.
`METADATA_SERVER_DETECTION=none` prevents automatic GCE probes. A process-wide
socket guard admits only numeric `127.0.0.1` ports 8087, 9100 and 8787, blocking
other destinations before connecting. Run this tool in its own Node process.
It must never be imported into Vite or an unrelated application server.

Auth emulator tokens are deliberately unsigned. Verification checks project,
issuer, expiry, subject, user existence and revocation, but cannot establish
cryptographic identity against a local attacker who can forge an existing UID's
token or use emulator Admin access. A `KNOWN LIMIT` test explicitly demonstrates
that behavior. The emulator is a trusted developer test environment, not a
security perimeter. A remote service must reject unsigned tokens and must never
inherit these emulator settings or dummy credentials.

## Command schemas and invariants

All commands have exactly `{requestId, expectedRevision, type, payload}`.
`requestId` is 1–80 ASCII letters, digits, `_` or `-`; revision is a nonnegative
safe integer. Unknown fields/types reject. Payload shapes:

| Type | Exact payload | Server behavior |
| --- | --- | --- |
| `replaceDay` | `{dateKey, tasks:[{id,text,completed}], currentListId}` | Create/replace one day; strict real calendar key, unique valid IDs, nonempty text at most 10,000 characters and boolean completion. Derive contiguous order, validate referenced Saved List exists in this account, delete old children atomically. Covers create/edit/complete/delete/reorder proof cases. |
| `saveList` | `{dateKey,id,name}` | Copy transaction-read nonempty day to an absent list; derive timestamps, snapshot order and membership; set day's current reference. Explicit replacement variant: `{id,name,tasks:[{id,text,completed}],replace:true}` replaces an existing list, preserving server creation time/order and all day references, deriving update time and deleting removed children. No dateKey or metadata accepted in this variant. |
| `finishDay` | `{dateKey,id}` | Copy transaction-read nonempty day to an absent archive; derive date, timestamp, order and exact physical/completed counts; delete active children and clear source reference. |
| `deleteParent` | `{collection,id}` | Collection is days/savedLists/finishedDays; require existing parent, delete children and parent; deleting a list clears every day reference in the same commit. |

Each attempt reads roster, private `trusted/state`, request receipt and manifest,
then physical parent collections and task collections in a single transaction.
Queries use a shrinking global document budget with one overflow sentinel:
valid accounts have at most 350 aggregate documents including the manifest;
invalid inventories stop at 351 plus the three service documents. Physical
membership must exactly equal the manifest, IDs and owner/schema fields must
match, orders must be contiguous, references must resolve and archive counts
must equal physical flags. State changes are planned in memory and validated
before staging any write. Manifest membership is rebuilt from the resulting
server state, never taken from command input. No asynchronous cascade or partial
batch fallback exists.

The resulting state must fit 350 aggregate documents, 200,000 manifest JSON
characters and conservative byte limits: 256 KiB request, 900 KiB per document,
4 MiB serialized aggregate state. The distinct old/new path union plus roster,
control and receipt must fit 400 documents. This additional three-document
overhead deliberately makes the local prototype somewhat narrower than the
legacy transaction boundary. Firestore's own request/index/transaction limits
still apply and may refuse smaller operations; such errors never trigger partial
fallback. Broad production size policy is unresolved, not silently migrated.

The account must already have an operator-created `trusted/state` marker
`{version:1, requestCount:0}` and an empty revision-zero manifest. There is no
browser-accessible marker creation or "confirmed empty" parameter. Only test
fixtures initialize newly generated users after clearing the dedicated demo DB.
No application code calls this initialization and no existing user data is read.
Future adoption requires a privileged inventory that can find subcollections
under missing parents, a maintenance/write freeze and an explicit reconciliation
decision. Parent collection queries alone cannot prove absence of such orphans.

Completeness is preserved inductively only for audited fresh state and exclusive
trusted writers. Physical queries additionally detect operator-created unindexed
children under present parents and other physical inconsistencies. They do not
repair them. A visible `KNOWN LIMIT` test confirms that operator-inserted
absent-parent orphans survive; Admin corruption remains outside the guarantee.

## Revision, idempotency and results

The manifest is never deleted or reset. New commands require the displayed
expected revision and increment it once. Transaction retries re-read state and
admission; competing distinct requests using the same revision yield one winner
and one conflict. There is no retry that fetches a new revision to force intent.

Each accepted request atomically writes a private UID-scoped receipt containing
a SHA-256 fingerprint of the normalized full command (including expected revision)
and its committed result. Object field order is normalized; task array order is
semantic. Identical request-ID retries return the original result without another
effect even if later mutations have occurred. Different command content using
that ID returns `idempotency-conflict`. Concurrent duplicates share one effect.
Failures do not create receipts or advance the control count. After uncertain
acknowledgment, retry exactly the same ID/content, never a fresh ID/revision.
The local control document caps successful receipts at 1000; new work then fails
intact while old receipt replay works. No unsafe TTL/eviction policy is included.
Remote receipt retention, quotas and compaction need a reviewed protocol.

Success resolves only after `runTransaction` commits and contains
`{ok:true, code:'success', confirmed:true, revision, stateHash, parentCount,
taskCount, replayed}`. The hash and counts describe that committed revision,
not a promise that no later command has changed the account. Replay returns the
original committed revision and is explicitly marked. Tests compare the result
hash to committed documents. Errors have `{ok:false, confirmed:false, code,
message}` with unauthenticated/forbidden/invalid-input/not-found/conflict/
idempotency-conflict/integrity/uninitialized/limit/unavailable codes.
`unavailable` is an uncertain outcome and advises same-ID retry; it is not proof
that a lost commit acknowledgment means no write. Raw SDK errors/tokens are not
exposed.

## Local startup and rollback

Install dependencies with `npm.cmd install`; Java and the already-installed
Firebase CLI/emulator JAR are needed. Use free ports; never stop unrelated
processes. The full reproducible fixture/HTTP/rules/command test is:

```powershell
npm.cmd test
npm.cmd run test:trusted
```

To inspect the endpoint without running tests, terminal A:

```powershell
npm.cmd run emulators:trusted
```

Terminal B, with no real credential environment:

```powershell
$env:GCLOUD_PROJECT = 'demo-taskly-trusted'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8087'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9100'
npm.cmd run dev:trusted
```

The tooling API is `POST http://127.0.0.1:8787/mutate`, exact JSON content type
and `Authorization: Bearer <emulator ID token>`. It binds numeric loopback, checks
Host, permits only the exact optional loopback UI Origin, denies CORS/cookie
authentication, and bounds request bytes/time.
It intentionally has no initialization/adoption endpoint; commands on an empty,
uninitialized account fail. `tests/emulator/trusted.mjs` is the complete operator
fixture and usage example; its database clearing belongs only to that demo test.

Stop the Node tool and emulators to roll back the local experiment. No deployed
rule/service or user migration needs reversal. The isolated UI now uses the trusted configuration via its development-only
proxy; see the Phase 4.7.3 integration guide above. Normal UI behavior is unchanged.

## Remote prerequisites and remaining work

No provisioning or deployment is authorized. Future staging needs separately
approved project/origin/web tuple; signed Auth verification and prevention of
uninvited signup; short-lived tester roster with an operator/revocation owner;
scoped service IAM and restricted privileged operators; deny-direct-write rules
deployed together with complete service coverage; request/concurrency/rate quotas,
App Check/abuse controls, logging without tokens or task content, observability,
receipt retention, clock/expiry policy and a threat review. Resolve inventory and
adoption before writing any existing account. No rule rollback may reopen raw
client aggregate writes on accounts already managed by this service.

Implement/review preference policy and remaining workflow commands before remote activation.
Saved List replacement/loading, session generations and uncertain-ack UI are
implemented locally in Phase 4.7.3. Read scaling and
transaction contention remain bounded but expensive; no sharding or imports are
provided. The HTTP prototype's process-wide guard and unsigned-token mode must
not become a production deployment artifact. Vite graph and artifact checks
explicitly exclude trusted tooling/Admin from normal builds.

The installed dependency audit reports 6 advisories (5 high, 1 moderate) on
existing Firebase client/gRPC, source-map-js and Vite paths, none attributed to
the new Admin dependency. No unrelated downgrade or forced audit fix was applied;
dependency remediation needs separate review before remote activation.

Primary references: [Auth emulator and unsigned tokens](https://firebase.google.com/docs/emulator-suite/connect_auth),
[server transactions](https://firebase.google.com/docs/firestore/manage-data/transactions),
[server SDKs bypass security rules](https://firebase.google.com/docs/firestore/security/rules-structure).

## Phase 4.7.3 pre-implementation audit (2026-10-21)

The isolated entry has no Firestore listeners: it reloads a coherent manifest
transaction after confirmed writes and keeps its displayed revision until explicit
reload. Session epochs already discard late factory/read/write results.
`replaceDay` can represent task edits, completion, deletion, reorder, list loading,
archive copying and dated references. `saveList` creation and `finishDay` must copy
the server-read source day; `deleteParent` covers list/archive/day cascades.
Saved List replacement cannot use the original create-only command: extend
`saveList` with an explicit replacement snapshot variant, preserving server-owned
creation time and order. Browser initialization, theme writes, archive editing,
arbitrary archive creation, imports, migration and account deletion remain blocked.
Fresh synthetic accounts require an operator fixture; browser signup never grants
admission or initializes the trusted marker. The legacy direct-write repository
must receive a read-only transport in this entry, with deny-all candidate writes
as the independent enforcement boundary. Normal entry and canonical rules stay
unchanged.

## Phase 4.7.3 final validation and changed files (2026-10-21)

| Check | Result |
| --- | --- |
| Unit tests (npm test) | 89 passed, 0 failed, 0 skipped |
| Canonical Firestore emulator | 33 passed, 0 failed, 2 admission-only skipped (35 discovered) |
| Legacy admission Firestore emulator | 35 passed, 0 failed, 0 skipped |
| Trusted Auth/Firestore/HTTP suite | 19 passed, 0 failed, 0 skipped |
| Browser emulator workflows | 25 checks passed; zero runtime exceptions or non-loopback page requests |
| Normal production / cloud-test production / GitHub Pages builds | All three succeeded; existing >500 kB chunk warning remains |
| Production artifact isolation | 4 text artifacts per build; 12 passed total |
| git diff --check | Passed; only line-ending notices |

The trusted suite verifies missing/invalid/expired/wrong-project tokens, required
temporal claims, revoked Auth sessions, disabled/deleted users, UID injection,
missing/expired/malformed/disabled/revoked admission and reauthorization on receipt
replay. It tests deny-all client writes, atomic oversized-operation rejection,
Saved List replacement/cascade contention and competing task reorders. Two passing
KNOWN LIMIT cases retain explicit unsigned-token impersonation and privileged
missing-parent-orphan limitations; they are not remote security guarantees.

Browser evidence: .firebase/cloud-ui-1792540247431/report.json and verified-ui.png
(visually inspected). Browser checks include actual Sortable dragging, displayed
revision conflicts, offline failure, lost acknowledgment after a real commit,
exact-byte retry, injected service failure, pending-command logout, delayed
hydration with rapid switching, and byte-identical preservation of all seven guest
keys. The final token-time checks were added after that browser run and verified
against real emulator identities in the final trusted suite. Logs are under
.firebase/phase473-{unit,rules,admission,trusted,ui}.log.

All requested validation categories were executed. The two canonical skips are
executed by the admission suite. Remote/prod Auth, mobile/accessibility matrices,
every list-editor dialog and privileged inventory/adoption were not exercised;
remote access is deliberately out of scope. No observed supported-workflow
regression remains. Account theme writes and browser initialization are explicit
trusted-mode restrictions; normal guest/theme/backup/Auth behavior is unchanged.
Normal production startup retains zero Firestore operations. Production and
staging synchronization remain disabled. No remote Firebase data was accessed;
no project was created, rules/service/Hosting deployed, existing user data changed,
credentials or .env.local edited, commit made or push performed.

Changed files (22):

- tools/trusted/{server,service,commands,fixture}.mjs: loopback transport, token
  temporal checks, explicit Saved List replacement, fresh operator fixture.
- src/isolated/{config,firebase,controller,main,trusted}.js: trusted demo routing,
  read-only SDK transport, authenticated commands, retries and session cancellation.
- src/js/ui/modals.js: optional disabled theme buttons; default behavior preserved.
- vite.config.js and package.json: development-only proxy/CSP and local scripts.
- scripts/{cloud-ui,check-isolated-build}.mjs: trusted browser failure scenarios
  and transport-marker exclusion checks.
- tests/trusted-client.test.js, tests/isolated-controller.test.js and
  tests/emulator/trusted.mjs: transport, retry, session, identity and race coverage.
- docs/{trusted-mutations,firebase-staging-plan,isolated-cloud-testing,
  cloud-lifecycle-safety,firebase-local-safety}.md: architecture, local startup,
  limitations, rollback and current staging assessment.

**Recommendation: GO for this isolated local experiment; NO-GO for remote staging
or production synchronization.** Signed identity, restricted signup, scoped IAM,
reviewed operator/adoption inventory, quotas, receipt lifecycle and complete
production coverage remain prerequisites. Rollback never reopens direct writes
on service-managed accounts.
