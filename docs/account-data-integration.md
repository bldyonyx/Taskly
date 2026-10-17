# Phase 4.2: dormant account data integration

Production synchronization remains disabled. No deployment, migration, commit,
push or production data operation is part of this phase. Firestore rules are
unchanged. This document supersedes the Phase 4.1 lifecycle limitations and old
emulator status in `firestore-foundation.md` where described below.

## Boundaries and startup audit

`src/js/data/boundary.js` observes the existing Auth session without starting it.
It exposes immutable guest, blocked, or account-disabled contexts with a new
generation on every identity/readiness change. Only guest contexts carry a local
repository. Authenticated contexts contain a UID and no repository, guest state,
default tasks, theme or backup fallback. Calling `requireRepository()` in an
account context fails closed. The source constant `CLOUD_SYNC_ENABLED = false`
has no environment, URL or localStorage override. Flipping it alone does not wire
the UI or construct a Firestore repository.

`main.js` creates this preparatory boundary before starting Auth. Its existing UI
remains explicitly bound to the local guest workspace, including while signed in,
as required for this phase. It does **not** claim to display account data. Future
integration must replace this binding and clear the entire UI state before loading
an account; merely relabeling the local workspace would leak guest data.

Startup sequence remains recovery (`prepareLocalData`), local theme application,
local state hydration with in-memory sample/legacy fallbacks, Auth startup, then
render. The boundary performs no storage or network operations. No reachable
startup code imports the Firestore SDK adapter or creates an account repository.
**Normal startup performs zero Firestore reads, writes or listeners**, including
when Firebase Auth restores an existing login. Firebase Auth itself still performs
its normal identity operations.

Current reads/mutations were reviewed:

| Area | Current local path | Prepared account path |
| --- | --- | --- |
| Dated tasks/calendar | `loadState`, `tasksByDate`, selected-date rendering; explicit task mutations save dated tasks | `loadTasks`, targeted create/edit/complete/delete; explicit-ID reorder |
| Current list | date map plus legacy today fallback; explicit list/task changes save references | server-read day metadata; transaction verifies referenced list exists |
| Saved Lists | load/save local array; load regenerates active-copy IDs | ordered parent/task reads; atomic new snapshot with supplied IDs |
| Finished Days | local snapshots; edits save array; finish saves snapshot then clears day/references | ordered stable-date snapshot reads and atomic new snapshot; destructive finish-and-clear disabled |
| Theme | render-only application; selection explicitly saves local theme | separate account preference read/write; no local fallback |
| Backup/recovery | raw seven-key export, recovery journal, restore before hydration | never injected into account operations; no automatic import |
| Auth | identity observer and pending operations | invalidates repositories on pending auth, logout, unavailable state or UID switch |

All seven guest keys and their recovery workflow remain intact. New local
Finished Days include an additive `dateKey` derived from the selected local date;
loaders retain valid keys without rewriting storage. Calendar lookup prefers that
key. Timestamp-only legacy records keep the previous local display fallback.
Their original historical timezone cannot be inferred reliably: cloud snapshot
creation and the existing import planner require a reviewed explicit original key.
No timestamp-only record is silently assigned a cloud date.

## Account operations and server confirmation

`src/js/data/account.js` takes only a UID-bound existing Firestore repository.
It accepts explicit IDs and inputs and never imports the guest repository,
backups, localStorage or sample data. Empty accounts return empty collections,
null references and null theme, rather than guest defaults. Snapshot task IDs,
text, completion and supplied array order are preserved. Reads sort on `order`
with an ID tie-breaker; SDK document ordering is not relied upon.

`repository.js` adds server collection reads and a bounded `atomic(paths, plan)`
operation. All paths are validated and permanently rooted under the captured UID.
Every write uses a transaction with all required document reads before writes.
The synchronous planner is checked on **each** SDK retry. It cannot add unplanned
paths, duplicate mutations or more than 400 read documents. Plans and outputs are
cloned. Tasks and day metadata commit together, snapshot parent/tasks commit
together, references check the saved list in the same transaction, and preferences
use the same write boundary. No full user collection is replaced.

`schema.js` now validates transitions inside the transaction: saved-list
`createdAt`, finished-day `dateKey`/`date`/`createdAt`, and import
`sourceId`/`backupHash`/`createdAt` cannot change. Completed imports cannot revert.
These checks match the deployed immutable-field rules without changing rules.

`firebase.js` uses server-only document/collection reads and SDK transactions.
Transactions fail offline instead of queuing ordinary `setDoc` writes for later
replay. There is no offline outbox, optimistic cloud state, automatic application
retry, guest fallback or success notification on failure. A successful mutation
returns `{ confirmed: true }` only after the server transaction resolves and both
SDK identity and repository session are still valid. Caller must handle rejected
operations and reload authoritative state before retrying an uncertain result.

Listeners are explicit only, read-only, and filter cache or pending-write
snapshots using metadata. They never write back. Logout/pending auth/account
switching permanently invalidate a repository, unsubscribe listeners and suppress
late callbacks/results, even if the same UID returns. A transaction waiting on
reads/retry cannot plan a write after invalidation. A request **already submitted**
to the server cannot be canceled by logout: it may commit under its original UID,
but cannot report success into a later session. No result is cached across sessions.

## Deliberately disabled operations / activation blockers

- Parent removal (user/day/list/finished-day) is rejected. Firestore parent deletes
  leave child collections behind; Saved List deletion also requires reference
  cleanup. No cascading deletion is simulated by a partial loop.
- Saved List/Finished Day snapshot creation requires absent parent and all supplied
  task documents. Existing snapshot replacement is rejected. Updating arbitrary
  membership safely requires a revision/membership protocol and atomic cleanup.
  Snapshot editing/deletion and finish-and-clear are not connected to cloud UI.
- Ordering is explicit and targeted; a reorder only addresses supplied existing
  IDs. Concurrent inserts or incomplete reorder inputs can yield duplicate order
  values. Deterministic display sorting does not resolve semantic conflicts.
  Multi-device membership/revision conflict handling must precede UI activation.
- Snapshot collection reads span multiple server requests, rather than one
  consistent database snapshot. Concurrent updates can require a fresh reload.
  Atomic finishing of a day with a new snapshot and removal of all active tasks
  needs the same bounded membership protocol. Operations over 400 documents are
  rejected instead of partially committed; Firestore size/rule-access limits can
  reject smaller operations and are propagated unchanged.
- Historical timestamp-only date review, explicit guest-import approval and
  deduplication, error/retry/pending UI, and account-specific rendered state/theme
  lifecycle are still required. No guest migration API or UI is activated.

The remaining risks are isolated behind dormant modules and disabled operations.
Do not activate the task UI by simply changing the feature constant.

## Verification and recommended next phase

Unit coverage includes guest/account and A/B isolation, rapid switches and returning
to the original UID, missing account data, no guest fallback/import, task mutations,
ID/order preservation, snapshots/references/themes, failed/interrupted writes,
immutable transitions, stable new dates and stale listener/read suppression.
The emulator suite exercises the **real SDK transport** and account operations
against the existing deployed-compatible rules, plus owner/cross-account/guest
authorization and all previous schema/rules tests.

Run `npm.cmd test`, `npm.cmd run build`, and
`firebase.cmd emulators:exec --only firestore --project demo-taskly-rules "npm run test:rules"`.
The emulator suite refuses production endpoints and clears only its demo database.

Verified on 2026-10-17: **50/50 unit tests**, **8/8 emulator tests**, production
build successful, and `git diff --check` clean. Vite still reports a JavaScript
chunk above 500 kB. The emulator exercised server denial of a multi-document
transaction and confirmed the otherwise-valid preference write was not applied.
No production Firestore data was accessed. Emulator logs are under the ignored
`.firebase/phase42-emulator.log` path.

Next, implement and test revision/membership conflict handling, atomic finish and
bounded recursive cleanup in the emulator. Then integrate a separate account UI
state adapter with synchronous clearing on auth transitions and explicit error /
server-confirmation states. Exercise two accounts, offline failures and rapid
switching in an isolated test Firebase project. Request explicit approval before
enabling production synchronization; guest import must remain separately opt-in.
