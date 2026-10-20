# Taskly Phase 4.7.1 — local integrity hardening

## Current decision — 2026-10-20

**NO-GO for remote staging access or synchronization.** Partial server-enforced
hardening and a local admission candidate are implemented. The owner-authored
manifest is still not authoritative. Exhaustive manifest, cascade and aggregate
integrity need a trusted mutation boundary or a reviewed replacement data model.
This section supersedes changed findings below; Phase 4.7 remains historical.
No existing weakness has been accepted as safe for remote activation.

No remote project/account provisioning, deployment, remote database access, migration,
credential or `.env.local` change, commit or push occurred. Production and staging
synchronization remain disabled. Existing optional production Auth is unchanged
and separate from synchronization. The seven guest keys are unchanged.

### Root causes and classified outcomes

Paths below are relative to `users/{uid}`. UID isolation is preserved throughout.

| Documents / fields and root cause | Implemented enforcement | Remaining outcome |
| --- | --- | --- |
| `lifecycle/state.parents`: manifest rule checks envelope, parent-map size and revision increment, not every entry or physical document. Indexed count is derived as `1 + sum(1 + ids.length)`, not a stored count field. | **Prevented by transaction/repository logic:** valid paths, unique IDs, 350 indexed documents, 200,000 JSON characters, existence and task ordering for the indexed set. **Prevented by rules for written parents:** membership must be a list of at most 348 unique entries. | **Requires trusted server enforcement; remote activation blocked.** Manifest-only arbitrary values/keys, duplicates, oversized ID lists under absent parents, and order reversal without task rewrites remain accepted. No exact account-wide server count guarantee. |
| `lifecycle/state.revision`: exact +1 does not prove a valid semantic mutation. | Existing **rules prevent** missing CAS participation for aggregate writes, stale/unchanged/jumped revisions, wrong lifecycle ID, reset/deletion. Repository serializes supported writes and detects revision conflicts. | Standalone exact +1 still succeeds without mutation. Concurrent malicious bumps may serialize but represent no legitimate intent. **Requires trusted server enforcement.** Preferences/imports intentionally remain outside aggregate revision participation. |
| Deleting `days/{date}`, `savedLists/{id}`, `finishedDays/{id}` only checks absence from final index; children can survive. | **Prevented by transaction/repository logic** for supported operations: delete every indexed child and clear indexed references atomically. **Prevented by rules:** user-root deletion now always denies, matching the already unsupported whole-account API. | Full cascade **requires trusted server enforcement; remote activation blocked**. Adversarial tests prove surviving physical children under all three deleted parent families. Empty forged index cannot reveal them. Initialization still requires an audited empty account. |
| `days/{date}.currentListId` previously checked only null/ID shape. | **Prevented by rules for written days:** referenced list must be indexed and physically exist after the commit (`existsAfter`). Same-commit list creation works; deletion with a rewritten dangling day denies. Repository clears all indexed day references when deleting a list. | Deleting a list with a referencing day left unwritten still bypasses that day's rule. Enumerating all reverse references **requires trusted server enforcement**. Repository rejects corrupt indexed state. |
| `finishedDays/{id}.totalCount`, `completedCount`; task `order` and completion flags: previous rules checked only scalar bounds and order for written tasks. | **Prevented by rules for written archives:** totalCount equals final index length, with unique/bounded membership. Task writes retain physical-parent, indexed-membership and order-at-position checks. Repository verifies actual indexed counts/flags/order and captures Finish Day source state atomically. | Index can name missing tasks; completedCount can disagree with real flags; untouched parents can retain stale totals. Full physical counts, task ordering and Finish Day provenance **require trusted server enforcement**. Top-level Saved List/Finished Day order retains existing order/ID sorting semantics; no new contiguous-order requirement is imposed. |
| Day paths and archive `dateKey` accepted February 30 / April 31 through a regex. | **Prevented by rules:** Gregorian calendar month lengths and leap-year arithmetic match client validation, including 1900/2000 cases. | Display date/timestamp strings remain shape-checked, not historical provenance. Original-day review remains explicit. No conversion or repair occurs. |

Matching a count to a forged list is not proof that its tasks exist. Rules evaluate
affected documents; validating a written parent/task does not validate untouched
siblings or referencing days. The new per-parent 348 limit follows from 350 minus
parent and manifest, not a new reduced account limit. No arbitrarily large map or
collection is enumerated. Residual `KNOWN GAP` tests assert actual acceptance;
their passing status is evidence of blockers, never a security guarantee.

### Safest complete remediation — design only

Retain this model through a trusted bounded mutation service; deny direct client
aggregate/manifest writes in separate reviewed rules. Authenticate UID, enforce
admission on every operation, validate operation input/expected revision and plan
all changes from trusted state in one transaction. Never accept a client manifest
as authority. Include request IDs/idempotency and uncertain-acknowledgment handling;
retain UI session generations, offline failures, conflicts and confirmed success.
Admin SDKs bypass rules, so service authorization and scoped IAM are mandatory.

Before adopting existing accounts, establish a trusted inventory of actual
descendants, including under missing parent/root documents. Client index reads
and parent collection listings cannot prove completeness. For audited fresh
accounts, exclusive trusted writers can preserve completeness inductively. Each
delete must enumerate known children and reverse references in the atomic commit;
an asynchronous cleanup trigger cannot ensure no orphan interval or atomic
replacement. Over-limit operations reject intact. Historical corrupt data needs
a separate reviewed reconciliation plan, not silent deletion, adoption or import.

Embedding task arrays in parents would eliminate physical task subcollection
orphans and help local counts/order, but not account indexing, reverse references
or Finish Day provenance. It also cannot preserve the current worst-case payload:
348 tasks of 10,000 characters exceed Firestore's 1 MiB document limit. Such a
change needs explicit byte limits, schema version, compatibility and opt-in
migration design. Bounded shards with rule-checkable witnesses are another design
to evaluate. No flattening, silent limit reduction, trusted service or remote
infrastructure is introduced here.

### Separate, local admission candidate

`scripts/staging-admission.mjs` derives `.firebase/staging-admission.rules` from
canonical integrity rules by replacing exactly one owner gate, failing if that
expected gate changes. Every existing owner permission additionally requires
`stagingTesters/{uid}.enabled == true` and timestamp `expiresAt > request.time`.
Missing, malformed, disabled, expired or deleted entries fail closed. All client
roster reads/writes deny through the existing catch-all. A future scoped operator
alone manages the roster through trusted tooling; testers must never receive
Admin credentials or roster IAM permissions.

`firebase.admission.local.json` loads only this generated candidate on loopback
8086 with demo project `demo-taskly-rules`. Normal Firebase configs are unchanged.
The candidate is **not deployment-ready**: it retains the integrity blockers and
there is no approved staging project. It must never be deployed to production.
Generation performs no SDK/network operation. Emulator roster fixtures use only
the guarded loopback REST endpoint with emulator `Bearer owner`; these are not
live operator credentials or a remote management tool.

For later approved staging: pin a dedicated non-production project/web tuple and
origin in reviewed source, retain the inactive runtime gate, and begin with
deny-all rules. Operators provision synthetic `@example.test` accounts, audit
empty accounts, admit exact UIDs with short explicit expiry, and record a
revocation/cleanup owner. UID admission is the security boundary; the UI email
suffix is not authorization. Revoke by deleting the entry or setting enabled
false. Expiration uses request time independently of token refresh. Previously
downloaded/cached data cannot be recalled, and an already accepted request may
commit. Trusted service operations must recheck admission because Admin bypasses
rules. No automatic guest migration is added.

Firestore admission **does not restrict Firebase Auth account creation**. Hiding
signup is insufficient against direct Auth API calls. Before remote activation,
choose and verify a server-side policy: with Identity Platform disable end-user
account creation/deletion and use operator-provisioned users, or use an approved
`beforeCreate` blocking function to deny uninvited creation. Review providers,
linking paths, quotas and abuse exposure. This can require Identity Platform
upgrade/configuration and separate approval. No Auth policy/accounts are changed
here. Auth accounts may exist without Firestore admission; Auth disabling/token
revocation is separate from immediate roster revocation. Server-side Auth policy
remains an activation prerequisite, not something these emulator tests establish.

### Compatibility, changed files and validation

No runtime repository, schema migration, planner or UI change was necessary.
CRUD, reorder, Saved List replacement, cascades, Finish Day, session switching,
conflicts, offline failure and acknowledgment behavior keep their existing paths.
Invalid raw writes and root deletion newly deny; root deletion was already
unsupported by the repository. Existing inconsistent data can fail future writes;
there is no automatic repair. Whole-account deletion, archive replacement/editing,
reconciliation, imports, remote sync and automatic guest migration remain blocked.
Limits remain 350 indexed documents, 400 distinct old/new transaction paths and
200,000 manifest JSON characters. Large cases run with and without roster lookups.

Changed files: `firestore.rules`, `tests/emulator/firestore.rules.mjs`, `scripts/cloud-ui.mjs`,
`scripts/staging-admission.mjs`, `firebase.admission.local.json`,
`tests/staging-admission.test.js`, this plan and the lifecycle guide pointer.
Generated rules, logs, builds and browser reports remain ignored in `.firebase/`.

Reproduce (PowerShell, free emulator ports):

```powershell
npm.cmd test
firebase.cmd emulators:exec --config firebase.json --only firestore --project demo-taskly-rules "npm run test:rules"
node scripts/staging-admission.mjs
$env:TASKLY_TEST_ADMISSION = '1'
firebase.cmd emulators:exec --config firebase.admission.local.json --only firestore --project demo-taskly-rules "npm run test:rules"
Remove-Item Env:\TASKLY_TEST_ADMISSION
npm.cmd run test:cloud-ui
npm.cmd run build -- --outDir .firebase/phase471-normal
npm.cmd run build -- --mode cloud-test --outDir .firebase/phase471-cloud-test
npm.cmd run build -- --mode github --outDir .firebase/phase471-github
node scripts/check-isolated-build.mjs .firebase/phase471-normal
node scripts/check-isolated-build.mjs .firebase/phase471-cloud-test
node scripts/check-isolated-build.mjs .firebase/phase471-github
git diff --check
```

Execution results (2026-10-20):

| Check | Exact result |
| --- | --- |
| `npm.cmd test` | 78 passed, 0 failed, 0 skipped. |
| Canonical Firestore emulator | 35 discovered; 33 passed, 0 failed, 2 admission-only cases intentionally skipped. |
| Separate admission emulator | 35 passed, 0 failed, 0 skipped, including the entire large lifecycle suite. |
| Normal production / cloud-test production / GitHub Pages builds | All 3 succeeded, exit 0. Existing >500 kB JavaScript chunk warning remains. |
| Build isolation | 4 artifacts per build, 12 total passed. |
| Browser emulator workflows | Final run: 21 passed, process exit 0, zero runtime/interception errors and zero non-loopback attempts. All seven guest keys identical. |
| `git diff --check` | Passed; only Git's existing LF/CRLF conversion notices. |

Initial CLI execution was blocked by sandbox access to the installed Firebase
configuration; the local demo emulator suites then ran with execution permission.
The first browser run passed all 21 workflows (child exit 0) but its PowerShell
stderr capture reported outer exit 1. A diagnostic rerun then exposed an existing
CDP race on reload: an unhandled `Invalid InterceptionId.` cancellation aborted
after 10 passed workflows. `scripts/cloud-ui.mjs` now handles only exact CDP code
`-32602` / message `Invalid InterceptionId.` for paused-request release/failure,
as the held-hydration path already did; unexpected errors still enter the failing
error report, and non-loopback attempts remain recorded before blocking. No
application or security assertion was relaxed. The final run uses cmd.exe to
retain the native exit status. Logs: `.firebase/phase471-rules.log`,
`phase471-admission.log`, `phase471-ui.log`, `phase471-ui-final.log` (diagnostic
failure), and `phase471-ui-verified.log` (final).
Final JSON/screenshot: `.firebase/cloud-ui-1792527976279/report.json` and
`verified-ui.png`. No required validation category was omitted. Broader UI
coverage beyond the existing 21-workflow matrix and live Auth admission policy
remain untested, as documented above; no remote test was authorized or performed.
No supported lifecycle regression was observed. Test runners stopped their
emulators/browser/dev server. `CLOUD_SYNC_ENABLED` remains false,
`STAGING_WRITES_ENABLED` remains false and `APPROVED_STAGING_PROJECT` remains null.

Recommended next phase: locally design/prototype the trusted bounded mutation
boundary with direct aggregate writes denied, adversarial tests and audited fresh
account initialization. Resolve Auth policy, project/operator/IAM decisions and
remaining UI coverage before requesting remote provisioning/activation approval.

Primary references checked:
[rules conditions and access budgets](https://firebase.google.com/docs/firestore/security/rules-conditions),
[parent deletes preserve subcollections](https://firebase.google.com/docs/firestore/manage-data/delete-data),
[Admin access bypasses rules](https://firebase.google.com/docs/firestore/security/rules-structure),
[Identity Platform user management](https://docs.cloud.google.com/identity-platform/docs/concepts-manage-users),
[Auth blocking functions](https://docs.cloud.google.com/identity-platform/docs/blocking-functions).

---

# Historical Phase 4.7 — staging readiness and security validation

## Phase 4.7 decision — 2026-10-20

**NO-GO for requesting staging provisioning approval today.** Local validation is
complete, but passing tests do not resolve the confirmed same-owner integrity
gaps, approve their acceptance, or supply the project/IAM/admission decision
record. No project should be provisioned from this report. Staging access/writes
and production synchronization remain disabled. This section supersedes readiness
and pending-test statements below; Phase 4.6 and earlier evidence is historical.

Provisioning an empty project with deny-all rules is a distinct, potentially
approvable checkpoint A; it does not require every application feature to exist.
Before requesting it, record the intended project ID, region, billing/plan and
cost owner, scoped operator IAM, initial deny-all procedure, tester admission
design, cleanup owner, and explicit acceptance or remediation of the findings
below. These decisions have not been supplied or accepted by this local exercise.
Runtime/admission implementation and separate configuration, deployment and
synthetic-write approvals remain prerequisites for checkpoints B/C, rather than
claims that creating an empty project itself exposes application data.

### Scope and changed files

Inspected all five requested guides, actual lifecycle/account/repository/schema
and transport implementations, Firestore rules, isolated controller/runtime/UI,
Auth/environment guards, Vite graph boundary, staging/deployment contracts and
existing tests before adding coverage. Starting working tree was clean.

- `tests/emulator/firestore.rules.mjs`: 12 new cases, fresh synthetic UIDs for
  adversarial/boundary cases and independent SDK sessions for concurrency.
- `tests/account-data.test.js`: two new manifest size/rollback cases.
- This plan: findings, scope classification, admission proposal and decision.

No application implementation, rules, deployment configuration, guest keys,
credentials or environment files change. Rules were neither weakened nor
deployed. Known gaps remain explicitly blocked from remote activation.

### Adversarial results: server guarantees and confirmed gaps

The final **27/27** emulator tests exercise actual `firestore.rules` using SDK
transactions/batches, not a mock rules evaluator. Denial assertions check
`permission-denied`. Existing schema tests include a valid lifecycle mutation so
an unrelated missing revision does not mask their field checks. Three new
`KNOWN GAP` tests assert **acceptance** of malicious same-owner writes: they pass
because they reproduce a vulnerability, not because those writes are safe.

| Case | Actual enforcement / observed result |
| --- | --- |
| Cross-UID and unauthenticated document/collection reads, writes, deletes; nested tasks | Rules deny. All existing fixture families, including manifest, are covered. Forged `ownerId` cannot grant another UID access. |
| Missing/extra fields, forged IDs/version/ownership, malformed task fields and immutable metadata changes | Rules deny; server-rejected multi-document transactions leave valid companion writes and revision unchanged. |
| Missing revision participation, unchanged/stale/jumped revision, malformed manifest envelope, other lifecycle ID, reset/deletion | Rules deny. Same-owner increments must be exactly one; manifest creation must be empty revision zero. |
| Task not indexed, wrong order for a written task, indexed task without physical parent | Rules deny. Unknown collections and deeper task subcollections also deny. |
| Invalid date shape/range (`2026-13-01`, zero month, day 32, unpadded date) | Rules deny. **`2026-02-30` is accepted** by the regex; client calendar validation rejects it. |
| Manifest map contents / total document count | **Gap:** owner can write `arbitrary: 7`, duplicate task IDs, or 350 IDs under a nonexistent parent. Rules only bound parent map size to 349; they do not enforce the client's 350-document total, key/value schema or JSON character cap. Client rejects the tested malformed/oversized manifests. |
| Ordering bypass without rewriting tasks | **Gap:** manifest-only reversal succeeds while task orders remain unchanged. Client coherent load rejects the order mismatch. Rule order validation applies only to documents actually written. |
| Partial cascade | **Gap:** removing manifest membership and deleting a parent without children succeeds. The child remains readable to its owner; a subsequent client load sees an empty index and cannot discover it. No automatic adoption/repair is safe. |
| Dangling day reference / finished counts | **Gap:** owner can commit a nonexistent `currentListId` and finished metadata claiming five tasks when none exist. Rules accept; client relational verification rejects indexed inconsistent state. Date/timestamp strings are not fully semantically validated by rules. |

Firestore transaction atomicity prevents a rejected commit from partly applying.
It does not establish that an accepted forged manifest enumerates every real
document. Client transactions enforce complete **indexed** membership, contiguous
ordering, references, counts and CAS for supported operations; they cannot prove
absence of historical or malicious unindexed descendants. Owner-only rules are
authorization, not tester admission, and are not complete same-owner integrity.
Preferences/imports have separate rules and do not advance aggregate revisions.

**Hardening proposal, not implemented:** add a server-controlled staging roster
gate to every allowed owner path, validate real calendar days and required list
existence, and reject unsupported manifest content where feasible. These local
checks alone cannot establish exhaustive descendant cleanup or count consistency.
If arbitrary owner clients must be unable to corrupt aggregates, deny direct
aggregate/manifest client writes and move lifecycle planning to a trusted bounded
mutation service with authenticated UID/admission/revision checks. Do not assume
map-wide rule validation can be bolted onto the present schema at these bounds.
Such a service changes SDK transaction transport, authorization, deployment and
retry contracts; a versioned schema/rules rollout also makes older clients
incompatible. Re-run large transaction and rule-access-budget cases after any
hardening. No compatibility decision, service or stronger rule is deployed here.

For a trusted synthetic-only pilot the owner may explicitly accept the narrower
same-owner integrity boundary, with immediate stop/reconciliation on corruption.
That acceptance is pending; this report does not silently grant it. Broad or
untrusted tester access requires hardening first.

### Boundary and near-limit results

| Local case | Result and source of threshold |
| --- | --- |
| 350 indexed documents | Real SDK creates a Saved List with 348 tasks + parent + manifest, reads it, replaces metadata and cascades all children. Adding a 351st indexed document rejects without changing revision/state. **Client schema design**, not a Firebase platform limit. |
| Large Finished Days | Real SDK creates/reads/cascades 348-task archive (350 indexed docs), with completed count 174. Descendant collection verified empty after deletion. |
| Numerous nested collections | Real SDK seeds valid owner-protocol data with 174 one-task lists plus one empty list: 175 task collections/parents, 350 indexed docs. Client load succeeds; another parent rejects intact. Arbitrary deeper collection paths deny; recursive nesting is unsupported. |
| Replacement union 400 / 401 | 199 old and 199 disjoint new children + parent + manifest = **400 paths**, replacement succeeds. Next disjoint 200-task replacement needs **401**, rejects with original tasks/revision intact. **Repository application guard** on distinct declared read paths, not a claim about Firebase write limits. |
| Atomic Finish Day | 198 tasks succeed with **399 union paths** (`2N + 3`: manifest, retained day, new archive and both child sets). 199 tasks need 401 and reject; source tasks, revision and absent target/children are verified intact. Final index would fit, but transient union does not. |
| Repeated ordering | 12 alternating real SDK reorders preserve IDs and contiguous order; separate two-session race has exactly one revision winner. |
| 200,000 / 200,001 JSON characters | Unit schema test accepts exactly 200,000 and rejects 200,001. Long-ID snapshot rejection preserves the complete existing in-memory repository and revision. **Client JavaScript JSON character policy**, not byte size, rules enforcement or an emulator/platform byte-limit test. |

The 349-parent rules cap is separate from client indexed-document accounting.
350 includes manifest, parents and tasks; it excludes preferences, imports and
the user marker. A valid account can still exceed the 400-path union during
replacement/finishing. Byte size, request limits, transaction timing and rules
evaluation budgets can cause earlier backend failures. No live Firebase platform
quota, throughput or latency boundary was tested or inferred from these numbers.
The successful large emulator writes establish only the tested payload shapes.
No chunked fallback, partial cleanup or size-limit override was introduced.

### Concurrency, failures and UI confirmation

Independent Firebase app/transport sessions sharing a synthetic UID race with
the same displayed revision. Same-task edits, competing reorders, two Saved List
replacements, and simultaneous Finish Day each have exactly one winner and a
`taskly/conflict` loser. Assertions verify coherent membership/order, one archive,
empty active tasks and a single revision increment. Existing replacement versus
cascade and Finish versus edit races remain covered. Explicit stale retries cannot
overwrite current state or create a duplicate archive.

New failure cases simulate interruption **before submission** (revision/tasks
unchanged) and loss of acknowledgment **after a real emulator commit** (caller
rejects, authoritative reload shows one archive, stale retry rejects). These
faults are injected in the transport wrapper, not a physical process kill or
packet-loss test. No automatic application retry or idempotency ledger is claimed.
The safe response to an uncertain result remains reload and inspection of stable
IDs before deciding on a new intent.

A real replacement commit held before acknowledgment then invalidated by logout
rejects success publication; the committed data remains under the original UID
and Bob cannot read it. Logout uses the same permanent repository invalidation
as a UID switch. Unit/controller tests separately switch to another UID and
verify the next context receives neither stale data nor a success result.
Already-submitted commits are not cancelable by switching accounts.

Actual SDK offline transactions reject and recovery does not replay the rejected
operation. Real browser two-tab stale edits require explicit reload; offline save
shows failure with no false success/reconnect replay. Real rule denials propagate;
only a freshly observed changed revision normalizes a denial to a conflict.
The controller tests check failed/unconfirmed writes never become saved and that
mutations remain blocked until reload. Browser rapid-switch hydration and exact
seven-key preservation also pass.

Not executed: physical browser/process termination mid-RPC, real network packet
loss, prolonged offline sessions, large browser-rendering performance, arbitrary
multi-device stress, or any remote staging/production case. Injected lost-ack
testing is evidence for the uncertain-result contract, not all transport failures.

### Smallest practical tester admission design (proposal only)

Use a staging-only **operator-managed UID allowlist document per synthetic tester**
outside the user namespace. Deny all client writes to that collection, including
by the tester; allow management only through separately authorized staging IAM.
Every allowed user read/list/create/update/delete must require both matching UID
and an active roster record with an unexpired deadline checked against
`request.time`. Missing, expired, disabled and other-UID records must deny. Ensure
no alternate parent/nested/import/preference rule bypasses the gate. Keep this
proposal separate from production rules until staging-specific deployment exists.

The operator approves roster/UIDs and creates fresh synthetic accounts; distribute
access privately and omit signup from the future staging UI. **Omitting signup,
email suffix checks, Auth domains and private URLs do not restrict the public Auth
account-creation API.** A created Auth identity must never authorize Firestore
without operator enrollment. For the minimum pilot, explicitly accept possible
unenrolled Auth identities, or keep public Auth disabled until a reviewed
server-enforced account-creation restriction exists. If hard signup prevention is
required, validate an appropriate server-side Auth creation gate and its project
support/cost before admission; no such control was configured or verified here.
UID allowlisting enforces data admission even if somebody obtains an Auth token.

Onboarding requires a fresh-account provenance/descendant audit, expiry, case IDs,
responsible operator and test window before explicit empty initialization. Retain
the proposed 25 active-task / 100 indexed-document pilot cap as an **operator
restriction**, not a claimed server limit. No guest import, personal tasks, legacy
data or manual manifest edits. Remove access by disabling/deleting the roster
record; new server requests must fail without waiting for token renewal. Also
disable the Auth identity/revoke sessions under separately approved procedures.
Revocation cannot erase data already downloaded or undo committed writes. For an
incident use a separately approved staging deny-all rollout; Admin/IAM access
requires separate revocation because rules do not constrain privileged operators.

Before tester access, emulator-test allowlist self-enrollment denial, unauthorized
and expired identities, every nested path, immediate revocation with an existing
token, and bounded rule-access costs. These tests are pending implementation, not
included in the 27 tests against current owner-only rules.

Name a cleanup operator and inventory project/UID/descendants before admission.
Proposed retention remains cleanup within seven days after review and redacted
evidence for 30 days. Explicit staging-only cleanup approval and verified recursive
enumeration/deletion are required; deleting Auth or the user marker is insufficient.
No cleanup job, accounts, IAM grants or admission documents were created.

### Functionality classification and restrictions

| Unresolved area | Classification | Pilot restriction / release requirement |
| --- | --- | --- |
| Whole-account deletion | Safe to defer with explicit restrictions | Keep UI/API operation blocked. Before staging access, have an approved operator cleanup inventory/procedure. Before production activation, resolve account deletion and descendant retention requirements. |
| Existing cloud reconciliation | Required before production activation | Fresh audited synthetic accounts only in staging. No legacy adoption/repair; orphans cannot be ruled out by parent listings. Any existing account requires trusted descendant audit and reviewed reconciliation before use. |
| Guest-to-account migration | Safe to defer with explicit restrictions | No import/migration in pilot or initial cloud activation. Requires separately consented, revision-aware deduplicated workflow before offering migration; existing pure mapper is not an executor. |
| Ambiguous legacy Finished Day dates | Safe to defer with explicit restrictions | No legacy imports. Explicit source-matched historical date review required before any later legacy migration; never infer a timezone/date. |
| Cloud archive editing | Safe to defer with explicit restrictions | Read-only archive UI; no replacement/edit workflow. A later feature requires its own immutable-date/membership/count design. |
| Oversized accounts/snapshots | Required before staging (safety policy now locally validated) | Reject intact at existing caps; pilot lower operator caps. Accept bounded feature scope before access. Production must explicitly accept caps or design a partitioned protocol; no split destructive batches. |
| Same-owner integrity and admission | Required before staging access | Owner must accept a trusted synthetic pilot's limited guarantee or harden it; enforce UID admission before any data access. Not resolved by passing owner-only rules tests. |

### Exact local validation evidence

| Check | Final result |
| --- | --- |
| `npm.cmd test` | **77/77 passed**, 0 failed/cancelled/skipped; `.firebase/phase47-unit.log`. |
| `firebase.cmd emulators:exec --config firebase.json --only firestore --project demo-taskly-rules "npm run test:rules"` | **27/27 passed**, 0 failed/cancelled/skipped, exit 0; `.firebase/phase47-rules.log`. Local 8080, real rules and SDK. |
| `npm.cmd run test:cloud-ui` | **21/21 browser workflow checks passed**, exit 0; `.firebase/phase47-ui.log`, `.firebase/cloud-ui-1792526441407/report.json`. Auth 9099, Firestore 8085, Vite 5174; demo-only synthetic accounts. No unexpected requests/runtime exceptions. |
| `node scripts/check-local-browser.mjs` | Passed development startup/Settings/reload: **0 Firebase requests, 0 runtime exceptions**, all seven guest values unchanged; `.firebase/local-safety-1792526446751/report.json`. External font requests blocked before transmission. |
| `npm.cmd run build -- --outDir .firebase/phase47-normal` | Passed, normal production entry. |
| `npm.cmd run build -- --mode cloud-test --outDir .firebase/phase47-cloud-test` | Passed, normal entry/Auth disabled; not a cloud UI release. |
| `npm.cmd run build -- --mode github --outDir .firebase/phase47-github` | Passed, `/Taskly/` base retained. |
| `node scripts/check-isolated-build.mjs <each output directory above>` | **4/4 text artifacts per build, 12/12 total**; actual Vite graph exclusion passes in all three builds. |
| `git diff --check` | Passed. |

Initial sandbox CLI attempts failed local configstore access; the normal browser
attempt timed out enabling CDP. Final successful runs used approved local process
access. No failed attempt is counted as a passing test. The earlier 25-test rules
run also passed; 27 is the final expanded suite. Existing >500 kB chunk warnings
remain. Expected emulator permission denials and browser-disconnect diagnostics
are not unexpected application errors. Runners shut down their own servers and
emulators. No new dependencies were installed.

Isolation review confirms fixed pre-initialization emulator identity/loopback
endpoints and no live fallback, staging contract rejection of `taskly-maya` and
all unpinned projects, no staging runtime/write activation, and no Firestore
wiring in normal startup. Unit mocks preserve production Auth signup/login/logout/
reset/observer behavior; no real production authentication was exercised. The
normal browser case verifies guest startup, not a live restored production login.
Graph/artifact checks exclude isolated/staging runtime from all builds. Pure
deployment-plan tests reject missing/ambiguous targets, aliases, wrong scope and
missing explicit production confirmation without invoking deployment. Raw CLI/
Admin access is outside those application safeguards and needs scoped IAM.

### Approval evidence and next implementation step

Next phase: **local staging admission and integrity decision/hardening**. Record
the owner's integrity threat model and provisioning metadata; implement a separate
locally tested staging UID gate with expiry/revocation and an Auth signup decision.
If accepting trusted-client integrity is insufficient, design the trusted mutation
service before implementing a live runtime. Test all gate paths and large rule
budgets locally. Keep project pin null and writes false during this work.

Only after reviewing that evidence should a separate, concrete checkpoint-A
project-creation-only permission request be prepared. Initial deny-all, cost/IAM,
operator and cleanup scope must be reviewable. Before later remote access/writes,
require the exact pinned web tuple, isolated runtime/network proof, enforced roster,
signup policy, approved bounds/deferrals, fresh synthetic account provenance and
reviewed rollback/cleanup procedures. Each remote configuration, account creation,
rules/Hosting deployment and bounded write action remains separately authorized.

**No remote Firebase data, production Auth, Firebase project/account creation,
rules/Hosting deployment, credential changes, user-data migration, commit or push
occurred.** All data mutations were synthetic local demo emulator operations.
Production/staging cloud writes remain disabled. Stop here after local validation.

---

## Historical Phase 4.6 record

## Current status — 2026-10-20

Phase 4.6 implements local safeguards only. **NO-GO for live staging access or
writes remains in force.** See [the developer guide](firebase-local-safety.md) for
the authoritative mode matrix, environment contract and commands. The Phase 4.5
audit below is retained as historical evidence; statements there that environment
guards are only proposed, that development automatically uses production Auth, or
that `.firebaserc` has a production default are superseded by this section.

- Development defaults to local guest use. Deliberate production Auth requires
  both explicit production identity and the local Auth opt-in. Production/github
  builds retain optional production Auth, validated before SDK initialization;
  the existing default app must match all four web options. No Firestore is wired
  into normal startup. The dormant remote repository factory now always refuses.
- Emulator configuration is fixed, explicitly identified and validated before
  initialization; both loopback connections precede operations. Startup config
  errors are visible, and emulator account actions require `@example.test` emails.
- Unknown/custom/staging modes fail at Vite configuration. Every build uses the
  normal entry, and cloud-test builds disable Auth. A bundler graph guard and
  artifact scanner reject isolated/staging code in normal release artifacts.
- Tooling-only `scripts/staging-contract.mjs` specifies explicit staging identity,
  a consistent dedicated web tuple and a source-pinned project. The approved
  project is currently null, activation always refuses and writes remain false.
  No live staging SDK initializer or entry point exists.
- `.firebaserc` retains the production alias but removes its default. The Hosting
  deployment wrapper requires literal project, Hosting scope and a second literal
  production confirmation. Staging/rules/ambiguous deployments are refused by the
  wrapper. Pages CI and Hosting configuration are unchanged; no deployment ran.

Earlier read-only inspection found a trailing double quote in
`VITE_FIREBASE_PROJECT_ID`. The final recheck below finds it already corrected:
no raw/parsed trailing quote, expected project identity, and a complete tuple
accepted by the local guard. This validation changed no environment or credential
value. Production Auth remains supported and was verified with mocks; no real
production login was performed.

Validation evidence is recorded below after the Phase 4.5 history. Remaining
blockers still include approved project/web tuple and tester admission, pending
adversarial rules/bounds/UI cases, isolated staging runtime, scoped IAM and
separate approvals for provisioning, remote Auth/configuration, rules/Hosting and
bounded synthetic writes. Existing integrity, concurrency, historical-data and
deletion limits in this plan are not resolved by configuration guards. The next
step is to review the final evidence and tester policy below and resolve the
remaining security/limit/admission decisions before seeking project-creation
approval. The existing Phase 4.4 browser matrix has now been rerun successfully.

## Final validation and readiness decision — 2026-10-20

This section supersedes earlier pending-browser and malformed-local-project
statements. Previous results below are retained as historical evidence.

### Diff and local configuration review

Reviewed Phase 4.6 commit `b3caa4d` against parent `123ffd7` and the working diff.
The starting working tree was clean. No confirmed application safety regression
was found, so no application code or Firestore rules were changed in this pass.
Only the browser runner and the two safety/staging guides change.

- Guest storage/repository, task/list persistence, `src/main.js`, data boundary,
  and all seven legacy key definitions are unchanged by Phase 4.6. No automatic
  migration, import, account-to-guest fallback or user-data rewrite was added.
  Existing unit coverage and the browser's exact raw seven-key comparison pass.
- Normal development refuses Auth without the explicit opt-in. Optional normal
  production/github Auth still supports subscribe/signup/login/logout/reset;
  local mocked tests validate the interface and matching default-app options.
  No production login or credential verification request was performed.
- Normal startup has no Firestore repository or listener wiring. The dormant
  remote factory always rejects; source synchronization remains false. Emulator
  startup validates the fixed demo identity/endpoints before SDK initialization.
  Staging has no runtime, approved project or write activation path.
- GitHub Pages CI, `firebase.json`, Hosting output configuration and
  `firestore.rules` are unchanged. The intentional `.firebaserc` change removes
  the default project and retains an explicit production alias. The new wrapper
  requires exact project, Hosting scope and literal production confirmation.
  Raw CLI/IAM access remains outside the wrapper's enforcement boundary.
- Read-only `.env.local` inspection and Vite `loadEnv('production', ...)` found
  `VITE_FIREBASE_PROJECT_ID` without a trailing quote, matching the expected
  production identity. The complete tuple passes the local format guard. The
  previous malformed value is no longer present; **no manual correction is
  currently required**. If it recurs, manually remove the unmatched trailing
  quote; safe format example: `VITE_FIREBASE_PROJECT_ID=your-project-id`.
  `git check-ignore .env.local` confirms exclusion and the file is untracked.
  No values or credentials were printed or rewritten; ownership was not checked
  against a remote service.

### Executed checks and evidence

All final commands below exited 0, with no failed/skipped unit or rules tests.
Build artifacts use ignored directories and were not opened as production apps.

| Check | Final result |
| --- | --- |
| `npm.cmd test` | **75/75 unit tests passed**, 0 failed/cancelled/skipped. Includes all seven environment/deployment tests and existing persistence, Auth, controller and lifecycle tests. |
| `firebase.cmd emulators:exec --config firebase.json --only firestore --project demo-taskly-rules "npm run test:rules"` | **15/15 Firestore emulator tests passed**, 0 failed/cancelled/skipped; loopback 8080. Log: `.firebase/phase46-final-rules.log`. Expected authorization denials are asserted test cases. |
| `npm.cmd run test:cloud-ui` | **21/21 browser workflow checks passed** on real local Auth 9099 / Firestore 8085 and Vite 5174, using only `demo-taskly-isolated`, synthetic accounts and a disposable Chromium profile. Log: `.firebase/phase46-final-ui.log`; report: `.firebase/cloud-ui-1792525848866/report.json`; inspected screenshot: `verified-ui.png` in that directory. |
| `node scripts/check-local-browser.mjs` | Separate development startup/Settings/reload scenario passed: **0 Firebase requests, 0 runtime exceptions**, seven guest values unchanged. Report: `.firebase/local-safety-1792525897738/report.json`. External font requests were blocked before transmission. |
| `npm.cmd run build -- --outDir .firebase/phase46-final-normal` | Passed; normal production entry. |
| `npm.cmd run build -- --mode cloud-test --outDir .firebase/phase46-final-cloud-test` | Passed; normal entry, Auth disabled, isolated runtime excluded. |
| `npm.cmd run build -- --mode github --outDir .firebase/phase46-final-github` | Passed; `/Taskly/` base retained. |
| `node scripts/check-isolated-build.mjs <output directory>` for each of those three builds | **4/4 text artifacts passed per build**; actual bundler graph guard also passed in each build. |
| Pure `deploymentPlan()` and environment tests within the unit suite | Missing project, missing production confirmation, staging targets, rules scope and extra arguments rejected; exact production Hosting plan returned without CLI invocation. Production/remote emulator config rejected before initialization, with zero fetch calls; staging activation refused; unknown Vite modes refused. |
| `git diff --check` | Passed. |

The browser checks cover guest restoration; synthetic signup and explicitly
initialized empty accounts without migration; task creation, editing, completion,
pointer drag reordering and deletion; Saved List creation/loading; account theme
and refresh persistence; Finish Day and Finished Days view with archive editing
blocked; calendar navigation; two-tab revision conflict and explicit reload;
offline save rejection and reconnect without replay; logout/login and two-account
isolation; rapid UI switching with delayed Firestore hydration; exact preservation
of all seven guest values; and zero non-loopback page requests/runtime exceptions.

The added rapid-switch check holds Firestore requests while Bob loads, signs out
before hydration finishes and returns to Alice. Both loading views are empty;
the final UID/theme belong to Alice and Bob's task is absent. Two intercepted
requests were canceled by sign-out; the runner accepts only the precise CDP
`Invalid InterceptionId` cancellation when releasing those requests. Unit tests
separately exercise late factory/read/write completion. The browser case does not
claim that a canceled network response was delivered to the controller.

Ports 5174/8085/9099 were free at preflight; no existing server was reused and no
unrelated process was terminated. No port/configuration change was necessary.
Emulator commands shut down their services and runners closed their own browser
and Vite processes. Initial sandbox attempts hit CLI configstore/browser access
restrictions and were rerun with permission. The first extended UI run stopped
after 18 checks due to the canceled-request harness error; it was not counted as
a passing suite. The corrected full run above passed all 21 checks. No dependency
installation was needed. Builds retain the existing JavaScript chunk >500 kB
warning; that warning is not a test failure.

### Proposed staging tester admission policy

This is a policy for review, not implemented access control or permission to
create accounts, provision services, deploy rules or write remotely.

1. **Authorized testers:** the owner must explicitly approve a named roster,
   assigned synthetic UIDs, responsible operator and test window. Use fresh
   synthetic test identities only, with no personal identifiers, reused personal
   passwords, personal tasks or existing guest/account data. No invitations,
   grants or account creation were performed here.
2. **Separate backend and admission enforcement:** use an exact reviewed and
   pinned non-production Firebase project/web tuple, separate origin/profile,
   staging-only IAM and initial deny-all Firestore rules. Before admitting any
   tester, implement and locally verify a server-controlled UID admission gate
   or an explicitly reviewed equivalent for Auth/Firestore. Restrict account
   provisioning to the approved operator. Current owner-only rules admit every
   authenticated UID to its namespace; neither `@example.test`, a private URL,
   authorized domains nor the web API key enforces the tester roster. No rules
   changes or admission implementation are included in this pass.
3. **Allowed operations after separate write approval:** audited fresh empty
   account initialization; synthetic task CRUD/reorder; bounded Saved List
   create/load/replace/delete; Finish Day, read-only archive viewing and supported
   archive cascade deletion; calendar, theme, refresh, Auth switching, two-tab
   conflict and offline-recovery checks. Use displayed revisions, stable IDs and
   explicit authoritative reloads. Initially cap each account at 25 tasks and
   100 total manifest-indexed documents, below existing client limits; this is an
   operator policy until staging enforces the reviewed caps. Do not test larger
   remote boundaries without a separately approved case.
4. **Disabled operations:** production data/services/synchronization; arbitrary
   signup or unapproved UIDs; personal/guest imports, automatic migration, legacy
   account adoption or repair; whole-account deletion; archive editing/replacement;
   unsupported direct repository mutations, manual manifest edits, bulk writes,
   automatic conflict retries and offline replay. No flag overrides these gates.
5. **Retention and cleanup:** retain only synthetic case IDs, bounded records and
   redacted evidence through the approved test window. Proposed default: remove
   synthetic backend records and test accounts within seven days after review,
   subject to explicit staging-only cleanup approval; retain redacted evidence
   for 30 days. Record the exact project/UID/path inventory, owner and deadline
   before admission. If an incident needs longer retention, freeze writes and
   obtain a dated extension. Cleanup must enumerate descendants and verify
   removal; deleting an Auth account/user marker is not recursive cleanup. No
   existing cleanup executor or automatic deletion is assumed.
6. **Stop conditions:** immediately stop edits/test clients for any unexpected
   destination/write, guest/other-UID leakage, unexplained permission denial,
   partial state, revision/count/reference mismatch, false Saved indication,
   uncertain acknowledgment or reconnect replay. Expected conflict/offline/rules
   denials in an approved case are evidence, not permission to retry blindly.
   Preserve synthetic IDs/revisions and redacted diagnostics; notify the owner.
   Resume only after authoritative inspection and explicit review. Use a
   separately approved restrictive-rules rollback if remote access must be revoked;
   never repair automatically or consult production as a recovery source.

### Remaining blockers and approval decision

The requested local validation is complete. **NO-GO today for requesting
project-creation approval as an unqualified readiness decision.** First review
and record the exact project/region/plan/cost ownership, scoped IAM, admission
enforcement design and acceptance or remediation of the known same-owner
integrity limitations. The proposed tester policy has not itself been approved.
The adversarial manifest/orphan and near-limit rules matrix remains unexecuted;
15 existing emulator tests and 21 UI checks do not establish those guarantees.
Resolve those tests or explicitly approve deferring them while provisioning
remains deny-all and no tester/data operations are permitted.

After that decision record is reviewed, the owner can consider a narrowly scoped
**project-creation-only** request (checkpoint A), with deny-all initial access.
Creating an empty project is distinct from readiness for staging writes; missing
staging runtime and server-enforced admission are implementation blockers for
access/writes, not claims that provisioning itself changes user data.

No staging runtime or approved project exists and writes remain disabled. Remote
configuration/Auth accounts, rules deployment (checkpoint B), Hosting deployment,
and bounded synthetic writes (checkpoint C) each require their own explicit scope
and approval. Production access, synchronization and migration still require
checkpoint D. Staging testing remains **NO-GO** until those applicable gates pass.

No real Firebase project/account was created or connected, no production Firebase
user data was read/written/listened to, no rules or Hosting was deployed, no
credentials/user data were changed, no migration occurred, and no commit or push
was made. All account/data mutations in this validation were local synthetic demo
emulator operations. Production and staging cloud writes remain disabled.

## Historical Phase 4.5 audit

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

## Initial Phase 4.6 validation — 2026-10-20 (historical)

| Check | Actual result |
| --- | --- |
| `npm.cmd test` | **75/75 passed**, 0 failed/skipped. Includes configuration, mocked production Auth, invalid emulator zero-initialization/zero-fetch, inactive staging, module-graph and pure deployment-plan checks; existing storage/backup/lifecycle tests pass. |
| `firebase.cmd emulators:exec --config firebase.json --only firestore --project demo-taskly-rules "npm run test:rules"` | **15/15 passed**, exit 0, local Firestore at 127.0.0.1:8080. Expected rules denials are intentional test cases. |
| Same emulator command using `firebase.isolated.json` | Could not start because 8085 was already occupied. Existing processes were not stopped; successful rules run used the standard local port above. |
| `npm.cmd run build -- --outDir .firebase/phase46-normal-build` | Passed. |
| `npm.cmd run build -- --mode cloud-test --outDir .firebase/phase46-cloud-test-build` | Passed; normal entry and disabled Auth. |
| `npm.cmd run build -- --mode github --outDir .firebase/phase46-github-build` | Passed; existing Pages base preserved. |
| `node scripts/check-isolated-build.mjs` against each of those three output directories | **4/4 text artifacts passed per build**; no isolated/staging markers. All three builds also passed the actual module-graph guard. |
| `node scripts/check-local-browser.mjs` | Passed with installed Chromium and disposable profile: normal development startup, Settings and reload; **0 Firebase requests, 0 runtime exceptions**, seven guest raw values unchanged. External font requests were blocked before transmission. Report: `.firebase/local-safety-1792525487529/report.json`. |
| Full `scripts/cloud-ui.mjs` with the existing verified demo emulator endpoints | Could not start because strict Vite port 5174 was already occupied. Full Phase 4.4 UI workflows were **not rerun**; the separate normal-startup browser check above passed. |
| `node scripts/firebase-deploy.mjs --project staging` | Expected exit **1**, refused before CLI invocation; no deployment ran. Exact approved Hosting argument plan is tested without executing it. |
| Existing `.env.local` read-only production validation | Expected refusal: parsed project has a trailing quote. Manual correction required; no values changed. |
| `git diff --check` | Passed. |

Builds retain the existing >500 kB JavaScript chunk warning. The Firebase CLI
initially required access outside the sandbox to its local configstore; only
demo-project emulator commands ran with that access. Browser execution also used
local permission escalation. Initial browser harness attempts encountered a
locked watched profile, unavailable sandbox browser connection, and a source-file
false positive in the request classifier; the final run above passed after the
harness corrections. No additional dependencies were installed.

Changed files: `.env.example`, `.firebaserc`, `package.json`, `vite.config.js`,
`src/js/auth/{environment,firebase,index}.js`, `src/js/firestore/firebase.js`,
`src/isolated/{config,firebase,main}.js`, `scripts/{firebase-deploy,staging-contract,
check-local-browser,check-isolated-build}.mjs`, `tests/environment.test.js`,
`docs/{firebase-local-safety,firebase-staging-plan,isolated-cloud-testing}.md`.
`firebase.json`, `firebase.isolated.json`, Pages CI, Firestore rules, seven guest
keys, actual `.env.local`/credentials and all user data remain unchanged.

No production/staging Firestore or remote deployment was accessed. No real
Firebase accounts or project were created, no synchronization was enabled, no
user data was migrated/uploaded/deleted, and no commit or push was made. Local
emulator data changes were limited to the synthetic demo rules suite.
