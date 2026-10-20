# Phase 4.3: cloud lifecycle safety

For current local rule hardening, enforceable admission experiments and remaining
same-owner integrity blockers, see [Phase 4.7.1 staging plan](firebase-staging-plan.md).
The new rules validate real calendar days, written-parent membership, written-day
list targets and written-archive indexed totals, and deny user-root deletion.
They do not prove manifest completeness or malicious-owner cascade integrity.
Remote synchronization remains disabled; the historical protocol below is unchanged.

[Phase 4.4 isolated cloud testing](isolated-cloud-testing.md) adds a separate
emulator-only UI, displayed-revision task arguments and atomic UI copy/save
operations. Production synchronization and all limits below remain unchanged.

Production synchronization remains **disabled**. No application startup path
creates an account repository or initializes cloud lifecycle state. This phase
changes dormant cloud modules, local rules, tests and documentation only. The
guest UI, backup/recovery, Auth UI and all seven localStorage keys are unchanged.
No production database was read, written, migrated or deleted; nothing was
deployed, committed or pushed.

## Versioned membership and transaction boundary

The additional document `users/{uid}/lifecycle/state` has schema version 1,
`ownerId`, a nonnegative integer `revision`, and `parents`: a map from relative
parent paths (`days/{date}`, `savedLists/{id}`, `finishedDays/{id}`) to their
complete, ordered task-ID arrays. IDs remain stable. The manifest is retained
even after the last parent is deleted, so deletion/recreation cannot reset the
revision and make an old request valid again.

`data/lifecycle.js` reads the manifest from the server, declares its complete
bounded document set, then reads those documents **and the manifest** in one SDK
transaction. A mutation checks the captured revision inside every transaction
attempt, validates membership, order, references and Finished Day counts, applies
a pure in-memory change, and writes only changed documents plus the incremented
manifest. Removed documents are deleted in that same commit. There is no series
of partial batches, background cleanup job, full-collection overwrite or
listener-driven write. Read-only `loadAccount()` uses the same coherent
transactional view and returns `{ confirmed, revision, aggregates }`.

The conservative initial implementation serializes all aggregate mutations on
one account revision. Unrelated changes can therefore conflict, but cannot
silently invalidate a stale ordering, snapshot or delete request. A conflict
requires a fresh view and a deliberate retry. Task edit/completion operations are
field intents based on the server state at invocation; callers wishing to protect
an earlier editing view should add a displayed-revision contract before wiring
such an editor. Reorder, replacement, cascade and Finish Day already require that
contract.

Preferences remain targeted server-confirmed single-document transactions and
do not advance the aggregate revision. Auth/session isolation and the existing
read-only, server-only listener metadata filtering remain intact.

## Supported operations and revision contract

Use the revision returned by **the view displayed to the user**. Do not fetch a
fresh token merely to force a stale destructive intent through.

| Operation | Behavior |
| --- | --- |
| `loadAccount()` | Consistent account view and revision; no mutation |
| `reorderTasks(dateKey, ids, expectedRevision)` | Exact complete membership required; writes contiguous zero-based order and manifest order atomically |
| `createTask(dateKey, task, position)` | Inserts at a valid position, preserving all IDs and updating shifted orders in the transaction |
| `deleteTask(dateKey, id)` | Removes one task and normalizes remaining orders atomically |
| `saveList(list)` | Creates a new parent and snapshot; rejects existing/untracked documents |
| `replaceSavedList(list, expectedRevision)` | Replaces metadata and all task membership in one transaction; retains list ID/references and immutable creation time; deletes removed task documents |
| `deleteSavedList(id, expectedRevision)` | Deletes every indexed child and parent, and clears all dated references in the same commit |
| `deleteDay(dateKey, expectedRevision)` | Deletes every indexed child and parent in one commit |
| `deleteFinishedDay(id, expectedRevision)` | Deletes every indexed snapshot task and parent in one commit |
| `finishDay(dateKey, { id, createdAt, order }, expectedRevision)` | Derives the snapshot exclusively from transaction-read tasks; creates finished metadata/tasks, deletes active tasks and clears the current-list reference atomically |

Finish Day retains the active day metadata with an empty membership list. It
preserves each task's ID, text, completion state and order; counts reflect the
original states rather than an all-completed animation. Its `dateKey` and `date`
are the explicit selected local YYYY-MM-DD key, independent of UTC/device timezone.
Caller-supplied snapshot tasks or conflicting date metadata are not accepted.

Snapshot replacement and Finish Day never regenerate task IDs. List references
refer to the stable parent ID, while active and archived task documents remain
independent snapshots. Saved List creation time and Finished Day historical
date/creation fields remain immutable.

## Failures, retries and stale sessions

All successful mutations resolve only after server commit and a final active
session check. Offline transactions fail without a local write queue. Other
Firebase errors propagate; nothing falls back to guest data or announces sync.
The SDK adapter performs a server-only document read before submitting each
transaction: SDK transaction RPCs can otherwise bypass the streaming state set
by `disableNetwork()`. Transaction reads and revision checks still provide the
actual concurrency guarantee; the extra read only enforces the offline policy.
Application errors include `taskly/conflict`, `taskly/integrity`,
`taskly/uninitialized`, `taskly/reconciliation-required`, `taskly/ambiguous-date`
and input/confirmation errors. Limits and schema errors also reject the promise.

Firestore can evaluate `getAfter` rules against a competing committed revision
before its SDK transaction callback retries. A rules denial/abort is normalized
to `taskly/conflict` only if a new server read proves the revision changed.
Genuine permission denials retain their error. Failure to read that diagnostic
state preserves the original error, subject to the active-session check.

An operation that fails before commit leaves **all** affected documents unchanged;
retrying with the same revision is safe if the account still has that revision.
Once committed, the old revision is invalid, including after parent recreation.
If acknowledgment is lost, reload authoritative state: confirm the supplied
Finished Day/list ID or absence of the deleted parent. Do not manufacture a new
snapshot ID and replay a stale intent. There is no automatic destructive retry
or unbounded idempotency journal.

Logout, pending Auth operations and UID switching permanently invalidate the
repository. Late reads, transaction retries and listener callbacks cannot publish
old-account data. A request already submitted cannot be canceled and may commit
under its original UID; its late acknowledgment cannot report success into a new
session. A new session requires a new repository, even for the same UID.

## Necessary rules changes (local only, not deployed)

The deployed Phase 4.2 rules neither allow the new manifest nor prevent legacy
aggregate writes from bypassing it. Local `firestore.rules` now:

- Allows owner-only manifest reads, empty revision-zero creation and exactly-one
  revision increments; manifest deletion/reset is denied.
- Requires a manifest revision advance in the same commit as any day, list,
  finished parent or task mutation. A create/update must be indexed; a deletion
  must remove membership.
- Requires task parents to exist after the commit and task order to match the
  manifest's ID at that position.
- Preserves existing document shape, immutable-field, ownership and deny-all
  checks. Preference/import behavior is unchanged.

This prevents ordinary older clients from silently bypassing the version protocol.
Security-rule document reads are shared/cacheable across task writes; an emulator
test replaces and deletes a 25-task snapshot to exercise the access budget.
Rules tests supply a valid protocol commit when testing malformed document fields,
so those tests do not pass merely because the manifest write was omitted.

These rules protect account boundaries and require participation in the protocol.
They do not prove arbitrary map contents, enumerate descendants, or prove every
child deletion in a deliberately forged owner-authored manifest mutation. The
application transaction planner performs exhaustive indexed-child deletion and
reference validation. All supported clients must use this planner; manual/admin
corruption requires reconciliation, not automatic repair. No claim is made that
an owner cannot intentionally corrupt their own database through a custom client.

The current production rules were **not** replaced. They deny the new manifest
path, so Phase 4.3 lifecycle operations cannot run there even if explicitly called.
Test-project rules must be reviewed and separately deployed before remote isolated
account UI testing. No deployment was performed by this implementation.

## Legacy Finished Day date review

`data/legacyFinishedDays.js` contains pure, caller-owned-data utilities:

1. `inspectFinishedDayDates(records)` identifies resolved date keys/date-only
   records, timezone-qualified timestamp-only records needing review, and invalid
   or conflicting records. It never derives a local day from a timestamp.
2. `resolveFinishedDayDates(records, decisions)` returns detached copies only
   after every ambiguous record has an explicit decision containing `id`, the
   unchanged `originalDate`, a valid original local `dateKey`, and `reviewed: true`.
   The reviewer must establish that key from their own historical context. No
   timezone or timestamp-prefix guess is substituted.
3. Missing, duplicate, stale-source or conflicting decisions fail closed. Invalid
   records need separate manual investigation. Original timestamps, IDs and tasks
   are retained; no storage or Firestore writes occur.

No actual local/production records were inventoried or changed by this task. The
utility provides the explicit inventory and review strategy for a later opted-in
workflow. The existing import mapper is still a pure legacy planning utility; it
does not construct a lifecycle manifest and must not be executed as an import
against the new rules. No local migration/import execution path is enabled.

## Bounds and disabled cases

- A manifest indexes at most **350 documents total**, including itself, parents
  and tasks, and is limited to 200,000 JSON characters by client validation. Every
  operation reads that bounded set; large histories and heavily concurrent
  accounts need a later partitioned revision protocol.
- The union of old/new documents in a transaction is capped at **400**. A large
  replacement can fail this cap even when its final state fits. Firestore's own
  byte/request/rules limits may reject smaller operations. No partial fallback or
  chunked destructive cleanup is attempted.
- Whole-account/user deletion and Finished Day snapshot replacement remain
  disabled/not exposed. Direct parent `remove()` remains blocked; only the guarded
  cascade path can remove parents, with all indexed children in the plan.
- Existing/uninitialized cloud accounts are not adopted automatically. The explicit
  `initializeEmptyAccount({ confirmedEmpty: true })` is only for an **audited empty
  account**, and refuses visible existing parents or an existing manifest.
  Client collection listings cannot discover historical orphan subcollections
  under missing parents: an existing account requires a separate trusted audit,
  including descendants, before claiming it is empty. No reconciliation executor
  is supplied or enabled.
- The application does not infer completeness from a corrupt manifest. Missing
  indexed documents, wrong order/counts or dangling references block operations.
  Unknown historical descendants outside an index must be resolved by that audit.

These are explicit disabled cases, not invitations to split a destructive
operation across batches or bypass a conflict with a newer revision.

## Startup and next phase

`CLOUD_SYNC_ENABLED` remains the source-level constant `false`.
`main.js`, `boundary.js`, guest modules and Auth startup wiring are unchanged in
this phase. Normal startup—including an existing authenticated session—performs
**zero Firestore reads, writes or listeners**. There is no Synced indicator.

Before isolated account UI testing, create fresh audited test accounts in the
emulator (or a separately approved isolated Firebase project with reviewed rules),
explicitly initialize lifecycle state, and add an account UI adapter that clears
rendered state synchronously on identity changes, carries displayed revisions,
shows conflicts/offline failures, and never uses local guest data as fallback.
Test large-limit rejection, two devices, logout during writes, all themes and
uncertain commit acknowledgments. Do not simply flip the cloud flag.

Before eventual production activation, approve the bounded-account limitation or
implement a scalable protocol, audit/reconcile any preexisting cloud data,
complete account UI validation and obtain explicit approval for both rules
deployment and synchronization activation. Guest import requires separate explicit
consent and a reviewed date-resolution/import protocol.

## Changed files and verification

| File | Change |
| --- | --- |
| `src/js/data/lifecycle.js` | Manifest CAS, coherent reads, targeted atomic plans, initialization and conflict handling |
| `src/js/data/account.js` | Reorder, replacement, cascade, Finish Day and revision-bearing account reads |
| `src/js/data/legacyFinishedDays.js` | Pure inventory and explicit date-resolution strategy |
| `src/js/firestore/schema.js` | Manifest validation and monotonic transitions |
| `src/js/firestore/repository.js` | Guarded cascade support and final session assertion |
| `src/js/firestore/firebase.js` | Server-only connectivity check before transaction submission |
| `firestore.rules` | Manifest access and aggregate protocol/order enforcement; not deployed |
| `tests/account-data.test.js` | Lifecycle concurrency/failure/retry/date/isolation coverage |
| `tests/emulator/firestore.rules.mjs` | Real independent SDK clients, server rollback, rules compatibility and offline transactions |
| `docs/account-data-integration.md`, `docs/firestore-foundation.md` | Pointers to current lifecycle documentation |

Validation commands:

```powershell
npm.cmd test
npm.cmd run build
firebase.cmd emulators:exec --only firestore --project demo-taskly-rules "npm run test:rules"
git diff --check
```

The emulator suite refuses non-loopback endpoints and clears only its demo
database. Local emulator diagnostics are in ignored `.firebase/phase43-emulator.log`.

Verified on 2026-10-17: **59/59 unit tests**, **15/15 emulator tests**, production
build successful, and `git diff --check` clean. The build retains the existing
warning about a JavaScript chunk above 500 kB. Emulator coverage includes two
independent same-UID clients racing, full server rejection/rollback of Finish Day,
real SDK offline rejection (including a preference transaction), protocol bypass
denials, 25-task replacement/cascade, and all previous authorization/schema cases.
